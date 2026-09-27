// The free mention check end to end against local Supabase, with stub
// providers (no network, no spend): claim → ask (cache first) → score →
// persist, plus the failure paths. Skips without local PG, and skips if a
// foreign queued row exists (the claim picks the globally oldest row).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import type { Provider, ProviderId, ProviderResult } from "openllmrank/src/core/types";

const PG_PORT = process.env.SUPABASE_TEST_PORT ?? "54332";
const PG_URL = `postgresql://postgres:postgres@${process.env.SUPABASE_TEST_HOST ?? "127.0.0.1"}:${PG_PORT}/postgres`;

async function tableReady(): Promise<boolean> {
  try {
    const probe = new SQL(PG_URL);
    await probe`select 1 from public.mention_checks limit 1`; // needs migration 0012
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const reachable = await tableReady();
const { env } = reachable ? await import("../src/env") : { env: null };
const localDb =
  reachable &&
  env !== null &&
  (env.databaseUrl.includes(`127.0.0.1:${PG_PORT}`) || env.databaseUrl.includes(`localhost:${PG_PORT}`));
const describePg = localDb ? describe : describe.skip;
if (!localDb) {
  console.warn("[mention-loop.test] Skipping: local Supabase with migration 0012 not reachable.");
}

const { claimMentionCheck } = await import("../src/mention-queue");
const { runMentionCheck } = await import("../src/mention-loop");

const DOMAIN = "mention-loop-test.example";
const PROVIDERS = [
  { id: "openai", model: "gpt-5.4-mini" },
  { id: "perplexity", model: "sonar" },
  { id: "google", model: "gemini-3.5-flash" },
];

let sql: SQL;
let calls: string[] = [];

function stub(answers: Partial<Record<ProviderId, string | Error>>) {
  return {
    provider(id: ProviderId): Provider {
      return {
        id,
        async query(): Promise<ProviderResult> {
          calls.push(id);
          const a = answers[id];
          if (a instanceof Error || a === undefined) throw a ?? new Error("no stub");
          return {
            response_text: a,
            search_results: [{ url: `https://source.example/${id}`, title: "A source" }],
            tokens_in: 1,
            tokens_out: 1,
            cost_usd: 0.01,
            latency_ms: 1,
          };
        },
      };
    },
  };
}

async function queue(question: string): Promise<string> {
  const [row] = (await sql`
    insert into public.mention_checks (brand_name, website, domain, question, providers_jsonb, requester_ip_hash)
    values ('Acme', ${`https://${DOMAIN}`}, ${DOMAIN}, ${question},
            ${PROVIDERS as unknown as Record<string, unknown>[]}, 'test-ip')
    returning id
  `) as { id: string }[];
  return row!.id;
}

async function claimOwn(id: string) {
  const row = await claimMentionCheck(sql);
  expect(row?.id).toBe(id);
  return row!;
}

async function load(id: string) {
  const [row] = (await sql`
    select state, results_jsonb, cost_usd, failure_reason from public.mention_checks where id = ${id}
  `) as { state: string; results_jsonb: any; cost_usd: string; failure_reason: string | null }[];
  return row!;
}

async function cleanup() {
  await sql`delete from public.mention_checks where domain = ${DOMAIN}`;
  await sql`delete from public.mention_answers where question like 'mention-loop-test:%'`;
}

beforeAll(async () => {
  if (!localDb) return;
  sql = new SQL(PG_URL);
  await cleanup();
});

afterAll(async () => {
  if (!localDb) return;
  await cleanup();
  await sql.end();
});

beforeEach(async () => {
  if (!localDb) return;
  calls = [];
  const [row] = (await sql`
    select count(*)::int as n from public.mention_checks where state = 'queued' and domain <> ${DOMAIN}
  `) as { n: number }[];
  if ((row?.n ?? 0) > 0) throw new Error("foreign queued mention checks exist in the local DB; refusing to claim them");
});

describePg("runMentionCheck", () => {
  test("scores every assistant, records spend, and caches answers for the next check", async () => {
    const question = `mention-loop-test: best tools ${Date.now()}?`;
    const deps = stub({
      openai: "Acme is the usual pick for small teams.",
      perplexity: "Most people choose Globex.",
      google: "Globex or Initech.",
    });

    const id = await queue(question);
    expect(await runMentionCheck(sql, await claimOwn(id), deps)).toBe("complete");
    const first = await load(id);
    expect(first.state).toBe("complete");
    expect(first.results_jsonb.mentioned_count).toBe(1);
    expect(first.results_jsonb.answered_count).toBe(3);
    expect(Number(first.cost_usd)).toBeCloseTo(0.03, 5);
    expect(calls.sort()).toEqual(["google", "openai", "perplexity"]);

    // Same question (different case/spacing): every answer comes from cache.
    calls = [];
    const again = await queue(`  ${question.toUpperCase()} `);
    await runMentionCheck(sql, await claimOwn(again), deps);
    const second = await load(again);
    expect(calls).toEqual([]);
    expect(Number(second.cost_usd)).toBe(0);
    expect(second.results_jsonb.answers.every((a: { cached: boolean }) => a.cached)).toBe(true);
  });

  test("one assistant failing is reported, not fatal", async () => {
    const id = await queue(`mention-loop-test: partial ${Date.now()}?`);
    await runMentionCheck(
      sql,
      await claimOwn(id),
      stub({ openai: "Acme.", perplexity: new Error("rate limited"), google: "Initech." }),
    );
    const row = await load(id);
    expect(row.state).toBe("complete");
    expect(row.results_jsonb.answered_count).toBe(2);
    const failed = row.results_jsonb.answers.find((a: { provider: string }) => a.provider === "perplexity");
    expect(failed.status).toBe("failed");
  });

  test("every assistant failing fails the check with a readable reason", async () => {
    const id = await queue(`mention-loop-test: none ${Date.now()}?`);
    const outcome = await runMentionCheck(sql, await claimOwn(id), stub({}));
    expect(outcome).toBe("failed");
    const row = await load(id);
    expect(row.state).toBe("failed");
    expect(row.failure_reason).toContain("None of the AI assistants answered");
  });
});
