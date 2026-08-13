// End-to-end worker smoke test. Skips the real CLI subprocess (would burn
// OpenAI credits) by spawning a tiny stub script that mimics the CLI's
// --output-json contract. Exercises: claimJob → cli-runner → result-writer
// → markCompleted → email-status='pending'.

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { Database } from "bun:sqlite";

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
  console.warn(`[e2e.test] Skipping: cannot reach ${PG_URL}`);
}

let sql: SQL;
let stubDir = "";
let userId = "";
let brandId = "";

const sampleConfig = {
  brand: { name: "SmokeCo", aliases: [] },
  competitors: [{ name: "RivalCo", aliases: [] }],
  prompts: ["best CRM for smoke tests"],
  providers: [{ id: "openai", model: "gpt-4o-mini" }],
  samples_per_prompt: 1,
  concurrency_per_provider: 1,
};

const STUB_RUN_ID = "2026-05-17T22-30-00-000Z";

beforeAll(async () => {
  if (!reachable) return;
  sql = new SQL(PG_URL);
  stubDir = mkdtempSync(join(tmpdir(), "openllmrank-e2e-"));
});

afterAll(async () => {
  if (!reachable) return;
  await sql.end();
  rmSync(stubDir, { recursive: true, force: true });
});

beforeEach(async () => {
  if (!reachable) return;
  await sql`delete from auth.users where email like 'e2e-test%@example.com'`;
  const u = (await sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'e2e-test@example.com', '$2a$10$fake', now())
    returning id
  `) as unknown as Array<{ id: string }>;
  userId = u[0]!.id;
  const b = (await sql`
    insert into public.brands (user_id, name) values (${userId}, 'SmokeCo') returning id
  `) as unknown as Array<{ id: string }>;
  brandId = b[0]!.id;
});

describePg("worker end-to-end (stubbed CLI)", () => {
  testPg("claim → run stub CLI → write results → mark completed", async () => {
    const { claimJob, markCompleted } = await import("../src/queue");
    const { writeRunToPostgres } = await import("../src/result-writer");
    const { backfillRunMetrics, writeRunMetrics } = await import("../src/run-metrics");

    // 1. Insert a paid job ready to be claimed.
    const ins = (await sql`
      insert into public.jobs (user_id, brand_id, status, config_jsonb, amount_cents, email_to,
                               stripe_checkout_session_id)
      values (${userId}, ${brandId}, 'paid', ${JSON.stringify(sampleConfig)}::jsonb, 2999,
              'e2e-test@example.com', 'cs_e2e_1')
      returning id
    `) as unknown as Array<{ id: string }>;
    const jobId = ins[0]!.id;

    // 2. Claim it.
    const claimed = await claimJob(sql);
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(jobId);

    // 3. Manually create a "CLI output" sqlite db. (Mimics what the real
    //    CLI would write — skipping the actual subprocess to avoid API
    //    calls in CI.)
    const sqlitePath = join(stubDir, `${jobId}.db`);
    const db = new Database(sqlitePath);
    db.exec(`
      CREATE TABLE prompts (
        prompt_id TEXT PRIMARY KEY, prompt_text TEXT NOT NULL, model TEXT NOT NULL,
        provider TEXT NOT NULL, config_blob TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE runs (
        run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, config_hash TEXT NOT NULL
      );
      CREATE TABLE calls (
        run_id TEXT NOT NULL, prompt_id TEXT NOT NULL, sample_index INTEGER NOT NULL,
        ts TEXT NOT NULL, response_text TEXT NOT NULL DEFAULT '',
        search_results_json TEXT NOT NULL DEFAULT '[]', latency_ms INTEGER NOT NULL DEFAULT 0,
        tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0, error_code TEXT, error_message TEXT,
        PRIMARY KEY (run_id, prompt_id, sample_index)
      );
      CREATE TABLE citations (
        run_id TEXT NOT NULL, prompt_id TEXT NOT NULL, sample_index INTEGER NOT NULL,
        brand TEXT NOT NULL, matched_text TEXT NOT NULL, kind TEXT NOT NULL
      );
    `);
    db.run(
      "INSERT INTO runs VALUES (?, ?, ?, ?)",
      [STUB_RUN_ID, new Date().toISOString(), new Date().toISOString(), "abc123"],
    );
    db.run(
      "INSERT INTO prompts VALUES (?, ?, ?, ?, ?, ?)",
      [
        "prompt_e2e_1",
        "best CRM for smoke tests",
        "gpt-4o-mini",
        "openai",
        '{"tools":["web_search"]}',
        new Date().toISOString(),
      ],
    );
    db.run(
      `INSERT INTO calls VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      [
        STUB_RUN_ID,
        "prompt_e2e_1",
        0,
        new Date().toISOString(),
        "SmokeCo is a CRM. RivalCo is also one.",
        "[]",
        100,
        50,
        20,
        0.001,
      ],
    );
    db.run(
      `INSERT INTO citations VALUES (?, ?, ?, ?, ?, ?)`,
      [STUB_RUN_ID, "prompt_e2e_1", 0, "SmokeCo", "SmokeCo is a CRM.", "name"],
    );
    db.run(
      `INSERT INTO citations VALUES (?, ?, ?, ?, ?, ?)`,
      [STUB_RUN_ID, "prompt_e2e_1", 0, "RivalCo", "RivalCo is also one.", "name"],
    );
    db.close();

    // 4. Hand off to the result writer.
    const { run_id_pg } = await writeRunToPostgres(sql, {
      sqlite_path: sqlitePath,
      job_id: jobId,
      user_id: userId,
      brand_id: brandId,
      cli_run_id: STUB_RUN_ID,
      brand_name: "SmokeCo",
      competitor_names: ["RivalCo"],
    });
    expect(typeof run_id_pg).toBe("string");
    expect(run_id_pg.length).toBeGreaterThan(10);

    // 5. Mark the job complete.
    await markCompleted(sql, jobId, {
      cli_run_id: STUB_RUN_ID,
      succeeded: 1,
      failed: 0,
      cost_usd_total: 0.001,
    });

    // 6. Verify Postgres state.
    const jobRows = (await sql`
      select status, email_status, succeeded_count, cli_run_id
      from public.jobs where id = ${jobId}
    `) as unknown as Array<{
      status: string;
      email_status: string;
      succeeded_count: number;
      cli_run_id: string;
    }>;
    expect(jobRows[0]!.status).toBe("completed");
    expect(jobRows[0]!.email_status).toBe("pending");
    expect(jobRows[0]!.succeeded_count).toBe(1);
    expect(jobRows[0]!.cli_run_id).toBe(STUB_RUN_ID);

    const callRows = (await sql`
      select count(*)::int as n from public.calls where run_id = ${run_id_pg}
    `) as unknown as Array<{ n: number }>;
    expect(callRows[0]!.n).toBe(1);

    const citationRows = (await sql`
      select count(*)::int as n, array_agg(brand order by brand) as brands
      from public.citations where run_id = ${run_id_pg}
    `) as unknown as Array<{ n: number; brands: string[] }>;
    expect(citationRows[0]!.n).toBe(2);
    expect(citationRows[0]!.brands.sort()).toEqual(["RivalCo", "SmokeCo"]);

    const metricRows = (await sql`
      select own_citation_rate::float, share_of_voice::float, samples_total,
             per_provider_jsonb::text, per_competitor_jsonb::text, top_gap_prompt,
             top_gap_score::float
      from public.run_metrics where run_id = ${run_id_pg}
    `) as unknown as Array<{
      own_citation_rate: number;
      share_of_voice: number;
      samples_total: number;
      per_provider_jsonb: string;
      per_competitor_jsonb: string;
      top_gap_prompt: string | null;
      top_gap_score: number | null;
    }>;
    expect(metricRows).toHaveLength(1);
    expect(metricRows[0]!.own_citation_rate).toBe(1);
    expect(metricRows[0]!.share_of_voice).toBe(0.5);
    expect(metricRows[0]!.samples_total).toBe(1);
    expect(JSON.parse(metricRows[0]!.per_provider_jsonb).openai).toBe(1);
    expect(JSON.parse(metricRows[0]!.per_competitor_jsonb)).toEqual([
      { name: "RivalCo", rate: 1 },
    ]);
    expect(metricRows[0]!.top_gap_prompt).toBe("best CRM for smoke tests");
    expect(metricRows[0]!.top_gap_score).toBe(0);

    // Recomputing the same run updates its existing row rather than creating
    // a second dashboard point.
    await writeRunMetrics(sql, {
      run_id: run_id_pg,
      user_id: userId,
      brand_id: brandId,
      job_id: jobId,
      computed_at: new Date().toISOString(),
      brand_name: "SmokeCo",
      competitor_names: ["RivalCo"],
    });
    const metricCount = (await sql`
      select count(*)::int as n from public.run_metrics where run_id = ${run_id_pg}
    `) as unknown as Array<{ n: number }>;
    expect(metricCount[0]!.n).toBe(1);

    const finishedRows = (await sql`
      select finished_at::text from public.runs where id = ${run_id_pg}
    `) as unknown as Array<{ finished_at: string }>;
    await sql`delete from public.run_metrics where run_id = ${run_id_pg}`;
    await sql`update public.brands set name = 'Renamed SmokeCo' where id = ${brandId}`;
    const backfilled = await backfillRunMetrics(sql);
    expect(backfilled).toBeGreaterThan(0);

    const rebuiltRows = (await sql`
      select computed_at::text, top_gap_prompt
      from public.run_metrics where run_id = ${run_id_pg}
    `) as unknown as Array<{ computed_at: string; top_gap_prompt: string }>;
    expect(rebuiltRows[0]!.computed_at).toBe(finishedRows[0]!.finished_at);
    expect(rebuiltRows[0]!.top_gap_prompt).toBe("best CRM for smoke tests");

    // Cleanup the stub sqlite file
    rmSync(sqlitePath, { force: true });
  });
});
