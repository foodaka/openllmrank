// Integration test for the crawl LOOP itself (crawl-loop.ts) — the one new
// worker file crawl-queue.test.ts does not touch: claim → runCheck →
// finishCrawl wiring, end to end against local Supabase.
//
// The target domain is .invalid (RFC 6761: guaranteed NXDOMAIN), so the
// engine deterministically produces a site-level "failed" diagnosis with no
// real network traffic. Triple-guarded: skips without local PG, skips if
// env.databaseUrl is not the local Supabase, and skips if any FOREIGN
// claimable row exists (the loop must never crawl someone's real queued job
// from a dev database).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";

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

// env/db load .env.local on import — only do it when PG is up at all.
const { env } = reachable ? await import("../src/env") : { env: null };
const localDb =
  reachable &&
  env !== null &&
  (env.databaseUrl.includes(`127.0.0.1:${PG_PORT}`) ||
    env.databaseUrl.includes(`localhost:${PG_PORT}`));

const describePg = localDb ? describe : describe.skip;
if (!localDb) {
  console.warn(
    "[crawl-loop.test] Skipping: local Supabase not reachable or worker DATABASE_URL is not local.",
  );
}

const TEST_DOMAIN = "crawl-loop-test.invalid";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let sql: SQL;

beforeAll(async () => {
  if (!localDb) return;
  sql = new SQL(PG_URL);
  await sql`delete from public.crawl_checks where domain = ${TEST_DOMAIN}`;
});

afterAll(async () => {
  if (!localDb) return;
  await sql`delete from public.crawl_checks where domain = ${TEST_DOMAIN}`;
  await sql.end();
});

describePg("startCrawlLoop", () => {
  test("claims a queued check, runs the engine, and lands a terminal 'failed' snapshot", async () => {
    // Safety: never start the loop while a foreign claimable row exists.
    const foreign = (await sql`
      select count(*)::int as n from public.crawl_checks
      where domain != ${TEST_DOMAIN}
        and (state = 'queued'
             or (state = 'running' and claimed_at < now() - interval '30 minutes'))
    `) as unknown as Array<{ n: number }>;
    if (foreign[0]!.n > 0) {
      console.warn(
        "[crawl-loop.test] Skipping loop run: foreign claimable crawl_checks rows present.",
      );
      return;
    }

    const inserted = (await sql`
      insert into public.crawl_checks (domain, origin, requester_ip_hash)
      values (${TEST_DOMAIN}, ${`https://${TEST_DOMAIN}`}, 'looptesthash')
      returning id
    `) as unknown as Array<{ id: string }>;
    const id = inserted[0]!.id;

    const { startCrawlLoop } = await import("../src/crawl-loop");
    const loop = startCrawlLoop();
    try {
      // Wait for the loop to claim + finish (poll interval default 1s; DNS
      // failure on .invalid is near-instant).
      let row: { state: string; failure_reason: string | null; finished_at: string | null; claimed_by: string | null } | undefined;
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const rows = (await sql`
          select state, failure_reason, finished_at, claimed_by
          from public.crawl_checks where id = ${id}
        `) as unknown as Array<typeof row>;
        row = rows[0];
        if (row && ["complete", "partial", "failed"].includes(row.state)) break;
        await sleep(250);
      }

      expect(row).toBeDefined();
      // NXDOMAIN origin → site-level "failed" diagnosis via finishCrawl,
      // written by THIS worker, with a reason and a finished_at stamp.
      expect(row!.state).toBe("failed");
      expect(row!.failure_reason).toBeTruthy();
      expect(row!.finished_at).toBeTruthy();
      expect(row!.claimed_by).toBeTruthy();
    } finally {
      // stop() resolves when the loop has actually exited — without awaiting,
      // an in-flight iteration can claim rows AFTER this file finishes and
      // poison later test files' claim assertions (review finding, observed).
      await loop.stop();
      // Let the loop observe the stop flag before closing its connection.
      await sleep(1300);
      const { closeDb } = await import("../src/db");
      await closeDb();
    }
  }, 30_000);
});
