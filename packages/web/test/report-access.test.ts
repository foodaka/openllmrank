// Integration tests for report link access control (E2). Skips cleanly when
// local Supabase is not reachable.

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { createClient } from "@supabase/supabase-js";
import { signReportToken } from "@openllmrank/shared/report-token";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54331";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PG_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54332/postgres";
const SECRET = "report-access-test-secret-0123456789";

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
  console.warn("[report-access.test] Skipping: local Supabase and auth keys are required.");
}
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.REPORT_LINK_SECRET = SECRET;

type Cookie = { name: string; value: string };
let jar: Cookie[] = [];
mock.module("next/headers", () => ({
  cookies: async () => ({
    getAll: () => jar.map((c) => ({ ...c })),
    set: (name: string, value: string) => {
      jar = jar.filter((c) => c.name !== name).concat({ name, value });
    },
  }),
}));

const config = {
  brand: { name: "AccessCo", aliases: [] },
  competitors: [{ name: "RivalCo", aliases: [] }],
  prompts: ["best access-control tool for tests"],
  providers: [{ id: "openai", model: "gpt-4o-mini" }],
  samples_per_prompt: 3,
  concurrency_per_provider: 4,
};

let sql: SQL;
let get: (req: Request, ctx: { params: { id: string } }) => Promise<Response>;
const admin = enabled
  ? createClient(SUPABASE_URL, SERVICE_KEY!, { auth: { persistSession: false } })
  : null;

type User = { id: string; email: string; password: string };
const users: User[] = [];

async function makeUser(label: string): Promise<User> {
  const email = `access-${label}-${crypto.randomUUID()}@example.com`;
  const password = "access-test-password-1";
  const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("no user");
  const u = { id: data.user.id, email, password };
  users.push(u);
  return u;
}

async function signIn(u: User | null): Promise<void> {
  jar = [];
  if (!u) return;
  const { createServerClient } = await import("@supabase/ssr");
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
  const { error } = await client.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw error;
}

/** A completed job whose report can render (the run has no calls, so the
 * page renders its empty chrome, which is enough to prove access). */
async function completedJob(u: User, graceDaysFromNow: number | null): Promise<string> {
  const brand = (await sql`
    insert into public.brands (user_id, name) values (${u.id}, 'AccessCo') returning id
  `) as unknown as Array<{ id: string }>;
  const expires =
    graceDaysFromNow === null
      ? null
      : new Date(Date.now() + graceDaysFromNow * 86_400_000).toISOString();
  const cliRunId = "run_" + crypto.randomUUID();
  const job = (await sql`
    insert into public.jobs (user_id, brand_id, status, config_jsonb, amount_cents, email_to,
                             cli_run_id, succeeded_at, succeeded_count, failed_count, report_link_expires_at)
    values (${u.id}, ${brand[0]!.id}, 'completed', ${config}, 2999, ${u.email},
            ${cliRunId}, now(), 1, 0, ${expires})
    returning id
  `) as unknown as Array<{ id: string }>;
  await sql`
    insert into public.runs (user_id, brand_id, job_id, cli_run_id, started_at, finished_at, config_hash)
    values (${u.id}, ${brand[0]!.id}, ${job[0]!.id}, ${cliRunId}, now(), now(), 'access-test-hash')
  `;
  return job[0]!.id;
}

function fetchReport(id: string, token?: string): Promise<Response> {
  const url = `http://localhost/reports/${id}${token ? `?t=${encodeURIComponent(token)}` : ""}`;
  return get(new Request(url), { params: { id } });
}

beforeAll(async () => {
  if (!enabled) return;
  sql = new SQL(PG_URL);
  get = (await import("../app/reports/[id]/route")).GET as typeof get;
});

afterAll(async () => {
  if (!enabled) return;
  for (const u of users) await sql`delete from auth.users where id = ${u.id}`;
  await sql.end();
});

describePg("GET /reports/[id] access control", () => {
  test("a valid token renders without a session", async () => {
    const u = await makeUser("token");
    const id = await completedJob(u, null);
    await signIn(null);
    const res = await fetchReport(id, signReportToken(id, SECRET));
    expect(res.status).toBe(200);
  });

  test("an expired token, a wrong-secret token, and a token for another job are refused", async () => {
    const u = await makeUser("badtoken");
    const id = await completedJob(u, null);
    const other = await completedJob(u, null);
    await signIn(null);
    expect((await fetchReport(id, signReportToken(id, SECRET, 60, Date.now() - 120_000))).status).toBe(401);
    expect((await fetchReport(id, signReportToken(id, "some-other-secret-0123456789"))).status).toBe(401);
    expect((await fetchReport(id, signReportToken(other, SECRET))).status).toBe(401);
  });

  test("the owner's session renders; another user's session is refused", async () => {
    const owner = await makeUser("owner");
    const intruder = await makeUser("intruder");
    const id = await completedJob(owner, null);
    await signIn(owner);
    expect((await fetchReport(id)).status).toBe(200);
    await signIn(intruder);
    expect((await fetchReport(id)).status).toBe(401);
  });

  test("a bare link works inside the legacy grace window and not after", async () => {
    const u = await makeUser("grace");
    const inside = await completedJob(u, 30);
    const past = await completedJob(u, -1);
    await signIn(null);
    expect((await fetchReport(inside)).status).toBe(200);
    const res = await fetchReport(past);
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain("This link has expired.");
    expect(html).toContain(`/login?next=${encodeURIComponent(`/reports/${past}`)}`);
    expect(html).not.toContain("AccessCo");
  });

  test("an unknown id is a 404, not a 401", async () => {
    await signIn(null);
    expect((await fetchReport(crypto.randomUUID())).status).toBe(404);
  });
});
