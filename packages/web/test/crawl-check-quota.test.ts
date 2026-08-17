// Quota/edge branches of POST /api/crawl-check not covered by
// crawl-check-api.test.ts: the per-IP daily submission cap (counted on
// crawl_report_tokens, checked BEFORE dedupe) and the malformed-JSON 400.
// Same DB-gated pattern as the sibling test; skips cleanly without Supabase.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
    "[crawl-check-quota.test] Skipping: local Supabase or web .env.local not available.",
  );
}

// Import AFTER env is loaded — the routes read process.env lazily.
const { POST } = await import("../app/api/crawl-check/route");
const { hashIp, SUBMISSIONS_PER_IP_PER_DAY } = await import("../lib/crawl-check");

const TEST_DOMAIN = "crawlquota-test.example";
// IPs deliberately distinct from crawl-check-api.test.ts — the in-memory
// burst limiter is per-process and keyed by IP.
const QUOTA_IP = "198.51.100.200";

let sql: SQL;

beforeAll(async () => {
  if (!reachable) return;
  sql = new SQL(PG_URL);
  await sql`delete from public.crawl_checks where domain = ${TEST_DOMAIN}`;
});

afterAll(async () => {
  if (!reachable) return;
  await sql`delete from public.crawl_checks where domain = ${TEST_DOMAIN}`;
  await sql.end();
});

function post(body: BodyInit, ip: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/crawl-check", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body,
    }),
  );
}

describePg("POST /api/crawl-check quota + body edges", () => {
  test("malformed (non-JSON) body returns 400, not a crash", async () => {
    const res = await post("this is not json {", "198.51.100.201");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("JSON");
  });

  test("per-IP daily submission cap returns 429 before dedupe can mint a token", async () => {
    // Seed one crawl row + SUBMISSIONS_PER_IP_PER_DAY tokens for this IP,
    // exactly what 10 prior submissions would have left behind.
    const rows = (await sql`
      insert into public.crawl_checks (domain, origin, requester_ip_hash)
      values (${TEST_DOMAIN}, ${`https://${TEST_DOMAIN}`}, ${hashIp(QUOTA_IP)})
      returning id
    `) as unknown as Array<{ id: string }>;
    const checkId = rows[0]!.id;
    for (let i = 0; i < SUBMISSIONS_PER_IP_PER_DAY; i++) {
      await sql`
        insert into public.crawl_report_tokens (check_id, requester_ip_hash)
        values (${checkId}, ${hashIp(QUOTA_IP)})
      `;
    }

    const res = await post(JSON.stringify({ domain: TEST_DOMAIN }), QUOTA_IP);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Daily limit");

    // No new token was minted for the over-quota request.
    const count = (await sql`
      select count(*)::int as n from public.crawl_report_tokens
      where requester_ip_hash = ${hashIp(QUOTA_IP)}
    `) as unknown as Array<{ n: number }>;
    expect(count[0]!.n).toBe(SUBMISSIONS_PER_IP_PER_DAY);
  });
});
