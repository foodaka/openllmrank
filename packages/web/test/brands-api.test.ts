// Integration tests for the brand API (add / edit / archive). Skips cleanly
// when local Supabase is not reachable.

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
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
  console.warn("[brands-api.test] Skipping: local Supabase and auth keys are required.");
}
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.SCHEDULER_WEEKLY_MAX_BRANDS = "2";

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

let sql: SQL;
let post: (req: Request) => Promise<Response>;
let patch: (req: Request, ctx: { params: { brandId: string } }) => Promise<Response>;
let del: (req: Request, ctx: { params: { brandId: string } }) => Promise<Response>;
const admin = enabled
  ? createClient(SUPABASE_URL, SERVICE_KEY!, { auth: { persistSession: false } })
  : null;

type User = { id: string; email: string; password: string };
const users: User[] = [];

async function makeUser(label: string, subscribed = true): Promise<User> {
  const email = `brands-${label}-${crypto.randomUUID()}@example.com`;
  const password = "brands-test-password-1";
  const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("no user");
  const u = { id: data.user.id, email, password };
  users.push(u);
  if (subscribed) {
    await admin!.from("subscriptions").insert({
      user_id: u.id,
      stripe_subscription_id: `sub_brands_${crypto.randomUUID()}`,
      stripe_customer_id: "cus_brands",
      status: "active",
    });
  }
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

const good = {
  name: "Linear",
  website: "linear.app",
  category: "project management software",
  aliases: "Linear.app",
  competitors: "Jira\nAsana | Asana.com",
  prompts: "Best project management tool for software teams?\nBest Jira alternatives",
};

function create(body: Record<string, string>): Promise<Response> {
  return post(
    new Request("http://localhost/api/brands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function brandRow(id: string) {
  const rows = (await sql`
    select cadence, next_run_at, archived_at, config_jsonb, website, category from public.brands where id = ${id}
  `) as unknown as Array<{ cadence: string; next_run_at: string | null; archived_at: string | null; config_jsonb: unknown; website: string; category: string }>;
  return rows[0]!;
}

beforeAll(async () => {
  if (!enabled) return;
  sql = new SQL(PG_URL);
  post = (await import("../app/api/brands/route")).POST;
  const byId = await import("../app/api/brands/[brandId]/route");
  patch = byId.PATCH as typeof patch;
  del = byId.DELETE as typeof del;
});

afterAll(async () => {
  if (!enabled) return;
  for (const u of users) await sql`delete from auth.users where id = ${u.id}`;
  await sql.end();
});

describePg("brand API", () => {
  test("401 without a session", async () => {
    await signIn(null);
    expect((await create(good)).status).toBe(401);
  });

  test("402 without an active subscription", async () => {
    const u = await makeUser("nosub", false);
    await signIn(u);
    expect((await create(good)).status).toBe(402);
  });

  test("400 with field errors on invalid input", async () => {
    const u = await makeUser("invalid");
    await signIn(u);
    const res = await create({ ...good, website: "not a site", competitors: "", prompts: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: Record<string, string> };
    expect(Object.keys(body.errors).sort()).toEqual(["competitors", "prompts", "website"]);
  });

  test("creates brands due immediately, weekly up to two, monthly for all at three (D12)", async () => {
    const u = await makeUser("cadence");
    await signIn(u);
    const ids: string[] = [];
    for (const name of ["A", "B"]) {
      const res = await create({ ...good, name });
      expect(res.status).toBe(201);
      ids.push(((await res.json()) as { brand_id: string }).brand_id);
    }
    for (const id of ids) {
      const row = await brandRow(id);
      expect(row.cadence).toBe("weekly");
      expect(row.next_run_at).not.toBeNull();
      expect(new Date(row.next_run_at!).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      expect(row.website).toBe("https://linear.app/");
      expect((row.config_jsonb as { prompts: string[] }).prompts).toHaveLength(2);
    }
    const third = await create({ ...good, name: "C" });
    expect(third.status).toBe(201);
    ids.push(((await third.json()) as { brand_id: string }).brand_id);
    for (const id of ids) expect((await brandRow(id)).cadence).toBe("monthly");

    // Archiving one returns the account to weekly.
    const archived = await del(new Request(`http://localhost/api/brands/${ids[2]}`, { method: "DELETE" }), {
      params: { brandId: ids[2]! },
    });
    expect(archived.status).toBe(200);
    const gone = await brandRow(ids[2]!);
    expect(gone.archived_at).not.toBeNull();
    expect(gone.cadence).toBe("paused");
    expect(gone.next_run_at).toBeNull();
    for (const id of ids.slice(0, 2)) expect((await brandRow(id)).cadence).toBe("weekly");
  });

  test("edits update the config; another user gets 404", async () => {
    const owner = await makeUser("owner");
    const intruder = await makeUser("intruder");
    await signIn(owner);
    const res = await create(good);
    const id = ((await res.json()) as { brand_id: string }).brand_id;

    const edit = (body: Record<string, string>) =>
      patch(
        new Request(`http://localhost/api/brands/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: { brandId: id } },
      );

    expect((await edit({ ...good, category: "issue trackers", prompts: "Only one question" })).status).toBe(200);
    const row = await brandRow(id);
    expect(row.category).toBe("issue trackers");
    expect((row.config_jsonb as { prompts: string[] }).prompts).toEqual(["Only one question"]);

    await signIn(intruder);
    expect((await edit(good)).status).toBe(404);
    expect(
      (await del(new Request(`http://localhost/api/brands/${id}`, { method: "DELETE" }), { params: { brandId: id } })).status,
    ).toBe(404);
  });
});
