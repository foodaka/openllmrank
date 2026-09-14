// Integration tests for the crawl-check API routes, invoked as plain
// functions against local Supabase. Skips cleanly when the local stack or
// env is missing. The worker side of the loop is covered by
// packages/worker/test/crawl-queue.test.ts; here we simulate the worker's
// writes with the service client and assert the requester-facing contract:
// quotas, dedupe-with-fresh-token (privacy model 7A), poll payload states.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SQL } from "bun";

// Load web env exactly like next dev would (without clobbering real env).
const envPath = join(import.meta.dir, "..", ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

const PG_URL = `postgresql://postgres:postgres@${process.env.SUPABASE_TEST_HOST ?? "127.0.0.1"}:${process.env.SUPABASE_TEST_PORT ?? "54332"}/postgres`;

async function ready(): Promise<boolean> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return false;
  }
  try {
    const probe = new SQL(PG_URL);
    await probe`select 1 from public.crawl_checks limit 1`;
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const reachable = await ready();
const describePg = reachable ? describe : describe.skip;
if (!reachable) {
  console.warn(
    "[crawl-check-api.test] Skipping: local Supabase or web .env.local not available.",
  );
}

// Import AFTER env is loaded — the routes read process.env lazily.
const { POST } = await import("../app/api/crawl-check/route");
const { GET } = await import("../app/api/crawl-check/[token]/route");

let sql: SQL;
const TEST_DOMAIN = "crawlapi-test.example";

// Unique IP per call by default: the in-memory burst limiter has no reset
// hook, and a shared default IP made tests order-dependent (429 cascade once
// the file grew past 10 posts/minute — review finding).
let ipCounter = 0;
function post(body: unknown, ip = `203.0.113.${20 + (ipCounter++ % 200)}`): Promise<Response> {
  return POST(
    new Request("http://localhost/api/crawl-check", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

function get(token: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/crawl-check/${token}`), {
    params: { token },
  });
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
  await sql`delete from public.crawl_checks where domain like ${"%" + TEST_DOMAIN}`;
});

describePg("POST /api/crawl-check", () => {
  test("rejects garbage bodies and non-domains", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ domain: "localhost" })).status).toBe(400);
    expect((await post({ domain: "not a domain" })).status).toBe(400);
    expect((await post({ domain: "https://user:pw@x.com" })).status).toBe(400);
  });

  test("inserts a queued check and mints a token", async () => {
    const res = await post({ domain: TEST_DOMAIN });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; deduped: boolean };
    expect(body.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.deduped).toBe(false);

    const rows = (await sql`
      select state, domain, origin from public.crawl_checks where domain = ${TEST_DOMAIN}
    `) as unknown as Array<{ state: string; domain: string; origin: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe("queued");
    expect(rows[0]!.origin).toBe(`https://${TEST_DOMAIN}`);
  });

  test("dedupe reuses the crawl but mints a FRESH token per requester (7A)", async () => {
    const first = (await (await post({ domain: TEST_DOMAIN }, "203.0.113.1")).json()) as {
      token: string;
    };
    const second = (await (await post({ domain: TEST_DOMAIN }, "198.51.100.2")).json()) as {
      token: string;
      deduped: boolean;
    };
    expect(second.deduped).toBe(true);
    // Different requester → different URL; same underlying crawl row.
    expect(second.token).not.toBe(first.token);
    const rows = (await sql`
      select count(*)::int as n from public.crawl_checks where domain = ${TEST_DOMAIN}
    `) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1);
  });

  async function terminalize(domain: string): Promise<void> {
    await sql`
      update public.crawl_checks set state = 'complete', finished_at = now()
      where domain = ${domain} and state in ('queued', 'running')
    `;
  }

  test("force=true re-crawls once the prior crawl is terminal", async () => {
    await post({ domain: TEST_DOMAIN });
    await terminalize(TEST_DOMAIN);
    const res = await post({ domain: TEST_DOMAIN, force: true });
    expect(((await res.json()) as { deduped: boolean }).deduped).toBe(false);
    const rows = (await sql`
      select count(*)::int as n from public.crawl_checks where domain = ${TEST_DOMAIN}
    `) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(2);
  });

  test("force while a crawl is ACTIVE joins it instead of double-crawling (DB race guard)", async () => {
    await post({ domain: TEST_DOMAIN });
    const res = await post({ domain: TEST_DOMAIN, force: true }, "198.51.100.9");
    const body = (await res.json()) as { token?: string; deduped?: boolean; error?: string };
    // Either outcome is a non-duplicate: deduped onto the active crawl, or a
    // 409 asking to retry — never a second active row for the same domain.
    const rows = (await sql`
      select count(*)::int as n from public.crawl_checks
      where domain = ${TEST_DOMAIN} and state in ('queued','running')
    `) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1);
    expect(res.status === 409 || body.token !== undefined).toBe(true);
  });

  test("per-domain daily crawl cap returns 429", async () => {
    for (let i = 0; i < 5; i++) {
      await post({ domain: TEST_DOMAIN, force: true }, `203.0.113.${10 + i}`);
      await terminalize(TEST_DOMAIN);
    }
    const res = await post({ domain: TEST_DOMAIN, force: true }, "203.0.113.99");
    expect(res.status).toBe(429);
  });
});

describePg("GET /api/crawl-check/[token]", () => {
  test("404 for malformed and unknown tokens", async () => {
    expect((await get("not-a-uuid")).status).toBe(404);
    expect((await get("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  test("queued → running → terminal payloads, worker writes simulated", async () => {
    const { token } = (await (await post({ domain: TEST_DOMAIN })).json()) as {
      token: string;
    };

    let body = (await (await get(token)).json()) as Record<string, unknown>;
    expect(body.state).toBe("queued");
    expect(body.fix_prompt).toBeNull();

    // Simulate the worker finishing with one headline finding.
    const phase1 = {
      schema_version: 1,
      robots_txt_found: true,
      robots_blocks_all: false,
      sitemap_urls: [`https://${TEST_DOMAIN}/ghost`],
      sitemap_found: true,
      bot_access: [],
    };
    const findings = [
      {
        type: "orphan_page",
        url: `https://${TEST_DOMAIN}/ghost`,
        severity: "critical",
        tier: "headline",
      },
    ];
    await sql`
      update public.crawl_checks
      set state = 'complete', phase1_jsonb = ${phase1 as unknown as Record<string, unknown>},
          findings_jsonb = ${findings as unknown as Record<string, unknown>[]},
          pages_crawled = 3, pages_discovered = 3, finished_at = now()
      where domain = ${TEST_DOMAIN}
    `;

    body = (await (await get(token)).json()) as Record<string, unknown>;
    expect(body.state).toBe("complete");
    expect((body.findings as unknown[]).length).toBe(1);
    // Fix prompt generated server-side, fenced.
    expect(body.fix_prompt as string).toContain("untrusted-crawl-findings");
    expect(body.superseded).toBe(false);
  });

  test("delisted reports return 410, newer crawls mark older ones superseded", async () => {
    const { token } = (await (await post({ domain: TEST_DOMAIN })).json()) as {
      token: string;
    };
    await sql`
      update public.crawl_checks set state = 'complete', finished_at = now()
      where domain = ${TEST_DOMAIN}
    `;

    // A newer terminal crawl of the same domain supersedes the first.
    const second = (await (await post({ domain: TEST_DOMAIN, force: true })).json()) as {
      token: string;
    };
    await sql`
      update public.crawl_checks set state = 'complete', finished_at = now()
      where domain = ${TEST_DOMAIN} and state = 'queued'
    `;
    const older = (await (await get(token)).json()) as { superseded: boolean };
    expect(older.superseded).toBe(true);
    const newer = (await (await get(second.token)).json()) as { superseded: boolean };
    expect(newer.superseded).toBe(false);

    // Delisting kills public access with an honest message.
    await sql`update public.crawl_checks set delisted = true where domain = ${TEST_DOMAIN}`;
    expect((await get(token)).status).toBe(410);
  });
});
