// Integration tests for the FREE crawl-check queue against local Supabase.
// Skips cleanly when localhost:54332 is unreachable. Mirrors queue.test.ts.
//
// The regression guard for the paid queue is queue.test.ts itself — these
// tables are disjoint by design (eng review decision 2A).

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import {
  claimCrawlCheck,
  failCrawl,
  finishCrawl,
  writePhase1,
  writeProgress,
} from "../src/crawl-queue";
import { SCHEMA_VERSION, type CrawlResult, type Phase1 } from "@openllmrank/crawl";

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

if (!reachable) {
  console.warn(
    `[crawl-queue.test] Skipping: cannot reach ${PG_URL}. Run 'supabase start' to enable.`,
  );
}

let sql: SQL;

const phase1: Phase1 = {
  schema_version: SCHEMA_VERSION,
  robots_txt_found: true,
  robots_blocks_all: false,
  sitemap_urls: ["https://crawl-test.example/a"],
  sitemap_found: true,
  bot_access: [],
};

function fakeResult(state: CrawlResult["state"]): CrawlResult {
  return {
    schema_version: SCHEMA_VERSION,
    domain: "crawl-test.example",
    state,
    failure_reason: state === "failed" ? "site unreachable" : null,
    pages_crawled: 3,
    pages_discovered: 4,
    phase1,
    findings: [
      { type: "orphan_page", url: "https://crawl-test.example/a", severity: "critical", tier: "headline" },
    ],
  };
}

async function insertQueued(domain = "crawl-test.example"): Promise<string> {
  const rows = (await sql`
    insert into public.crawl_checks (domain, origin, requester_ip_hash)
    values (${domain}, ${"https://" + domain}, 'testhash')
    returning id
  `) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
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
  await sql`delete from public.crawl_checks where domain like '%crawl-test.example'`;
  // Isolation (review finding): claimCrawlCheck picks the globally oldest
  // claimable row, so ANY foreign queued/stale-running row (dev usage, other
  // test files) makes these tests flaky. Crawl rows are ephemeral local-dev
  // data — clear every claimable row so claims are deterministic.
  await sql`
    delete from public.crawl_checks
    where state = 'queued'
       or (state = 'running' and claimed_at < now() - interval '30 minutes')
  `;
});

describePg("claimCrawlCheck", () => {
  test("returns null when nothing is queued", async () => {
    expect(await claimCrawlCheck(sql)).toBeNull();
  });

  test("claims a queued check and marks it running", async () => {
    const id = await insertQueued();
    const claimed = await claimCrawlCheck(sql);
    expect(claimed?.id).toBe(id);
    expect(claimed?.attempts).toBe(1);

    const rows = (await sql`
      select state, claimed_by from public.crawl_checks where id = ${id}
    `) as unknown as Array<{ state: string; claimed_by: string }>;
    expect(rows[0]!.state).toBe("running");
    expect(rows[0]!.claimed_by).toBeTruthy();
  });

  test("concurrent claims never double-pick", async () => {
    await insertQueued("a.crawl-test.example");
    await insertQueued("b.crawl-test.example");
    const [c1, c2, c3] = await Promise.all([
      claimCrawlCheck(sql),
      claimCrawlCheck(sql),
      claimCrawlCheck(sql),
    ]);
    const ids = [c1, c2, c3].filter(Boolean).map((c) => c!.id);
    expect(new Set(ids).size).toBe(ids.length); // no dupes
    expect(ids.length).toBe(2);
  });

  test("reclaims a stale running check whose lease expired", async () => {
    const id = await insertQueued();
    await sql`
      update public.crawl_checks
      set state = 'running', claimed_at = now() - interval '2 hours', attempts = 1
      where id = ${id}
    `;
    const claimed = await claimCrawlCheck(sql);
    expect(claimed?.id).toBe(id);
    expect(claimed?.attempts).toBe(2);
  });

  test("terminal rows are never claimed (frozen snapshots)", async () => {
    const id = await insertQueued();
    const claimed = await claimCrawlCheck(sql);
    expect(claimed?.id).toBe(id);
    await finishCrawl(sql, id, fakeResult("complete"));
    expect(await claimCrawlCheck(sql)).toBeNull();
  });
});

describePg("crawl check lifecycle writes", () => {
  test("phase1 → progress → finish lands the full snapshot", async () => {
    const id = await insertQueued();
    await claimCrawlCheck(sql);

    await writePhase1(sql, id, phase1);
    await writeProgress(sql, id, { pages_crawled: 2, pages_discovered: 4 });
    await finishCrawl(sql, id, fakeResult("partial"));

    const rows = (await sql`
      select state, phase1_jsonb, findings_jsonb, pages_crawled, pages_discovered, finished_at
      from public.crawl_checks where id = ${id}
    `) as unknown as Array<{
      state: string;
      phase1_jsonb: Phase1;
      findings_jsonb: unknown[];
      pages_crawled: number;
      pages_discovered: number;
      finished_at: string | null;
    }>;
    const row = rows[0]!;
    expect(row.state).toBe("partial");
    expect(row.phase1_jsonb.sitemap_found).toBe(true);
    expect(row.findings_jsonb).toHaveLength(1);
    expect(row.pages_crawled).toBe(3);
    expect(row.finished_at).toBeTruthy();
  });

  test("failCrawl requeues on first attempt, terminally fails at the cap", async () => {
    const id = await insertQueued();
    const first = await claimCrawlCheck(sql);
    await failCrawl(sql, first!, "boom");

    const afterFirst = (await sql`
      select state from public.crawl_checks where id = ${id}
    `) as unknown as Array<{ state: string }>;
    expect(afterFirst[0]!.state).toBe("queued");

    const second = await claimCrawlCheck(sql);
    expect(second?.attempts).toBe(2);
    await failCrawl(sql, second!, "boom again");

    const afterSecond = (await sql`
      select state, failure_reason from public.crawl_checks where id = ${id}
    `) as unknown as Array<{ state: string; failure_reason: string }>;
    expect(afterSecond[0]!.state).toBe("failed");
    expect(afterSecond[0]!.failure_reason).toContain("boom again");
  });
});
