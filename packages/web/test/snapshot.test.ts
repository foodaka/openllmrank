// Free snapshot: draft parsing, config shape, result summary, Telegram
// notifier, and the POST handler's lead-capture contract. The handler runs
// against an in-memory Supabase fake so it needs no local stack.

import { describe, expect, test } from "bun:test";
import type { CitationRate } from "openllmrank/src/core/gap";
import {
  buildSnapshotConfig,
  parseSnapshotSuggestions,
  snapshotDailyCap,
  summarizeSnapshot,
  websiteDomain,
  SNAPSHOT_PROMPTS,
} from "../lib/snapshot";
import { escapeTelegram, notifyTelegram } from "../lib/telegram";
import { handleSnapshot, type SnapshotDeps } from "../lib/snapshot-handler";
import { SuggestionError } from "../lib/website-suggestions";

const DRAFT = {
  name: "Acme Mail",
  category: "transactional email API",
  prompts: [
    "What is the best transactional email API for a SaaS startup?",
    "what is the best transactional email API for a SaaS startup?",
    "Which email APIs have the best deliverability for password resets?",
    "What are good alternatives to SendGrid for developers?",
    "Which transactional email service is cheapest at 100k emails a month?",
  ],
  competitors: ["Postmark", "SendGrid", "acme mail", "Resend", "postmark"],
};

describe("parseSnapshotSuggestions", () => {
  test("dedupes prompts and competitors and drops the brand itself", () => {
    const s = parseSnapshotSuggestions(DRAFT);
    expect(s.prompts).toHaveLength(4);
    expect(s.competitors).toEqual(["Postmark", "SendGrid", "Resend"]);
  });

  test("an empty draft (unreadable or login page) is a user-facing error", () => {
    expect(() => parseSnapshotSuggestions({ name: "", category: "", prompts: [], competitors: [] })).toThrow(SuggestionError);
  });
});

describe("buildSnapshotConfig", () => {
  test("3 questions, 1 sample, all five engines", () => {
    const cfg = buildSnapshotConfig("https://acme.com/", parseSnapshotSuggestions(DRAFT));
    expect(cfg.prompts).toHaveLength(SNAPSHOT_PROMPTS);
    expect(cfg.samples_per_prompt).toBe(1);
    expect(cfg.providers.map((p) => p.id)).toEqual(["openai", "anthropic", "google", "perplexity", "xai"]);
    expect(cfg.brand).toMatchObject({ name: "Acme Mail", website: "https://acme.com/" });
    expect(cfg.competitors.map((c) => c.name)).toEqual(["Postmark", "SendGrid", "Resend"]);
  });
});

test("websiteDomain strips www and path", () => {
  expect(websiteDomain("https://www.Acme.com/pricing")).toBe("acme.com");
});

test("snapshotDailyCap reads the env with a safe default", () => {
  expect(snapshotDailyCap({})).toBe(40);
  expect(snapshotDailyCap({ SNAPSHOT_DAILY_CAP: "5" })).toBe(5);
  expect(snapshotDailyCap({ SNAPSHOT_DAILY_CAP: "junk" })).toBe(40);
});

describe("summarizeSnapshot", () => {
  const rate = (prompt: string, provider: string, brand: string, cited: number): CitationRate => ({
    prompt_id: `${prompt}-${provider}`,
    prompt_text: prompt,
    provider,
    brand,
    samples_total: 1,
    samples_with_citation: cited,
    rate: cited,
  });
  const rates: CitationRate[] = [];
  for (const provider of ["openai", "anthropic"]) {
    for (const prompt of ["q1", "q2"]) {
      rates.push(rate(prompt, provider, "Acme", provider === "openai" && prompt === "q1" ? 1 : 0));
      rates.push(rate(prompt, provider, "Postmark", 1));
      rates.push(rate(prompt, provider, "Resend", prompt === "q1" ? 1 : 0));
    }
  }
  const summary = summarizeSnapshot({
    rates,
    brandName: "Acme",
    competitorNames: ["Postmark", "Resend"],
    promptOrder: ["q1", "q2"],
    providerOrder: ["openai", "anthropic", "google"],
  });

  test("counts mentions per brand and ranks you", () => {
    expect(summary.you).toMatchObject({ mentions: 1, answers: 4 });
    expect(summary.leaderboard.map((s) => s.name)).toEqual(["Postmark", "Resend", "Acme"]);
    expect(summary.rank).toBe(3);
    expect(summary.topCompetitor?.name).toBe("Postmark");
  });

  test("per engine, including an engine with no answers", () => {
    expect(summary.byProvider).toEqual([
      { provider: "openai", answers: 2, mentions: 1 },
      { provider: "anthropic", answers: 2, mentions: 0 },
      { provider: "google", answers: 0, mentions: 0 },
    ]);
  });

  test("per question lists who each engine named", () => {
    expect(summary.questions[0]!.byProvider[0]).toEqual({ provider: "openai", answered: true, mentioned: ["Acme", "Postmark", "Resend"] });
    expect(summary.questions[1]!.byProvider[2]).toEqual({ provider: "google", answered: false, mentioned: [] });
  });
});

describe("notifyTelegram", () => {
  test("no-op without config", async () => {
    let called = false;
    const ok = await notifyTelegram("hi", { env: {}, fetch: (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch });
    expect(ok).toBe(false);
    expect(called).toBe(false);
  });

  test("posts to the bot with HTML parse mode", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const ok = await notifyTelegram("<b>new</b>", {
      env: { TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_CHAT_ID: "42" },
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(ok).toBe(true);
    expect(calls[0]!.url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(calls[0]!.body).toMatchObject({ chat_id: "42", text: "<b>new</b>", parse_mode: "HTML" });
  });

  test("never throws when Telegram is down", async () => {
    const ok = await notifyTelegram("x", {
      env: { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" },
      fetch: (async () => { throw new Error("boom"); }) as unknown as typeof fetch,
    });
    expect(ok).toBe(false);
  });

  test("escapes user text", () => {
    expect(escapeTelegram("<a&b>")).toBe("&lt;a&amp;b&gt;");
  });
});

// ---------------------------------------------------------------------------
// handleSnapshot against an in-memory Supabase
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeSupabase(seed: { leads?: Row[]; jobs?: Row[] } = {}) {
  const tables: Record<string, Row[]> = { leads: seed.leads ?? [], jobs: seed.jobs ?? [], brands: [] };
  let nextId = 1;
  const uuid = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;

  function query(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row = {};
    let head = false;
    const builder: Record<string, unknown> = {
      select(_cols?: string, opts?: { head?: boolean }) { if (op === "select") head = Boolean(opts?.head); return builder; },
      insert(row: Row) { op = "insert"; payload = row; return builder; },
      update(row: Row) { op = "update"; payload = row; return builder; },
      delete() { op = "delete"; return builder; },
      eq(col: string, v: unknown) { filters.push((r) => r[col] === v); return builder; },
      not(col: string, _op: string, _v: null) { filters.push((r) => r[col] != null); return builder; },
      gte(col: string, v: string) { filters.push((r) => String(r[col] ?? "") >= v); return builder; },
      single() { return builder; },
      then(resolve: (v: unknown) => unknown) {
        const rows = tables[table]!;
        if (op === "insert") {
          const row = { id: uuid(), wizard_started_at: new Date().toISOString(), created_at: new Date().toISOString(), ...payload };
          rows.push(row);
          return Promise.resolve({ data: { id: row.id }, error: null }).then(resolve);
        }
        const matched = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "update") {
          for (const r of matched) Object.assign(r, payload);
          return Promise.resolve({ error: null }).then(resolve);
        }
        if (op === "delete") {
          tables[table] = rows.filter((r) => !matched.includes(r));
          return Promise.resolve({ error: null }).then(resolve);
        }
        return Promise.resolve(head ? { count: matched.length, error: null } : { data: matched, error: null }).then(resolve);
      },
    };
    return builder;
  }

  const client = {
    from: query,
    auth: { admin: { createUser: async () => ({ data: { user: { id: uuid() } }, error: null }) } },
  };
  return { client, tables };
}

function makeDeps(fake: ReturnType<typeof fakeSupabase>, overrides: Partial<SnapshotDeps> = {}) {
  const pings: string[] = [];
  const deps: SnapshotDeps = {
    supabase: () => fake.client as never,
    readSite: async () => "{}",
    complete: async () => DRAFT,
    notify: async (html) => { pings.push(html); return true; },
    configured: () => true,
    ...overrides,
  };
  return { deps, pings };
}

let ipSeq = 0;
function post(body: unknown) {
  return new Request("http://localhost:3000/api/snapshot", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++ipSeq}` },
    body: JSON.stringify(body),
  });
}

describe("handleSnapshot", () => {
  test("captures the lead, queues a free snapshot job, and pings Telegram", async () => {
    const fake = fakeSupabase();
    const { deps, pings } = makeDeps(fake);
    const res = await handleSnapshot(post({ website: "acme.com", email: "Founder@Acme.com" }), deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    const job = fake.tables.jobs![0]!;
    expect(body.url).toStartWith(`/snapshot/${job.id}?t=`);
    expect(job).toMatchObject({ origin: "snapshot", amount_cents: 0, status: "paid", email_to: "founder@acme.com" });
    expect((job.config_jsonb as { samples_per_prompt: number }).samples_per_prompt).toBe(1);
    expect(fake.tables.leads![0]).toMatchObject({
      email: "founder@acme.com",
      source: "snapshot",
      status: "converted",
      website_domain: "acme.com",
      job_id: job.id,
      brand_name: "Acme Mail",
    });
    expect(pings).toHaveLength(1);
    expect(pings[0]).toContain("founder@acme.com");
    expect(pings[0]).toContain("Postmark");
  });

  test("keeps the email and pings even when the site can't be read", async () => {
    const fake = fakeSupabase();
    const { deps, pings } = makeDeps(fake, {
      readSite: async () => { throw new SuggestionError("This website doesn’t allow automated reading."); },
    });
    const res = await handleSnapshot(post({ website: "locked.com", email: "a@locked.com" }), deps);
    expect(res.status).toBe(422);
    expect(fake.tables.leads![0]).toMatchObject({ email: "a@locked.com", status: "started" });
    expect(fake.tables.jobs).toHaveLength(0);
    expect(pings[0]).toContain("site unreadable");
  });

  test("one snapshot per email", async () => {
    const fake = fakeSupabase({ leads: [{ id: "x", email: "a@acme.com", source: "snapshot", job_id: "j1", website_domain: "other.com", wizard_started_at: new Date().toISOString() }] });
    const { deps } = makeDeps(fake);
    const res = await handleSnapshot(post({ website: "acme.com", email: "a@acme.com" }), deps);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { reason: string }).reason).toBe("email");
    expect(fake.tables.jobs).toHaveLength(0);
  });

  test("one snapshot per domain per week", async () => {
    const fake = fakeSupabase({ leads: [{ id: "x", email: "b@acme.com", source: "snapshot", job_id: "j1", website_domain: "acme.com", wizard_started_at: new Date().toISOString() }] });
    const { deps } = makeDeps(fake);
    const res = await handleSnapshot(post({ website: "https://www.acme.com", email: "c@acme.com" }), deps);
    expect(((await res.json()) as { reason: string }).reason).toBe("domain");
  });

  test("global daily cap", async () => {
    const prev = process.env.SNAPSHOT_DAILY_CAP;
    process.env.SNAPSHOT_DAILY_CAP = "1";
    try {
      const fake = fakeSupabase({ jobs: [{ id: "j", origin: "snapshot", created_at: new Date().toISOString() }] });
      const { deps } = makeDeps(fake);
      const res = await handleSnapshot(post({ website: "acme.com", email: "d@acme.com" }), deps);
      expect(((await res.json()) as { reason: string }).reason).toBe("daily_cap");
    } finally {
      if (prev === undefined) delete process.env.SNAPSHOT_DAILY_CAP;
      else process.env.SNAPSHOT_DAILY_CAP = prev;
    }
  });

  test("rejects a bad email before touching the database", async () => {
    const fake = fakeSupabase();
    const { deps } = makeDeps(fake);
    const res = await handleSnapshot(post({ website: "acme.com", email: "nope" }), deps);
    expect(res.status).toBe(400);
    expect(fake.tables.leads).toHaveLength(0);
  });

  test("rejects cross-origin posts", async () => {
    const fake = fakeSupabase();
    const { deps } = makeDeps(fake);
    const req = new Request("http://localhost:3000/api/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ website: "acme.com", email: "e@acme.com" }),
    });
    expect((await handleSnapshot(req, deps)).status).toBe(403);
  });
});
