// The free mention check's API against local Supabase: input validation,
// the per-requester quota, the global daily spend cap, and the poll
// payload. The worker side is covered by packages/worker/test/mention-loop.

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
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const probe = new SQL(PG_URL);
    await probe`select 1 from public.mention_checks limit 1`; // needs migration 0012
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const reachable = await ready();
const describePg = reachable ? describe : describe.skip;
if (!reachable) {
  console.warn("[mention-check-api.test] Skipping: local Supabase (migration 0012) or web .env.local not available.");
}

const { POST } = await import("../app/api/mention-check/route");
const { GET } = await import("../app/api/mention-check/[token]/route");

const DOMAIN = "mention-api-test.example";
const QUESTION = "What is the best tool for testing mention checks?";
let sql: SQL;
let ipCounter = 0;

function post(body: unknown, ip = `198.51.100.${10 + (ipCounter++ % 200)}`) {
  return POST(
    new Request("http://localhost/api/mention-check", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

function get(token: string) {
  return GET(new Request(`http://localhost/api/mention-check/${token}`), { params: { token } });
}

const valid = { brand: "Acme", website: `https://www.${DOMAIN}/pricing`, question: QUESTION };

beforeAll(() => {
  if (reachable) sql = new SQL(PG_URL);
});

afterAll(async () => {
  if (!reachable) return;
  await sql`delete from public.mention_checks where domain = ${DOMAIN}`;
  await sql.end();
});

beforeEach(async () => {
  if (!reachable) return;
  delete process.env.MENTION_CHECK_DAILY_BUDGET_USD;
  await sql`delete from public.mention_checks where domain = ${DOMAIN}`;
});

describePg("POST /api/mention-check", () => {
  test("rejects missing fields, short questions and non-public domains", async () => {
    expect((await post({ brand: "Acme" })).status).toBe(400);
    const short = await post({ ...valid, question: "best?" });
    expect(short.status).toBe(400);
    expect(((await short.json()) as { error: string }).error).toContain("at least 10 characters");
    expect((await post({ ...valid, website: "localhost" })).status).toBe(400);
  });

  test("queues a check with the fixed provider lineup and a normalized domain", async () => {
    const res = await post({ ...valid, question: `  ${QUESTION}\n` });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    const [row] = (await sql`
      select domain, question, state, providers_jsonb, requester_ip_hash from public.mention_checks where id = ${token}
    `) as any[];
    expect(row.domain).toBe(DOMAIN);
    expect(row.question).toBe(QUESTION);
    expect(row.state).toBe("queued");
    expect(row.providers_jsonb.map((p: { id: string }) => p.id)).toEqual(["openai", "perplexity", "google"]);
    expect(row.requester_ip_hash).not.toContain("198.51.100");
  });

  test("a requester gets three checks a day", async () => {
    const ip = "203.0.113.77";
    for (let i = 0; i < 3; i++) expect((await post(valid, ip)).status).toBe(200);
    const fourth = await post(valid, ip);
    expect(fourth.status).toBe(429);
    expect(((await fourth.json()) as { error: string }).error).toContain("3 free checks");
  });

  test("the daily budget stops new checks, and 0 turns the tool off", async () => {
    // Unfinished checks reserve the estimate, so one queued check fills a tiny budget.
    process.env.MENTION_CHECK_DAILY_BUDGET_USD = "0.2";
    expect((await post(valid)).status).toBe(200);
    const over = await post(valid);
    expect(over.status).toBe(503);

    process.env.MENTION_CHECK_DAILY_BUDGET_USD = "0";
    const off = await post(valid);
    expect(off.status).toBe(503);
    expect(((await off.json()) as { error: string }).error).toContain("paused");
  });
});

describePg("GET /api/mention-check/[token]", () => {
  test("404 for malformed and unknown tokens", async () => {
    expect((await get("nope")).status).toBe(404);
    expect((await get("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  test("queued, then complete with validated results", async () => {
    const { token } = (await (await post(valid)).json()) as { token: string };
    let body = (await (await get(token)).json()) as any;
    expect(body.state).toBe("queued");
    expect(body.results).toBeNull();
    expect(body).not.toHaveProperty("cost_usd");

    const results = {
      schema_version: 1,
      answers: [
        {
          provider: "openai",
          model: "gpt-5.4-mini",
          status: "ok",
          mentioned: true,
          excerpts: ["Acme is great"],
          answer_preview: "Acme is great",
          sources: [],
          cached: false,
        },
      ],
      mentioned_count: 1,
      answered_count: 1,
    };
    await sql`
      update public.mention_checks
      set state = 'complete', results_jsonb = ${results as unknown as Record<string, unknown>}, finished_at = now()
      where id = ${token}
    `;
    body = (await (await get(token)).json()) as any;
    expect(body.state).toBe("complete");
    expect(body.results.mentioned_count).toBe(1);
  });

  test("stored results that don't match the schema are a 500, not a wrong verdict", async () => {
    const { token } = (await (await post(valid)).json()) as { token: string };
    await sql`
      update public.mention_checks
      set state = 'complete', results_jsonb = ${{ schema_version: 99 } as unknown as Record<string, unknown>}
      where id = ${token}
    `;
    expect((await get(token)).status).toBe(500);
  });
});
