#!/usr/bin/env bun
/**
 * Proves the dashboard's tenancy story holds at the database, not in page
 * code: sign in as the demo user with the ANON key and confirm RLS returns
 * their rows and only their rows.
 *
 * The second half is the one that matters. It creates a throwaway second
 * user and checks that user B sees zero of user A's brands, runs, and
 * metrics — the exact failure a dashboard built on serviceClient() would
 * have shipped silently.
 *
 *   bun run --cwd packages/web verify:rls
 */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const DEMO_EMAIL = "demo@openllmrank.io";
const DEMO_PASSWORD = "demo-password-123";
const INTRUDER_EMAIL = "intruder@example.test";
const INTRUDER_PASSWORD = "intruder-password-123";

let failures = 0;

function check(label: string, pass: boolean, detail = "") {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

async function main() {
  // --- as the demo user -----------------------------------------------
  const demo = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: signInErr } = await demo.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (signInErr) throw new Error(`demo sign-in: ${signInErr.message}`);

  console.log("\nAs demo@openllmrank.io (anon key + session, RLS active):");

  const { data: brands } = await demo.from("brands").select("id,name,cadence");
  check("sees own brands", (brands?.length ?? 0) === 3, `${brands?.length ?? 0} brands`);

  const { data: metrics } = await demo.from("run_metrics").select("run_id");
  check("sees own run_metrics", (metrics?.length ?? 0) === 20, `${metrics?.length ?? 0} rows`);

  const { data: sub } = await demo.from("subscriptions").select("status");
  check("sees own subscription", sub?.[0]?.status === "active", sub?.[0]?.status ?? "none");

  const { data: jobs } = await demo.from("jobs").select("id,origin");
  check("sees own jobs", (jobs?.length ?? 0) === 20, `${jobs?.length ?? 0} jobs`);

  const origins = new Set((jobs ?? []).map((j) => j.origin));
  check(
    "job origins seeded",
    origins.has("one_shot") && origins.has("scheduled") && origins.has("manual"),
    [...origins].join(", "),
  );

  // --- as a different user --------------------------------------------
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const { data: made } = await admin.auth.admin.createUser({
    email: INTRUDER_EMAIL,
    password: INTRUDER_PASSWORD,
    email_confirm: true,
  });
  let intruderId = made?.user?.id;
  if (!intruderId) {
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    intruderId = list?.users.find((u) => u.email === INTRUDER_EMAIL)?.id;
  }

  const intruder = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: intruderErr } = await intruder.auth.signInWithPassword({
    email: INTRUDER_EMAIL,
    password: INTRUDER_PASSWORD,
  });
  if (intruderErr) throw new Error(`intruder sign-in: ${intruderErr.message}`);

  console.log("\nAs a second user (cross-tenant isolation):");

  const { data: xBrands } = await intruder.from("brands").select("id");
  check("sees no other-user brands", (xBrands?.length ?? 0) === 0, `${xBrands?.length ?? 0} rows`);

  const { data: xMetrics } = await intruder.from("run_metrics").select("run_id");
  check("sees no other-user metrics", (xMetrics?.length ?? 0) === 0, `${xMetrics?.length ?? 0} rows`);

  const { data: xSubs } = await intruder.from("subscriptions").select("status");
  check("sees no other-user subscription", (xSubs?.length ?? 0) === 0, `${xSubs?.length ?? 0} rows`);

  // Targeted read: knowing the exact primary key must not help.
  const targetBrand = brands?.[0]?.id;
  if (targetBrand) {
    const { data: direct } = await intruder
      .from("brands")
      .select("id,name")
      .eq("id", targetBrand);
    check(
      "direct-by-id read of another tenant's brand returns nothing",
      (direct?.length ?? 0) === 0,
      `${direct?.length ?? 0} rows`,
    );
  }

  // Cleanup.
  if (intruderId) await admin.auth.admin.deleteUser(intruderId);

  console.log(
    failures === 0
      ? "\nAll RLS checks passed.\n"
      : `\n${failures} check(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nverify-rls failed: ${(e as Error).message}`);
  process.exit(1);
});
