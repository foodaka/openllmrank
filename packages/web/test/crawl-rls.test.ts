// The crawl tables' access model is "RLS enabled, deliberately ZERO
// policies" — anon must see nothing; all reads go through service-client
// routes. This test pins that posture so a future migration that adds a
// permissive policy (or disables RLS) fails loudly instead of silently
// exposing requester IP hashes (review finding).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SQL } from "bun";

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
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
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
  console.warn("[crawl-rls.test] Skipping: local Supabase or web .env.local not available.");
}

describePg("crawl tables RLS posture", () => {
  let sql: SQL;
  const DOMAIN = "rls-test.example";

  beforeAll(async () => {
    sql = new SQL(PG_URL);
    await sql`delete from public.crawl_checks where domain = ${DOMAIN}`;
    await sql`
      insert into public.crawl_checks (domain, origin, requester_ip_hash, state)
      values (${DOMAIN}, ${"https://" + DOMAIN}, 'rls-probe-hash', 'complete')
    `;
  });

  afterAll(async () => {
    await sql`delete from public.crawl_checks where domain = ${DOMAIN}`;
    await sql.end();
  });

  test("anon role sees zero rows in crawl_checks and crawl_report_tokens", async () => {
    const { anonClient } = await import("../lib/supabase-server");
    const checks = await anonClient().from("crawl_checks").select("id");
    expect(checks.data ?? []).toHaveLength(0);
    const tokens = await anonClient().from("crawl_report_tokens").select("token");
    expect(tokens.data ?? []).toHaveLength(0);
  });

  test("service role can read the same row (sanity check the probe row exists)", async () => {
    const { serviceClient } = await import("../lib/supabase-server");
    const { data } = await serviceClient()
      .from("crawl_checks")
      .select("id")
      .eq("domain", DOMAIN);
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});
