// Integration tests for the monitor tick against local Supabase. Skips
// cleanly when Postgres is unreachable. Emails go through the Postmark
// local_stub (outbox files), so the full phase-A/phase-B lifecycle runs for
// real — including the at-least-once advance-after-send ordering.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import {
  harvestFinishedMonitorCrawls,
  startDueMonitorCrawls,
} from "../src/monitor-queue";
import { claimCrawlCheck } from "../src/crawl-queue";
import { SCHEMA_VERSION, type Finding } from "@openllmrank/crawl";

const PG_HOST = process.env.SUPABASE_TEST_HOST ?? "127.0.0.1";
const PG_PORT = process.env.SUPABASE_TEST_PORT ?? "54332";
const PG_URL = `postgresql://postgres:postgres@${PG_HOST}:${PG_PORT}/postgres`;

async function pgReachable(url: string): Promise<boolean> {
  try {
    const probe = new SQL(url);
    await probe`select 1 from public.crawl_monitors limit 1`;
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const reachable = await pgReachable(PG_URL);
const describePg = reachable ? describe : describe.skip;
if (!reachable) {
  console.warn(`[monitor-queue.test] Skipping: cannot reach ${PG_URL} (or 0005 not applied).`);
}

let sql: SQL;
const DOMAIN = "monitor-test.example";

const phase1 = {
  schema_version: SCHEMA_VERSION,
  robots_txt_found: true,
  robots_blocks_all: false,
  sitemap_urls: [],
  sitemap_found: true,
  bot_access: [],
};
const orphanFinding: Finding = {
  type: "orphan_page",
  url: `https://${DOMAIN}/ghost`,
  severity: "critical",
  tier: "headline",
};

async function insertMonitor(overrides: Record<string, unknown> = {}): Promise<string> {
  const rows = (await sql`
    insert into public.crawl_monitors ${sql({
      domain: DOMAIN,
      origin: `https://${DOMAIN}`,
      email: "subscriber@monitor-test.example",
      stripe_customer_id: "cus_test",
      stripe_subscription_id: `sub_test_${crypto.randomUUID()}`,
      ...overrides,
    })}
    returning id
  `) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

async function monitorRow(id: string): Promise<Record<string, unknown>> {
  const rows = (await sql`
    select * from public.crawl_monitors where id = ${id}
  `) as unknown as Array<Record<string, unknown>>;
  return rows[0]!;
}

async function terminalizeCheck(
  checkId: string,
  state: "complete" | "partial" | "failed",
  findings: Finding[],
): Promise<void> {
  await sql`
    update public.crawl_checks
    set state = ${state}::crawl_state,
        phase1_jsonb = ${phase1 as unknown as Record<string, unknown>},
        findings_jsonb = ${findings as unknown as Record<string, unknown>[]},
        pages_crawled = 5, pages_discovered = 5, finished_at = now(),
        claimed_at = null, claimed_by = null
    where id = ${checkId}
  `;
}

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
  await sql`delete from public.crawl_monitors where domain = ${DOMAIN}`;
  // LIKE, not equality: the claim-priority test uses subdomains of DOMAIN,
  // and a recently-claimed 'running' row from a prior run survives the
  // stale-claimable sweep below (its lease isn't stale yet).
  await sql`delete from public.crawl_checks where domain like ${"%" + DOMAIN}`;
  // Determinism: clear foreign claimable rows (same rationale as crawl-queue.test).
  await sql`
    delete from public.crawl_checks
    where state = 'queued' or (state = 'running' and claimed_at < now() - interval '30 minutes')
  `;
});

describePg("phase A — startDueMonitorCrawls", () => {
  test("due monitor inserts a monitor-source crawl and records pending", async () => {
    const id = await insertMonitor();
    expect(await startDueMonitorCrawls(sql)).toBe(1);
    const m = await monitorRow(id);
    expect(m.pending_check_id).toBeTruthy();
    const checks = (await sql`
      select source, state, requester_ip_hash from public.crawl_checks where id = ${m.pending_check_id as string}
    `) as unknown as Array<{ source: string; state: string; requester_ip_hash: string }>;
    expect(checks[0]).toMatchObject({ source: "monitor", state: "queued" });
    expect(checks[0]!.requester_ip_hash).toBe(`monitor:${id}`);
  });

  test("adopts an existing active check instead of inserting a second", async () => {
    const existing = (await sql`
      insert into public.crawl_checks (domain, origin, requester_ip_hash, source)
      values (${DOMAIN}, ${"https://" + DOMAIN}, 'free-user-hash', 'free')
      returning id
    `) as unknown as Array<{ id: string }>;
    const id = await insertMonitor();
    await startDueMonitorCrawls(sql);
    const m = await monitorRow(id);
    expect(m.pending_check_id).toBe(existing[0]!.id);
    const count = (await sql`
      select count(*)::int as n from public.crawl_checks where domain = ${DOMAIN}
    `) as unknown as Array<{ n: number }>;
    expect(count[0]!.n).toBe(1);
  });

  test("two monitors on one domain share a single crawl", async () => {
    const a = await insertMonitor();
    const b = await insertMonitor({ email: "other@monitor-test.example" });
    await startDueMonitorCrawls(sql);
    const ma = await monitorRow(a);
    const mb = await monitorRow(b);
    expect(ma.pending_check_id).toBeTruthy();
    expect(ma.pending_check_id).toBe(mb.pending_check_id);
  });

  test("not-due and canceled monitors are untouched", async () => {
    const future = await insertMonitor({
      next_crawl_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const canceled = await insertMonitor({ status: "canceled" });
    expect(await startDueMonitorCrawls(sql)).toBe(0);
    expect((await monitorRow(future)).pending_check_id).toBeNull();
    expect((await monitorRow(canceled)).pending_check_id).toBeNull();
  });
});

describePg("phase B — harvestFinishedMonitorCrawls", () => {
  test("baseline: first complete crawl advances both check pointers and reschedules +7d", async () => {
    const id = await insertMonitor();
    await startDueMonitorCrawls(sql);
    const pending = (await monitorRow(id)).pending_check_id as string;
    await terminalizeCheck(pending, "complete", [orphanFinding]);

    expect(await harvestFinishedMonitorCrawls(sql)).toBe(1);
    const m = await monitorRow(id);
    expect(m.pending_check_id).toBeNull();
    expect(m.last_check_id).toBe(pending);
    expect(m.last_complete_check_id).toBe(pending);
    expect(m.email_attempts).toBe(0);
    const days = (new Date(m.next_crawl_at as string).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    // A fresh report token was minted for the email.
    const tokens = (await sql`
      select count(*)::int as n from public.crawl_report_tokens
      where check_id = ${pending} and requester_ip_hash = ${"monitor:" + id}
    `) as unknown as Array<{ n: number }>;
    expect(tokens[0]!.n).toBe(1);
  });

  test("failed crawl advances the schedule but NOT the complete baseline", async () => {
    const id = await insertMonitor();
    await startDueMonitorCrawls(sql);
    const pending = (await monitorRow(id)).pending_check_id as string;
    await terminalizeCheck(pending, "failed", []);

    await harvestFinishedMonitorCrawls(sql);
    const m = await monitorRow(id);
    expect(m.last_check_id).toBe(pending);
    expect(m.last_complete_check_id).toBeNull(); // never diff against a failure
    expect(m.pending_check_id).toBeNull();
  });

  test("non-terminal pending is left alone (crash-safe: nothing advances)", async () => {
    const id = await insertMonitor();
    await startDueMonitorCrawls(sql);
    expect(await harvestFinishedMonitorCrawls(sql)).toBe(0);
    const m = await monitorRow(id);
    expect(m.pending_check_id).toBeTruthy();
    expect(m.last_check_id).toBeNull();
  });
});

describePg("claim priority", () => {
  test("monitor-source checks claim ahead of OLDER free checks", async () => {
    await sql`
      insert into public.crawl_checks (domain, origin, requester_ip_hash, source, created_at)
      values (${"free-first." + DOMAIN}, ${"https://free-first." + DOMAIN}, 'h', 'free', now() - interval '1 hour')
    `;
    await sql`
      insert into public.crawl_checks (domain, origin, requester_ip_hash, source)
      values (${"paid-second." + DOMAIN}, ${"https://paid-second." + DOMAIN}, 'h', 'monitor')
    `;
    const claimed = await claimCrawlCheck(sql);
    expect(claimed?.domain).toBe(`paid-second.${DOMAIN}`);
  });
});
