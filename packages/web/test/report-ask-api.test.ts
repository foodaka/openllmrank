// Integration tests for POST /api/reports/[id]/ask: access, refusals,
// streaming, the saved question row, and the per-report daily cap. The
// OpenAI call is faked; everything else is local Supabase. Skips cleanly
// when local Supabase is not reachable.

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { createClient } from "@supabase/supabase-js";
import { signReportToken } from "@openllmrank/shared/report-token";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54331";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PG_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54332/postgres";
const SECRET = "report-ask-test-secret-0123456789";

async function pgReachable(): Promise<boolean> {
  try {
    const probe = new SQL(PG_URL);
    await probe`select 1 from public.report_questions limit 1`;
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const enabled = Boolean(SERVICE_KEY && (await pgReachable()));
const describePg = enabled ? describe : describe.skip;
if (!enabled) {
  console.warn("[report-ask-api.test] Skipping: local Supabase with migration 0014 is required.");
}
const savedEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  REPORT_CHAT_DAILY_LIMIT: process.env.REPORT_CHAT_DAILY_LIMIT,
};
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.REPORT_LINK_SECRET = SECRET;
process.env.OPENAI_API_KEY = "test-key";
process.env.REPORT_CHAT_DAILY_LIMIT = "2";

// No session in these tests: access comes from the signed link only.
mock.module("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

// Fake OpenAI, real everything else.
const realFetch = globalThis.fetch;
let openAiCalls = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("https://api.openai.com/")) return realFetch(input, init);
  openAiCalls++;
  const body = [
    { choices: [{ delta: { content: "AskCo trails RivalCo " } }] },
    { choices: [{ delta: { content: "on [Q1/openai]." } }] },
    { choices: [], usage: { prompt_tokens: 42, completion_tokens: 7 } },
  ].map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}) as typeof fetch;

const config = {
  brand: { name: "AskCo", aliases: [] },
  competitors: [{ name: "RivalCo", aliases: [] }],
  prompts: ["best ask tool for tests"],
  providers: [{ id: "openai", model: "gpt-5.4-mini" }],
  samples_per_prompt: 1,
  concurrency_per_provider: 4,
};

let sql: SQL;
let post: (req: Request, ctx: { params: { id: string } }) => Promise<Response>;
const admin = enabled
  ? createClient(SUPABASE_URL, SERVICE_KEY!, { auth: { persistSession: false } })
  : null;
const userIds: string[] = [];

async function makeUser(): Promise<string> {
  const { data, error } = await admin!.auth.admin.createUser({
    email: `ask-${crypto.randomUUID()}@example.com`,
    password: "ask-test-password-1",
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("no user");
  userIds.push(data.user.id);
  return data.user.id;
}

/** A completed job with one prompt, one answer, and a citation of each brand. */
async function completedJob(userId: string, origin = "one_shot"): Promise<string> {
  const [brand] = (await sql`
    insert into public.brands (user_id, name) values (${userId}, 'AskCo') returning id
  `) as Array<{ id: string }>;
  const cliRunId = "run_" + crypto.randomUUID();
  const [job] = (await sql`
    insert into public.jobs (user_id, brand_id, status, config_jsonb, amount_cents, email_to,
                             cli_run_id, succeeded_at, succeeded_count, failed_count, origin)
    values (${userId}, ${brand!.id}, 'completed', ${config}, 0, 'ask@example.com',
            ${cliRunId}, now(), 1, 0, ${origin})
    returning id
  `) as Array<{ id: string }>;
  const [run] = (await sql`
    insert into public.runs (user_id, brand_id, job_id, cli_run_id, started_at, finished_at, config_hash)
    values (${userId}, ${brand!.id}, ${job!.id}, ${cliRunId}, now(), now(), 'ask-test-hash')
    returning id
  `) as Array<{ id: string }>;
  const promptId = `ask_${crypto.randomUUID().slice(0, 8)}`;
  await sql`
    insert into public.prompts (prompt_id, user_id, prompt_text, model, provider, config_blob)
    values (${promptId}, ${userId}, 'best ask tool for tests', 'gpt-5.4-mini', 'openai', '{}')
  `;
  const [call] = (await sql`
    insert into public.calls (run_id, user_id, brand_id, prompt_id, sample_index, ts, response_text, search_results_json)
    values (${run!.id}, ${userId}, ${brand!.id}, ${promptId}, 0, now(), 'RivalCo is the best. AskCo too.', ${[{ url: "https://g2.com/rivalco" }]})
    returning id
  `) as Array<{ id: string }>;
  await sql`
    insert into public.citations (call_id, run_id, user_id, brand_id, brand, matched_text, kind)
    values (${call!.id}, ${run!.id}, ${userId}, ${brand!.id}, 'RivalCo', 'RivalCo', 'name'),
           (${call!.id}, ${run!.id}, ${userId}, ${brand!.id}, 'AskCo', 'AskCo', 'name')
  `;
  return job!.id;
}

function ask(id: string, body: Record<string, unknown>): Promise<Response> {
  return post(
    new Request(`http://localhost/api/reports/${id}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify(body),
    }),
    { params: { id } },
  );
}

async function events(res: Response): Promise<Array<Record<string, unknown>>> {
  return (await res.text()).trim().split("\n").map((line) => JSON.parse(line));
}

beforeAll(async () => {
  if (!enabled) return;
  sql = new SQL(PG_URL);
  post = (await import("../app/api/reports/[id]/ask/route")).POST as typeof post;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  for (const id of userIds) await sql`delete from auth.users where id = ${id}`;
  await sql.end();
});

describePg("POST /api/reports/[id]/ask", () => {
  test("refuses a missing or wrong token, an unknown id and a bad question", async () => {
    const userId = await makeUser();
    const id = await completedJob(userId);
    const other = await completedJob(userId);
    expect((await ask(id, { question: "How did we do?" })).status).toBe(401);
    expect((await ask(id, { question: "How did we do?", token: signReportToken(other, SECRET) })).status).toBe(401);
    expect((await ask(crypto.randomUUID(), { question: "x", token: "t" })).status).toBe(404);
    expect((await ask(id, { question: "   ", token: signReportToken(id, SECRET) })).status).toBe(400);
    expect((await ask(id, { question: "x".repeat(1001), token: signReportToken(id, SECRET) })).status).toBe(400);
  });

  test("refuses a free snapshot, whose full run is not the reader's", async () => {
    const userId = await makeUser();
    const id = await completedJob(userId, "snapshot");
    const res = await ask(id, { question: "How did we do?", token: signReportToken(id, SECRET) });
    expect(res.status).toBe(403);
  });

  test("streams an answer for a valid link, saves it, and enforces the daily cap", async () => {
    const userId = await makeUser();
    const id = await completedJob(userId);
    const token = signReportToken(id, SECRET);
    const before = openAiCalls;

    const res = await ask(id, { question: "How did we do?", token, history: [] });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const evs = await events(res);
    const text = evs.filter((e) => e.type === "delta").map((e) => e.text).join("");
    expect(text).toBe("AskCo trails RivalCo on [Q1/openai].");
    expect(evs.at(-1)).toEqual({ type: "done", remaining: 1 });
    expect(openAiCalls).toBe(before + 1);

    const rows = (await sql`
      select question, answer, access_via, user_id, tokens_in, tokens_out, tool_calls
      from public.report_questions where job_id = ${id}
    `) as Array<Record<string, unknown>>;
    expect(rows).toEqual([{
      question: "How did we do?",
      answer: "AskCo trails RivalCo on [Q1/openai].",
      access_via: "token",
      user_id: userId,
      tokens_in: 42,
      tokens_out: 7,
      tool_calls: 0,
    }]);

    // Drain the stream: the row is saved just before the "done" event.
    const second = await ask(id, { question: "And now?", token });
    expect(second.status).toBe(200);
    expect((await events(second)).at(-1)).toEqual({ type: "done", remaining: 0 });
    const capped = await ask(id, { question: "One more?", token });
    expect(capped.status).toBe(429);
    expect(((await capped.json()) as { error: string }).error).toContain("2 questions");
  });
});
