import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { SQL } from "bun";

// These tests run against the local Supabase Postgres started via
// `supabase start`. Default port (after our +10 shift) is 54332.
//
// Two test families:
//   1. Meta-test: structurally enforce that every public table has RLS
//      enabled AND has at least one policy. Catches "added a table, forgot
//      a policy" PRs before they ship.
//   2. Per-table RLS isolation: insert data as user A and user B (using
//      service_role to bypass RLS during setup), then switch to the
//      `authenticated` role with each user's claims and verify zero
//      cross-tenant visibility.

const PG_HOST = process.env.SUPABASE_TEST_HOST ?? "127.0.0.1";
const PG_PORT = process.env.SUPABASE_TEST_PORT ?? "54332";
const PG_URL = `postgresql://postgres:postgres@${PG_HOST}:${PG_PORT}/postgres`;

// Tables that store tenant-owned data. RLS isolation must hold for each.
const TENANT_TABLES = [
  "brands",
  "jobs",
  "runs",
  "prompts",
  "calls",
  "citations",
] as const;

// All tables in the public schema we expect to exist.
const ALL_PUBLIC_TABLES = [...TENANT_TABLES, "stripe_events"] as const;

let admin: SQL;

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

// Skip RLS tests entirely if local Supabase isn't running. CI and local
// developers run `supabase start` first; otherwise these tests are noise.
const itPg = reachable ? test : test.skip;
const describePg = reachable ? describe : describe.skip;

if (!reachable) {
  // eslint-disable-next-line no-console
  console.warn(
    `[rls.test] Skipping RLS tests: cannot reach ${PG_URL}. Run 'supabase start' to enable.`,
  );
}

beforeAll(async () => {
  if (!reachable) return;
  admin = new SQL(PG_URL);
});

afterAll(async () => {
  if (!reachable) return;
  await admin.end();
});

describePg("RLS coverage meta-test (every public table)", () => {
  itPg("every public table we expect exists", async () => {
    const rows = await admin`
      select tablename from pg_tables where schemaname = 'public'
    ` as Array<{ tablename: string }>;
    const present = new Set(rows.map((r) => r.tablename));
    for (const t of ALL_PUBLIC_TABLES) {
      expect(present.has(t)).toBe(true);
    }
  });

  itPg("every public table has RLS enabled", async () => {
    const rows = await admin`
      select tablename, rowsecurity from pg_tables where schemaname = 'public'
    ` as Array<{ tablename: string; rowsecurity: boolean }>;
    for (const r of rows) {
      expect(r.rowsecurity).toBe(true);
    }
  });

  itPg("every tenant table has at least one SELECT policy", async () => {
    for (const t of TENANT_TABLES) {
      const rows = await admin`
        select policyname, cmd from pg_policies
        where schemaname = 'public' and tablename = ${t}
      ` as Array<{ policyname: string; cmd: string }>;
      const hasSelectPolicy = rows.some((r) => r.cmd === "SELECT" || r.cmd === "ALL");
      expect(hasSelectPolicy).toBe(true);
    }
  });

  itPg("stripe_events has NO policies (service_role only access)", async () => {
    const rows = await admin`
      select policyname from pg_policies
      where schemaname = 'public' and tablename = 'stripe_events'
    ` as Array<{ policyname: string }>;
    // RLS is on; no policies means no role except postgres/service_role can
    // touch this table. That's the intent: webhook idempotency log is
    // server-internal.
    expect(rows.length).toBe(0);
  });
});

describePg("RLS isolation: cross-tenant data is invisible", () => {
  // Setup two fake users + brands as service_role, then verify isolation.
  let userA = "";
  let userB = "";
  let brandA = "";
  let brandB = "";

  beforeAll(async () => {
    if (!reachable) return;

    // Clean up from any previous run
    await admin`delete from auth.users where email like 'rls-test-%@example.com'`;

    const a = await admin`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
      values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'rls-test-a@example.com', '$2a$10$fake', now())
      returning id
    ` as Array<{ id: string }>;
    userA = a[0]!.id;

    const b = await admin`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
      values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'rls-test-b@example.com', '$2a$10$fake', now())
      returning id
    ` as Array<{ id: string }>;
    userB = b[0]!.id;

    const bA = await admin`
      insert into public.brands (user_id, name) values (${userA}, 'Acme A')
      returning id
    ` as Array<{ id: string }>;
    brandA = bA[0]!.id;

    const bB = await admin`
      insert into public.brands (user_id, name) values (${userB}, 'Acme B')
      returning id
    ` as Array<{ id: string }>;
    brandB = bB[0]!.id;

    // Each user gets one job
    await admin`
      insert into public.jobs (user_id, brand_id, config_jsonb, amount_cents, email_to, stripe_checkout_session_id)
      values
        (${userA}, ${brandA}, '{"prompts":["x"]}'::jsonb, 2999, 'a@example.com', 'cs_a'),
        (${userB}, ${brandB}, '{"prompts":["x"]}'::jsonb, 2999, 'b@example.com', 'cs_b')
    `;
  });

  afterAll(async () => {
    if (!reachable) return;
    await admin`delete from auth.users where email like 'rls-test-%@example.com'`;
  });

  // Helper: run a query as `authenticated` with the given user's JWT claims
  // inside a single transaction. Returns the SELECT result. Throws on any
  // SQL error (e.g. RLS rejection) — we use that as the assertion signal.
  async function asAuthenticated<T>(
    userId: string,
    fn: (tx: SQL) => Promise<T>,
  ): Promise<T> {
    return await admin.begin(async (tx) => {
      const claims = JSON.stringify({ sub: userId, role: "authenticated" });
      await tx.unsafe(`set local role authenticated`);
      await tx.unsafe(`set local request.jwt.claims = '${claims}'`);
      return await fn(tx as unknown as SQL);
    }) as T;
  }

  for (const tbl of ["brands", "jobs"] as const) {
    itPg(`user A sees only their own ${tbl} via RLS`, async () => {
      const rows = (await asAuthenticated(userA, async (tx) => {
        return await tx.unsafe(`select user_id from public.${tbl}`);
      })) as Array<{ user_id: string }>;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.every((r) => r.user_id === userA)).toBe(true);
    });

    itPg(`user B sees only their own ${tbl} via RLS`, async () => {
      const rows = (await asAuthenticated(userB, async (tx) => {
        return await tx.unsafe(`select user_id from public.${tbl}`);
      })) as Array<{ user_id: string }>;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.every((r) => r.user_id === userB)).toBe(true);
    });
  }

  itPg("authenticated user cannot read stripe_events (service-only table)", async () => {
    const rows = (await asAuthenticated(userA, async (tx) => {
      return await tx.unsafe(
        `select count(*)::int as n from public.stripe_events`,
      );
    })) as Array<{ n: number }>;
    // With RLS on and zero policies for non-service roles, the visible row
    // count is always 0 regardless of what's actually in the table.
    expect(rows[0]?.n ?? 0).toBe(0);
  });

  itPg("authenticated user cannot INSERT a brand for another user", async () => {
    // user A tries to insert a brand owned by user B; RLS WITH CHECK should
    // reject it with a Postgres error.
    let threw = false;
    try {
      await asAuthenticated(userA, async (tx) => {
        await tx.unsafe(
          `insert into public.brands (user_id, name) values ('${userB}', 'malicious')`,
        );
      });
    } catch (e) {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
