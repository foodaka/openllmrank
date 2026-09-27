// Question research API end to end against local Supabase, with DataForSEO
// and OpenAI stubbed (no network, no spend): auth and entitlement, the
// 7-day cross-user cache, the per-user daily quota, reading a saved
// search, and "Track this". Skips cleanly without local Supabase.

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54331";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PG_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54332/postgres";

async function pgReachable(): Promise<boolean> {
  try {
    const probe = new SQL(PG_URL);
    await probe`select 1 from public.question_research limit 1`; // needs migration 0012
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const enabled = Boolean(ANON_KEY && SERVICE_KEY && (await pgReachable()));
const describePg = enabled ? describe : describe.skip;
if (!enabled) console.warn("[question-research-api.test] Skipping: local Supabase (migration 0012) and auth keys are required.");
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.DATAFORSEO_API_KEY = "test";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test";
process.env.QUESTION_RESEARCH_PER_DAY = "2";

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

// Stub every provider through the pipeline's runtime hook: count calls so
// cache hits are provably free, and never touch the network.
let providerCalls = 0;
const item = (keyword: string, volume: number) => ({
  keyword,
  keyword_info: { search_volume: volume, monthly_searches: [] },
  search_intent_info: { main_intent: "commercial" },
});
const { researchRuntime } = await import("../lib/question-research");
const savedDeps = researchRuntime.deps;
researchRuntime.deps = {
  ideas: async () => {
    providerCalls++;
    return { items: [item("step challenge app", 500)], costUsd: 0.01 };
  },
  suggestions: async () => {
    providerCalls++;
    return { items: [item("corporate step challenge", 300)], costUsd: 0.01 };
  },
  aiVolume: async () => {
    providerCalls++;
    return { items: [{ keyword: "step challenge app", ai_search_volume: 20 }], costUsd: 0.005 };
  },
  group: async () => ({
    questions: [
      { question: "What's the best app for a step challenge at work?", keywords: ["step challenge app", "corporate step challenge"] },
    ],
  }),
};

let sql: SQL;
const admin = enabled ? createClient(SUPABASE_URL, SERVICE_KEY!, { auth: { persistSession: false } }) : null;
type User = { id: string; email: string; password: string };
const users: User[] = [];

async function makeUser(label: string, subscribed = true): Promise<User> {
  const email = `qr-${label}-${crypto.randomUUID()}@example.com`;
  const password = "qr-test-password-1";
  const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("no user");
  const u = { id: data.user.id, email, password };
  users.push(u);
  if (subscribed) {
    await admin!.from("subscriptions").insert({
      user_id: u.id,
      stripe_subscription_id: `sub_qr_${crypto.randomUUID()}`,
      stripe_customer_id: "cus_qr",
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
        for (const { name, value } of set) jar = jar.filter((c) => c.name !== name).concat({ name, value });
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw error;
}

async function makeBrand(u: User, prompts: string[]): Promise<string> {
  const config = {
    brand: { name: "StepCo", aliases: [], website: "https://stepco.example/" },
    competitors: [{ name: "Rival", aliases: [] }],
    prompts,
    providers: [{ id: "openai", model: "gpt-5.4-mini" }],
    samples_per_prompt: 3,
    concurrency_per_provider: 4,
  };
  const [row] = (await sql`
    insert into public.brands (user_id, name, website, config_jsonb)
    values (${u.id}, 'StepCo', 'https://stepco.example/', ${config as unknown as Record<string, unknown>})
    returning id
  `) as { id: string }[];
  return row!.id;
}

let questions: typeof import("../app/api/brands/[brandId]/questions/route");
let prompts: typeof import("../app/api/brands/[brandId]/prompts/route");

function search(brandId: string, topic: string) {
  return questions.POST(
    new Request(`http://localhost/api/brands/${brandId}/questions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic, location_code: 2840 }),
    }),
    { params: { brandId } },
  );
}

function track(brandId: string, question: string) {
  return prompts.POST(
    new Request(`http://localhost/api/brands/${brandId}/prompts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    }),
    { params: { brandId } },
  );
}

beforeAll(async () => {
  if (!enabled) return;
  sql = new SQL(PG_URL);
  questions = await import("../app/api/brands/[brandId]/questions/route");
  prompts = await import("../app/api/brands/[brandId]/prompts/route");
});

afterAll(async () => {
  researchRuntime.deps = savedDeps;
  if (!enabled) return;
  for (const u of users) await sql`delete from auth.users where id = ${u.id}`;
  await sql.end();
});

describePg("question research API", () => {
  test("401 without a session, 402 without a subscription, 404 for someone else's brand", async () => {
    const owner = await makeUser("owner");
    const brandId = await makeBrand(owner, ["Existing question about step apps?"]);
    await signIn(null);
    expect((await search(brandId, "step challenge")).status).toBe(401);

    const unsubscribed = await makeUser("nosub", false);
    await signIn(unsubscribed);
    const ownBrand = await makeBrand(unsubscribed, ["Existing question about step apps?"]);
    expect((await search(ownBrand, "step challenge")).status).toBe(402);

    const stranger = await makeUser("stranger");
    await signIn(stranger);
    expect((await search(brandId, "step challenge")).status).toBe(404);
    expect((await track(brandId, "What's the best app for a step challenge at work?")).status).toBe(404);
  });

  test("ranks questions, caches across users for free, and enforces the daily quota", async () => {
    const topic = `step challenge ${crypto.randomUUID().slice(0, 8)}`;
    const a = await makeUser("a");
    await signIn(a);
    const brandA = await makeBrand(a, ["Existing question about step apps?"]);

    providerCalls = 0;
    const first = await search(brandA, topic);
    expect(first.status).toBe(200);
    const body = (await first.json()) as any;
    expect(body.cached).toBe(false);
    expect(body.results.questions[0]).toMatchObject({ volume: 800, ai_volume: 20 });
    expect(providerCalls).toBe(3);

    // Another user, same topic (different case/spacing): cache hit, no spend, no quota.
    const b = await makeUser("b");
    await signIn(b);
    const brandB = await makeBrand(b, ["Existing question about step apps?"]);
    const again = (await (await search(brandB, `  ${topic.toUpperCase()} `)).json()) as any;
    expect(again.cached).toBe(true);
    expect(providerCalls).toBe(3);
    const [cachedRow] = (await sql`select cost_usd from public.question_research where id = ${again.id}`) as any[];
    expect(Number(cachedRow.cost_usd)).toBe(0);

    // Quota (2/day here) counts only paid searches.
    await signIn(a);
    expect((await search(brandA, `${topic} two`)).status).toBe(200);
    const third = await search(brandA, `${topic} three`);
    expect(third.status).toBe(429);
    expect((await search(brandA, topic)).status).toBe(200); // cached: still free

    // A saved search reloads by id, only for its own brand.
    const get = (brandId: string, id: string) =>
      questions.GET(new Request(`http://localhost/api/brands/${brandId}/questions?search=${id}`), { params: { brandId } });
    expect((await get(brandA, body.id)).status).toBe(200);
    await signIn(b);
    expect((await get(brandB, body.id)).status).toBe(404);
  });

  test("a cached search whose grouping failed retries only the grouping", async () => {
    const topic = `regroup ${crypto.randomUUID().slice(0, 8)}`;
    const u = await makeUser("regroup");
    await signIn(u);
    const brandId = await makeBrand(u, ["Existing question about step apps?"]);

    const group = researchRuntime.deps.group;
    researchRuntime.deps.group = async () => {
      throw new Error("openai 401");
    };
    providerCalls = 0;
    const failed = (await (await search(brandId, topic)).json()) as any;
    expect(failed.results.questions).toEqual([]);
    expect(failed.results.keywords.length).toBeGreaterThan(0);
    expect(providerCalls).toBe(3);

    researchRuntime.deps.group = group;
    const retried = (await (await search(brandId, topic)).json()) as any;
    expect(retried.results.questions).toHaveLength(1);
    expect(retried.results.notes).toEqual([]);
    expect(providerCalls).toBe(3); // no DataForSEO spend on the retry

    const again = (await (await search(brandId, topic)).json()) as any;
    expect(again.cached).toBe(true);
    expect(again.results.questions).toHaveLength(1);
  });

  test("Track adds once, is idempotent, and stops at the prompt cap", async () => {
    const u = await makeUser("track");
    await signIn(u);
    const nine = Array.from({ length: 9 }, (_, i) => `Existing buyer question number ${i + 1}?`);
    const brandId = await makeBrand(u, nine);

    const q = "What's the best app for a step challenge at work?";
    const added = (await (await track(brandId, q)).json()) as any;
    expect(added).toMatchObject({ ok: true, added: true });
    expect(added.prompts).toHaveLength(10);

    const dup = (await (await track(brandId, `  ${q.toUpperCase()}`)).json()) as any;
    expect(dup.added).toBe(false);

    const full = await track(brandId, "Which walking challenge app is best for remote teams?");
    expect(full.status).toBe(409);
    expect(((await full.json()) as any).code).toBe("full");

    const [row] = (await sql`select config_jsonb from public.brands where id = ${brandId}`) as any[];
    expect(row.config_jsonb.prompts).toContain(q);
  });
});
