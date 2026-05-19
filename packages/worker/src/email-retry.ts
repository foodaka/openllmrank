// Email outbox loop (TODO #1 from /plan-eng-review). Same pattern as the
// refunder but for the report email — if Postmark is down when a job
// completes, the email_status='pending' row sits here until Postmark
// recovers or we exhaust retries.
//
// The order-received email is fire-and-forget at webhook time (delays
// here would just hold up the job loop). The report email goes through
// this outbox so a transient Postmark failure doesn't lose the deliverable.

import type { SQL } from "bun";
import { db } from "./db";
import { sendReport } from "./emailer";
import { alert } from "./alerts";
import { renderHtmlReport } from "openllmrank/src/core/render-html";
import type {
  CallRow,
  CitationRow,
  PromptRow,
  RunRow,
} from "openllmrank/src/core/db";
import { computeRates, computeGap } from "openllmrank/src/core/gap";

const EMAIL_POLL_INTERVAL_MS = 60_000;
const EMAIL_MAX_ATTEMPTS = 6;

type PendingEmailRow = {
  id: string;
  user_id: string;
  brand_id: string;
  email_to: string;
  config_jsonb: {
    brand: { name: string; aliases: string[] };
    competitors: Array<{ name: string; aliases: string[] }>;
  };
  cli_run_id: string | null;
  email_attempts: number;
  brand_name: string;
  succeeded_at: string;
};

async function fetchPendingEmails(sql: SQL): Promise<PendingEmailRow[]> {
  return (await sql`
    select j.id, j.user_id, j.brand_id, j.email_to, j.config_jsonb,
           j.cli_run_id, j.email_attempts,
           b.name as brand_name,
           j.succeeded_at::text as succeeded_at
    from public.jobs j
    join public.brands b on b.id = j.brand_id
    where j.email_status = 'pending'
      and j.email_attempts < ${EMAIL_MAX_ATTEMPTS}
      and j.cli_run_id is not null
    order by j.succeeded_at asc
    limit 10
  `) as unknown as PendingEmailRow[];
}

/**
 * Load the run's data from Postgres and render the report HTML using the
 * CLI's renderer (which expects the same Row shapes the CLI's SQLite uses).
 */
async function renderReportFromPg(
  sql: SQL,
  row: PendingEmailRow,
): Promise<string> {
  const cfg = row.config_jsonb;
  const brand_name = cfg.brand.name;
  const competitor_names = cfg.competitors.map((c) => c.name);

  // Scope every query to the SPECIFIC cli_run_id from the completed
  // attempt. Without this, a job that was retried by stale-lease reclaim
  // (worker crashed mid-write before markCompleted) leaves stale rows
  // from the first attempt that aggregate into the email — double-counted
  // samples, wrong citation rates. (P2 from /codex review on 2026-05-19.)
  const cli_run_id = row.cli_run_id;
  if (!cli_run_id) {
    throw new Error("renderReportFromPg called for job with no cli_run_id");
  }

  // Pull rows for THIS specific cli_run_id only.
  const runRows = (await sql`
    select cli_run_id as run_id, started_at::text, finished_at::text, config_hash
    from public.runs where job_id = ${row.id} and cli_run_id = ${cli_run_id}
  `) as unknown as Array<RunRow>;

  const callRows = (await sql`
    select cli_run_id_dummy, prompt_id, sample_index, ts::text, response_text,
           search_results_json, latency_ms, tokens_in, tokens_out, cost_usd,
           null::text as error_code, null::text as error_message
    from (
      select r.cli_run_id as cli_run_id_dummy, c.prompt_id, c.sample_index, c.ts,
             c.response_text, c.search_results_json::text as search_results_json,
             c.latency_ms, c.tokens_in, c.tokens_out, c.cost_usd
      from public.calls c
      join public.runs r on r.id = c.run_id
      where c.user_id = ${row.user_id}
        and r.job_id = ${row.id}
        and r.cli_run_id = ${cli_run_id}
    ) sub
  `) as unknown as Array<{
    cli_run_id_dummy: string;
    prompt_id: string;
    sample_index: number;
    ts: string;
    response_text: string;
    search_results_json: string;
    latency_ms: number;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    error_code: string | null;
    error_message: string | null;
  }>;
  const calls: CallRow[] = callRows.map((c) => ({
    run_id: c.cli_run_id_dummy,
    prompt_id: c.prompt_id,
    sample_index: c.sample_index,
    ts: c.ts,
    response_text: c.response_text,
    search_results_json: c.search_results_json,
    latency_ms: c.latency_ms,
    tokens_in: c.tokens_in,
    tokens_out: c.tokens_out,
    cost_usd: c.cost_usd,
    error_code: null,
    error_message: null,
  }));

  const citationRows = (await sql`
    select r.cli_run_id as run_id, c.prompt_id, c.sample_index,
           c.brand, c.matched_text, c.kind
    from public.citations c
    join public.runs r on r.id = c.run_id
    where c.user_id = ${row.user_id}
      and r.job_id = ${row.id}
      and r.cli_run_id = ${cli_run_id}
  `) as unknown as Array<CitationRow>;

  // Prompts row shape the CLI's computeRates expects
  const promptRows = (await sql`
    select prompt_id, prompt_text, model, provider, config_blob, created_at::text
    from public.prompts where user_id = ${row.user_id}
  `) as unknown as Array<PromptRow>;

  // computeRates + computeGap mirror the CLI's `report` command logic
  const rates = computeRates(calls, citationRows, promptRows, [
    brand_name,
    ...competitor_names,
  ]);
  const gaps = computeGap(rates, brand_name, competitor_names);

  return renderHtmlReport({
    brand_name,
    competitor_names,
    rates,
    gaps,
    calls,
    citations: citationRows,
    runs: runRows,
    since_iso: row.succeeded_at,
    generated_at: new Date().toISOString(),
    project_version: "0.3.0",
  });
}

async function processOneEmail(
  sql: SQL,
  row: PendingEmailRow,
): Promise<void> {
  await sql`
    update public.jobs
    set email_attempts = email_attempts + 1
    where id = ${row.id}
  `;

  let htmlBody: string;
  try {
    htmlBody = await renderReportFromPg(sql, row);
  } catch (e) {
    const msg = (e as Error).message;
    await sql`
      update public.jobs
      set email_last_error = ${"render: " + msg}
      where id = ${row.id}
    `;
    if (row.email_attempts + 1 >= EMAIL_MAX_ATTEMPTS) {
      await sql`update public.jobs set email_status = 'failed' where id = ${row.id}`;
      await alert("error", "email-retry: report rendering failed", {
        job_id: row.id,
        error: msg,
      });
    }
    return;
  }

  const result = await sendReport({
    jobId: row.id,
    to: row.email_to,
    brand_name: row.brand_name,
    htmlBody,
  });

  if (result.ok) {
    await sql`
      update public.jobs
      set email_status = 'sent', email_last_error = null
      where id = ${row.id}
    `;
    return;
  }

  await sql`
    update public.jobs
    set email_last_error = ${result.message}
    where id = ${row.id}
  `;

  if (row.email_attempts + 1 >= EMAIL_MAX_ATTEMPTS) {
    await sql`update public.jobs set email_status = 'failed' where id = ${row.id}`;
    await alert("error", "email retry attempts exhausted", {
      job_id: row.id,
      to: row.email_to,
      last_error: result.message,
    });
  }
}

export function startEmailRetryLoop(): { stop: () => void } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const sql = db();
      const rows = await fetchPendingEmails(sql);
      for (const row of rows) {
        if (stopped) return;
        await processOneEmail(sql, row);
      }
    } catch (e) {
      await alert("error", "email-retry loop tick failed", {
        message: (e as Error).message,
      });
    }
    if (!stopped) {
      timer = setTimeout(tick, EMAIL_POLL_INTERVAL_MS);
    }
  }

  timer = setTimeout(tick, 7_500);
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
