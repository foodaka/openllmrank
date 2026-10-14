// Integration tests for POST /api/runs (manual re-run). Skips cleanly when
// local Supabase is not reachable. Sessions are built the way the app does
// it: sign in with the anon key, then present the session cookies to the
// route via next/headers, which we shim through a request-scoped store.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54331";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PG_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54332/postgres";

async function pgReachable(): Promise<boolean> {
  try {
    const probe = new SQL(PG_URL);
    await probe`select 1 from public.subscriptions limit 1`;
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const enabled = Boolean(ANON_KEY && SERVICE_KEY && (await pgReachable()));
const describePg = enabled ? describe : describe.skip;
if (!enabled) {
  console.warn("[runs-api.test] Skipping: local Supabase and auth keys are required.");
}
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.MANUAL_RERUNS_PER_MONTH = "2";

// next/headers cookies() shim: the route reads the session from cookies, so
// each test sets the cookie jar it wants before calling POST.
type Cookie = { name: string; value: string };
let jar: Cookie[] = [];
import { mock } from "bun:test";
mock.module("next/headers", () => ({
  cookies: async () => ({
    getAll: () => jar.map((c) => ({ ...c })),
    set: (name: string, value: string) => {
      jar = jar.filter((c) => c.name !== name).concat({ name, value });
    },
  }),
}));

const config = {
  brand: { name: "RerunCo", aliases: [] },
  competitors: [{ name: "RivalCo", aliases: [] }],
  prompts: ["best re-run tool for tests"],
  providers: [{ id: "openai", model: "gpt-4o-mini" }],
  samples_per_prompt: 3,
  concurrency_per_provider: 4,
};

let sql: SQL;
let post: (req: Request) => Promise<Response>;
const admin = enabled
  ? createClient(SUPABASE_URL, SERVICE_KEY!, { auth: { persistSession: false } })
  : null;

type User = { id: string; email: string; password: string };
const users: User[] = [];

async function makeUser(label: string): Promise<User> {
  const email = `runs-${label}-${crypto.randomUUID()}@example.com`;
  const password = "runs-test-password-1";
  const { data, error } = await admin!.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("no user");
  const u = { id: data.user.id, email, password };
  users.push(u);
  return u;
}

async function signIn(u: User): Promise<void> {
  // Build the cookie the @supabase/ssr server client expects by letting a
  // real ssr client write it into our jar.
  const { createServerClient } = await import("@supabase/ssr");
  jar = [];
  const client = createServerClient(SUPABASE_URL, ANON_KEY!, {
    cookies: {
      getAll: () => jar.map((c) => ({ ...c })),
      setAll: (set) => {
        for (const { name, value } of set) {
          jar = jar.filter((c) => c.name !== name).concat({ name, value });
        }
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({
    email: u.email,
    password: u.password,
  });
  if (error) throw error;
}

async function brandFor(u: User, withConfig = true): Promise<string> {
  const { data, error } = await admin!
    .from("brands")
    .insert({
      user_id: u.id,
      name: "RerunCo",
      aliases: [],
      cadence: "weekly",
      config_jsonb: withConfig ? config : null,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no brand");
  return data.id as string;
}

async function subscribe(u: User, status = "active"): Promise<void> {
  const { error } = await admin!.from("subscriptions").insert({
    user_id: u.id,
    stripe_subscription_id: `sub_runs_${crypto.randomUUID()}`,
    stripe_customer_id: "cus_runs",
    status,
    current_period_end: new Date(Date.now() + 10 * 86_400_000).toISOString(),
  });
  if (error) throw error;
}

function call(brandId: string | null, accept = "application/json"): Promise<Response> {
  return post(
    new Request("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json", accept },
      body: JSON.stringify(brandId ? { brand_id: brandId } : {}),
    }),
  );
}

beforeAll(async () => {
  if (!enabled) return;
  sql = new SQL(PG_URL);
  post = (await import("../app/api/runs/route")).POST;
});

afterAll(async () => {
  if (!enabled) return;
  for (const u of users) {
    await sql`delete from auth.users where id = ${u.id}`;
  }
  await sql.end();
});

describePg("POST /api/runs", () => {
  test("401 without a session", async () => {
    jar = [];
    const res = await call(crypto.randomUUID());
    expect(res.status).toBe(401);
  });

  test("404 for another user's brand, even with an active subscription", async () => {
    const owner = await makeUser("owner");
    const intruder = await makeUser("intruder");
    const brandId = await brandFor(owner);
    await subscribe(intruder);
    await signIn(intruder);
    const res = await call(brandId);
    expect(res.status).toBe(404);
  });

  test("402 without an active subscription", async () => {
    const u = await makeUser("nosub");
    const brandId = await brandFor(u);
    await signIn(u);
    const res = await call(brandId);
    expect(res.status).toBe(402);
  });

  test("400 when the brand has no tracking config", async () => {
    const u = await makeUser("noconfig");
    const brandId = await brandFor(u, false);
    await subscribe(u);
    await signIn(u);
    const res = await call(brandId);
    expect(res.status).toBe(400);
  });

  test("creates a manual job, then 409 while it is in flight, then 429 past the quota", async () => {
    const u = await makeUser("quota");
    const brandId = await brandFor(u);
    await subscribe(u);
    await signIn(u);

    const first = await call(brandId);
    expect(first.status).toBe(201);
    const { job_id } = (await first.json()) as { job_id: string };
    const rows = (await sql`
      select origin, status, amount_cents, email_to from public.jobs where id = ${job_id}
    `) as unknown as Array<{ origin: string; status: string; amount_cents: number; email_to: string }>;
    expect(rows[0]).toMatchObject({ origin: "manual", status: "paid", amount_cents: 0, email_to: u.email });

    const inFlight = await call(brandId);
    expect(inFlight.status).toBe(409);

    await sql`update public.jobs set status = 'completed' where id = ${job_id}`;
    const second = await call(brandId);
    expect(second.status).toBe(201);
    const secondId = ((await second.json()) as { job_id: string }).job_id;
    // First run kept full depth; a re-run after a completed run uses two samples.
    const depths = (await sql`
      select id, (config_jsonb->>'samples_per_prompt')::int as samples from public.jobs where id in (${job_id}, ${secondId})
    `) as unknown as Array<{ id: string; samples: number }>;
    expect(depths.find((d) => d.id === job_id)!.samples).toBe(3);
    expect(depths.find((d) => d.id === secondId)!.samples).toBe(2);
    await sql`update public.jobs set status = 'completed' where id = ${secondId}`;

    const third = await call(brandId);
    expect(third.status).toBe(429);
  });

  test("form posts redirect back to the brand page", async () => {
    const u = await makeUser("form");
    const brandId = await brandFor(u);
    await subscribe(u);
    await signIn(u);
    const form = new URLSearchParams({ brand_id: brandId });
    const res = await post(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`http://localhost/dashboard/${brandId}?queued=1`);
  });
});
