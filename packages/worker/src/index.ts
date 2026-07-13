// Worker entry point. Three loops run concurrently:
//
//   1. Main job loop   — claim jobs, run CLI, write results, mark complete/failed.
//   2. Refunder loop   — pick up failed jobs with refund_status='pending', call Stripe.
//   3. Email loop      — pick up completed jobs with email_status='pending', send report.
//
// SIGTERM / SIGINT: stop accepting new jobs, finish the current one if any,
// stop the outboxes, close the DB connection, exit cleanly.

import { env } from "./env";
import { db, closeDb } from "./db";
import { claimJob, markCompleted, markFailed, type Job } from "./queue";
import { runCliJob, killActiveSubprocess } from "./cli-runner";
import { writeRunToPostgres } from "./result-writer";
import { startRefunderLoop } from "./refunder";
import { startEmailRetryLoop } from "./email-retry";
import { alert } from "./alerts";

let shuttingDown = false;
let activeJobId: string | null = null;

async function processOneJob(job: Job): Promise<void> {
  activeJobId = job.id;
  console.log(
    `[worker] claimed job=${job.id} brand=${job.brand_id} (attempt ${job.attempts})`,
  );
  const sql = db();

  // 1. Run the CLI as a subprocess. Inject shared API keys.
  const result = await runCliJob({
    config: job.config_jsonb,
    openaiKey: env.openaiKey,
    anthropicKey: env.anthropicKey,
    googleKey: env.googleKey,
    perplexityKey: env.perplexityKey,
    xaiKey: env.xaiKey,
  });

  if (!result.ok) {
    result.cleanup();
    // INTERRUPTED means the worker was killed mid-run, not that the job
    // truly failed. Leave the job in 'running' state — the stale-lease
    // reclaim in claimJob will pick it up on the next worker boot.
    if (result.code === "INTERRUPTED") {
      console.log(
        `[worker] job=${job.id} interrupted (worker shutdown); leaving in 'running' for reclaim`,
      );
      activeJobId = null;
      return;
    }
    console.error(
      `[worker] job=${job.id} CLI failed: ${result.code} ${result.message}`,
    );
    await markFailed(sql, job.id, {
      error_code: result.code,
      error_message: result.message,
    });
    await alert("warn", "job failed (refund queued)", {
      job_id: job.id,
      code: result.code,
      message: result.message,
    });
    activeJobId = null;
    return;
  }

  // 2. Read the CLI's sqlite output, bulk-insert into Postgres.
  try {
    await writeRunToPostgres(sql, {
      sqlite_path: result.sqlite_path,
      job_id: job.id,
      user_id: job.user_id,
      brand_id: job.brand_id,
      cli_run_id: result.run_id,
    });
  } catch (e) {
    result.cleanup();
    const msg = (e as Error).message;
    console.error(`[worker] job=${job.id} result-writer failed: ${msg}`);
    await markFailed(sql, job.id, {
      error_code: "RESULT_WRITER",
      error_message: msg,
    });
    await alert("error", "job result-writer failed", {
      job_id: job.id,
      error: msg,
    });
    activeJobId = null;
    return;
  }

  // 3. Zero-success guard. If the CLI exited 0 but every provider call
  //    failed individually (e.g., the CLI's retry loop exhausted on rate
  //    limits, or all providers returned auth errors), result.ok is true
  //    but result.succeeded is 0. Don't ship a no-data report — refund
  //    instead. (P1 from /codex review on 2026-05-19.)
  if (result.succeeded === 0) {
    result.cleanup();
    const detail =
      result.failed > 0
        ? `CLI completed with 0 successful calls and ${result.failed} provider failures`
        : "CLI completed with no successful calls (empty run)";
    console.error(`[worker] job=${job.id} ${detail} — refunding`);
    await markFailed(sql, job.id, {
      error_code: "ZERO_SUCCESS",
      error_message: detail,
    });
    await alert("warn", "job had zero successful calls (refund queued)", {
      job_id: job.id,
      failed: result.failed,
      cost_usd_total: result.cost_usd_total,
    });
    activeJobId = null;
    return;
  }

  // 4. Cleanup tmpdir and mark complete. email_status='pending' tells the
  //    email-retry loop to send the report.
  result.cleanup();
  await markCompleted(sql, job.id, {
    cli_run_id: result.run_id,
    succeeded: result.succeeded,
    failed: result.failed,
    cost_usd_total: result.cost_usd_total,
  });

  console.log(
    `[worker] job=${job.id} completed: ${result.succeeded} succeeded, ${result.failed} failed, $${result.cost_usd_total.toFixed(4)}`,
  );
  activeJobId = null;
}

async function jobLoop(): Promise<void> {
  while (!shuttingDown) {
    try {
      const sql = db();
      const job = await claimJob(sql);
      if (!job) {
        // No jobs available — wait before polling again.
        await sleep(env.pollIntervalMs);
        continue;
      }
      await processOneJob(job);
    } catch (e) {
      await alert("error", "job loop tick failed", {
        message: (e as Error).message,
      });
      // Don't tight-loop on a broken state.
      await sleep(env.pollIntervalMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received, shutting down...`);

  // Kill the active CLI subprocess so the platform's SIGKILL grace timer
  // doesn't reap us mid-job with no cleanup. The killed subprocess
  // resolves runCliJob with code='INTERRUPTED' and the job stays in
  // 'running' state — the stale-lease reclaim in claimJob picks it up
  // on the next worker boot. (Fix from /review 2026-05-18.)
  if (activeJobId) {
    console.log(`[worker] killing active job ${activeJobId} subprocess...`);
    killActiveSubprocess();
    // Bound the wait — most platforms give us ~25-30s before SIGKILL.
    const SHUTDOWN_WAIT_MS = 20_000;
    const start = Date.now();
    while (activeJobId && Date.now() - start < SHUTDOWN_WAIT_MS) {
      await sleep(250);
    }
    if (activeJobId) {
      console.log(
        `[worker] WARN: active job ${activeJobId} did not exit cleanly within ${SHUTDOWN_WAIT_MS}ms; lease will reclaim it`,
      );
    }
  }

  refunder.stop();
  emailRetry.stop();
  await closeDb();
  console.log("[worker] clean shutdown complete.");
  process.exit(0);
}

console.log(`[worker] starting (id=${env.workerId})`);
console.log(`[worker] stripe mode: ${env.stripeMode}`);
console.log(`[worker] postmark mode: ${env.postmarkMode}`);
console.log(`[worker] poll interval: ${env.pollIntervalMs}ms`);

// Spin up the two outbox loops first, then the main job loop.
const refunder = startRefunderLoop();
const emailRetry = startEmailRetryLoop();

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await jobLoop();
