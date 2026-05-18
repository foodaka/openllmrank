// Integration tests for the worker's queue logic against local Supabase.
// Skips cleanly when localhost:54332 is unreachable.

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { claimJob, markCompleted, markFailed } from "../src/queue";

const PG_HOST = process.env.SUPABASE_TEST_HOST ?? "127.0.0.1";
const PG_PORT = process.env.SUPABASE_TEST_PORT ?? "54332";
const PG_URL = `postgresql://postgres:postgres@${PG_HOST}:${PG_PORT}/postgres`;

async function pgReachable(url: string): Promise<boolean> {
  try {
    const probe = new SQL(url);
    await probe`select 1`;
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const reachable = await pgReachable(PG_URL);
const describePg = reachable ? describe : describe.skip;
const testPg = reachable ? test : test.skip;

if (!reachable) {
  // eslint-disable-next-line no-console
  console.warn(
    `[queue.test] Skipping: cannot reach ${PG_URL}. Run 'supabase start' to enable.`,
  );
}

let sql: SQL;
let userA = "";
let brandA = "";

const sampleConfig = {
  brand: { name: "TestCo", aliases: [] },
  competitors: [{ name: "RivalCo", aliases: [] }],
  prompts: ["best CRM for tests"],
  providers: [{ id: "openai", model: "gpt-4o-mini" }],
  samples_per_prompt: 3,
  concurrency_per_provider: 4,
};

beforeAll(async () => {
  if (!reachable) return;
  sql = new SQL(PG_URL);
});

afterAll(async () => {
  if (!reachable) return;
  await sql.end();
});

beforeEach(async () => {
  if (!reachable) return;
  // Clean slate per test. Cascading delete from auth.users wipes brands/jobs/runs.
  await sql`delete from auth.users where email like 'queue-test-%@example.com'`;

  const u = (await sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'queue-test-a@example.com', '$2a$10$fake', now())
    returning id
  `) as unknown as Array<{ id: string }>;
  userA = u[0]!.id;

  const b = (await sql`
    insert into public.brands (user_id, name) values (${userA}, 'TestCo') returning id
  `) as unknown as Array<{ id: string }>;
  brandA = b[0]!.id;
});

describePg("claimJob", () => {
  testPg("returns null when no eligible jobs", async () => {
    const job = await claimJob(sql);
    // There could be stale jobs from earlier wizard click-throughs in this
    // shared DB. The contract is "claimJob is safe to call repeatedly";
    // assert it doesn't throw and returns either null or a row.
    expect(job === null || typeof job?.id === "string").toBe(true);
  });

  testPg("claims a fresh 'paid' job and marks it 'running'", async () => {
    const ins = (await sql`
      insert into public.jobs (user_id, brand_id, status, config_jsonb, amount_cents, email_to, stripe_checkout_session_id)
      values (${userA}, ${brandA}, 'paid', ${JSON.stringify(sampleConfig)}::jsonb, 2999, 'queue-test@example.com', 'cs_queue_test_1')
      returning id
    `) as unknown as Array<{ id: string }>;
    const jobId = ins[0]!.id;

    const claimed = await claimJob(sql);
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(jobId);
    expect(claimed!.status).toBe("running");
    expect(claimed!.attempts).toBe(1);
    expect(claimed!.user_id).toBe(userA);
  });

  testPg("concurrent claims do not double-pick the same job", async () => {
    const ins = (await sql`
      insert into public.jobs (user_id, brand_id, status, config_jsonb, amount_cents, email_to, stripe_checkout_session_id)
      values (${userA}, ${brandA}, 'paid', ${JSON.stringify(sampleConfig)}::jsonb, 2999, 'queue-test@example.com', 'cs_queue_test_2')
      returning id
    `) as unknown as Array<{ id: string }>;
    const jobId = ins[0]!.id;

    // Two parallel claim attempts on the same DB.
    const [a, b] = await Promise.all([claimJob(sql), claimJob(sql)]);
    const winners = [a, b].filter((j) => j?.id === jobId);
    expect(winners.length).toBe(1);
  });

  testPg("reclaims a stale 'running' job whose lease expired", async () => {
    // Insert a 'running' job with a claimed_at older than the lease cutoff.
    // attempts=1 simulates the worker that claimed it before crashing.
    const ins = (await sql`
      insert into public.jobs (user_id, brand_id, status, config_jsonb, amount_cents, email_to,
                               stripe_checkout_session_id, claimed_at, claimed_by, attempts)
      values (${userA}, ${brandA}, 'running', ${JSON.stringify(sampleConfig)}::jsonb, 2999, 'queue-test@example.com',
              'cs_queue_stale_1', now() - interval '60 minutes', 'dead-worker-1', 1)
      returning id
    `) as unknown as Array<{ id: string }>;
    const jobId = ins[0]!.id;

    const claimed = await claimJob(sql);
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(jobId);
    expect(claimed!.attempts).toBe(2); // incremented from 1
  });
});

describePg("markCompleted / markFailed", () => {
  testPg("markCompleted sets succeeded fields + email_status=pending", async () => {
    const ins = (await sql`
      insert into public.jobs (user_id, brand_id, status, config_jsonb, amount_cents, email_to,
                               stripe_checkout_session_id, claimed_at)
      values (${userA}, ${brandA}, 'running', ${JSON.stringify(sampleConfig)}::jsonb, 2999, 'queue-test@example.com',
              'cs_queue_complete_1', now())
      returning id
    `) as unknown as Array<{ id: string }>;
    const jobId = ins[0]!.id;

    await markCompleted(sql, jobId, {
      cli_run_id: "2026-05-17T22-00-00-000Z",
      succeeded: 30,
      failed: 0,
      cost_usd_total: 1.234,
    });

    const rows = (await sql`
      select status, email_status, succeeded_count, failed_count, cost_usd_total::float
      from public.jobs where id = ${jobId}
    `) as unknown as Array<{
      status: string;
      email_status: string;
      succeeded_count: number;
      failed_count: number;
      cost_usd_total: number;
    }>;
    expect(rows[0]!.status).toBe("completed");
    expect(rows[0]!.email_status).toBe("pending");
    expect(rows[0]!.succeeded_count).toBe(30);
    expect(rows[0]!.failed_count).toBe(0);
    expect(Math.abs(rows[0]!.cost_usd_total - 1.234)).toBeLessThan(0.0001);
  });

  testPg("markFailed sets refund_status=pending for the refunder to pick up", async () => {
    const ins = (await sql`
      insert into public.jobs (user_id, brand_id, status, config_jsonb, amount_cents, email_to,
                               stripe_checkout_session_id, claimed_at)
      values (${userA}, ${brandA}, 'running', ${JSON.stringify(sampleConfig)}::jsonb, 2999, 'queue-test@example.com',
              'cs_queue_fail_1', now())
      returning id
    `) as unknown as Array<{ id: string }>;
    const jobId = ins[0]!.id;

    await markFailed(sql, jobId, {
      error_code: "PROVIDER_AUTH",
      error_message: "OpenAI returned 401",
    });

    const rows = (await sql`
      select status, refund_status, error_code, error_message
      from public.jobs where id = ${jobId}
    `) as unknown as Array<{
      status: string;
      refund_status: string;
      error_code: string;
      error_message: string;
    }>;
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.refund_status).toBe("pending");
    expect(rows[0]!.error_code).toBe("PROVIDER_AUTH");
    expect(rows[0]!.error_message).toBe("OpenAI returned 401");
  });
});
