// Question research without a database or network: keyword merging, AI
// volume, the LLM grouping guardrails, the pipeline's failure modes, and the
// DataForSEO client's envelope handling.

import { afterEach, describe, expect, test } from "bun:test";
import {
  DataforseoError,
  fetchKeywordIdeas,
  type LabsKeywordItem,
} from "../lib/dataforseo";
import {
  MARKETS,
  applyAiVolume,
  buildQuestions,
  mergeKeywords,
  runResearch,
  type ResearchDeps,
} from "../lib/question-research";

function kw(keyword: string, volume: number | null, intent = "commercial", months: number[] = []): LabsKeywordItem {
  return {
    keyword,
    keyword_info: {
      search_volume: volume,
      cpc: 1.5,
      monthly_searches: months.map((v, i) => ({ year: 2026, month: i + 1, search_volume: v })),
    },
    keyword_properties: { keyword_difficulty: 30 },
    search_intent_info: { main_intent: intent },
  };
}

describe("mergeKeywords", () => {
  test("dedupes case-insensitively, drops navigational, sorts by volume", () => {
    const merged = mergeKeywords([
      [kw("Step Challenge App", 500), kw("fitbit login", 9000, "navigational")],
      [kw("step challenge app", 400), kw("corporate wellness challenge", 900), kw("walking app", null)],
    ]);
    expect(merged.map((k) => k.keyword)).toEqual(["corporate wellness challenge", "Step Challenge App", "walking app"]);
  });

  test("trend is chronological and capped at 12 months", () => {
    const item = kw("x", 10);
    item.keyword_info!.monthly_searches = [
      ...Array.from({ length: 14 }, (_, i) => ({ year: 2025 + Math.floor(i / 12), month: (i % 12) + 1, search_volume: i })),
    ].reverse();
    expect(mergeKeywords([[item]])[0]!.trend).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });
});

describe("buildQuestions", () => {
  const keywords = applyAiVolume(
    mergeKeywords([[kw("step challenge app", 500, "commercial", [1, 2]), kw("corporate step challenge", 300, "commercial", [3, 4]), kw("walking challenge ideas", 200, "informational")]]),
    [
      { keyword: "step challenge app", ai_search_volume: 40 },
      { keyword: "corporate step challenge", ai_search_volume: null },
    ],
  );

  test("sums demand across a question's keywords and ranks by it", () => {
    const qs = buildQuestions(keywords, {
      questions: [
        { question: "What are fun walking challenge ideas for the office?", keywords: ["walking challenge ideas"] },
        { question: "What's the best app for a step challenge at work?", keywords: ["step challenge app", "Corporate Step Challenge"] },
      ],
    });
    expect(qs.map((q) => q.question)).toEqual([
      "What's the best app for a step challenge at work?",
      "What are fun walking challenge ideas for the office?",
    ]);
    expect(qs[0]).toMatchObject({ volume: 800, ai_volume: 40, intent: "commercial", trend: [4, 6] });
    expect(qs[1]!.ai_volume).toBeNull();
  });

  test("ignores keywords the model invented, questions with none left, and duplicates", () => {
    const qs = buildQuestions(keywords, {
      questions: [
        { question: "Which step app has the most users worldwide?", keywords: ["made up keyword"] },
        { question: "What's the best app for a step challenge at work?", keywords: ["step challenge app"] },
        { question: "what's the best app for a step challenge at work?", keywords: ["corporate step challenge"] },
        { question: "short?", keywords: ["step challenge app"] },
      ],
    });
    expect(qs).toHaveLength(1);
    expect(qs[0]!.keywords).toEqual(["step challenge app"]);
  });

  test("a keyword counts toward one question only, and close variants count once", () => {
    const variants = mergeKeywords([[kw("pm software", 1000), kw("software for pm", 1000), kw("pm tool", 400)]]);
    const qs = buildQuestions(variants, {
      questions: [
        { question: "What's the best PM software for a small team?", keywords: ["pm software", "software for pm", "pm tool"] },
        { question: "Which PM software do agencies recommend?", keywords: ["pm software", "pm tool"] },
      ],
    });
    // Identical 1,000s are Google close variants: 1,000 + 400, not 2,400.
    expect(qs).toHaveLength(1);
    expect(qs[0]!.volume).toBe(1400);
  });

  test("a malformed grouping yields no questions rather than throwing", () => {
    expect(buildQuestions(keywords, { nope: true })).toEqual([]);
    expect(buildQuestions(keywords, null)).toEqual([]);
  });
});

describe("runResearch", () => {
  const market = MARKETS[0];
  const ok = (items: LabsKeywordItem[], costUsd = 0.01) => async () => ({ items, costUsd });

  function deps(over: Partial<ResearchDeps> = {}): ResearchDeps {
    return {
      ideas: ok([kw("step challenge app", 500)]),
      suggestions: ok([kw("corporate step challenge", 300)]),
      aiVolume: async () => ({ items: [{ keyword: "step challenge app", ai_search_volume: 25 }], costUsd: 0.005 }),
      group: async () => ({
        questions: [{ question: "What's the best app for a step challenge at work?", keywords: ["step challenge app", "corporate step challenge"] }],
      }),
      ...over,
    };
  }

  test("returns ranked questions and the summed DataForSEO cost", async () => {
    const { results, costUsd } = await runResearch("step challenge", market, deps());
    expect(results.questions).toHaveLength(1);
    expect(results.questions[0]).toMatchObject({ volume: 800, ai_volume: 25 });
    expect(results.keywords).toHaveLength(2);
    expect(results.notes).toEqual([]);
    expect(costUsd).toBeCloseTo(0.025, 6);
  });

  test("AI volume failing is a note, not an error", async () => {
    const { results } = await runResearch(
      "step challenge",
      market,
      deps({ aiVolume: async () => { throw new DataforseoError("down", "upstream"); } }),
    );
    expect(results.questions[0]!.ai_volume).toBeNull();
    expect(results.notes[0]).toContain("AI search volume was unavailable");
  });

  test("grouping failing still returns the keyword table", async () => {
    const { results } = await runResearch("step challenge", market, deps({ group: async () => { throw new Error("openai down"); } }));
    expect(results.questions).toEqual([]);
    expect(results.keywords).toHaveLength(2);
    expect(results.notes.join(" ")).toContain("keyword table below is complete");
  });

  test("provider errors map to user-facing statuses without leaking details", async () => {
    const billing = runResearch("x", market, deps({ ideas: async () => { throw new DataforseoError("out of credit", "billing"); } }));
    await expect(billing).rejects.toMatchObject({ status: 503 });
    const upstream = runResearch("x", market, deps({ ideas: async () => { throw new DataforseoError("500", "upstream"); } }));
    await expect(upstream).rejects.toMatchObject({ status: 502 });
  });

  test("no search data at all is an explained empty result", async () => {
    const { results } = await runResearch("zzzz", market, deps({ ideas: ok([]), suggestions: ok([]) }));
    expect(results.keywords).toEqual([]);
    expect(results.notes[0]).toContain("No search data");
  });
});

describe("DataForSEO client", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  function fakeFetch(body: unknown, status = 200, seen: { auth?: string; body?: string } = {}): typeof fetch {
    return (async (_url: string, init: RequestInit) => {
      seen.auth = (init.headers as Record<string, string>).Authorization;
      seen.body = init.body as string;
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  }

  const q = { keyword: "step challenge", locationCode: 2840, languageCode: "en", limit: 10 };

  test("sends basic auth from login/password, returns items and cost, drops malformed rows", async () => {
    delete process.env.DATAFORSEO_API_KEY;
    process.env.DATAFORSEO_LOGIN = "me@example.com";
    process.env.DATAFORSEO_PASSWORD = "secret";
    const seen: { auth?: string; body?: string } = {};
    const res = await fetchKeywordIdeas(
      q,
      fakeFetch(
        { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.0105, result: [{ items: [kw("a", 1), { keyword: 42 }] }] }] },
        200,
        seen,
      ),
    );
    expect(seen.auth).toBe(`Basic ${Buffer.from("me@example.com:secret").toString("base64")}`);
    expect(JSON.parse(seen.body!)[0].keywords).toEqual(["step challenge"]);
    expect(res.costUsd).toBe(0.0105);
    expect(res.items.map((i) => i.keyword)).toEqual(["a"]);
  });

  test("prefers DATAFORSEO_API_KEY (OpenSEO's base64 format)", async () => {
    process.env.DATAFORSEO_API_KEY = "YmFzZTY0";
    const seen: { auth?: string } = {};
    await fetchKeywordIdeas(q, fakeFetch({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0, result: [] }] }, 200, seen));
    expect(seen.auth).toBe("Basic YmFzZTY0");
  });

  test("task-level failures are errors; billing codes are marked as billing", async () => {
    process.env.DATAFORSEO_API_KEY = "x";
    await expect(
      fetchKeywordIdeas(q, fakeFetch({ status_code: 20000, tasks: [{ status_code: 40200, status_message: "Payment Required." }] })),
    ).rejects.toMatchObject({ kind: "billing" });
    await expect(
      fetchKeywordIdeas(q, fakeFetch({ status_code: 20000, tasks: [{ status_code: 50000, status_message: "Internal Error." }] })),
    ).rejects.toMatchObject({ kind: "upstream" });
    await expect(fetchKeywordIdeas(q, fakeFetch({}, 500))).rejects.toMatchObject({ kind: "upstream" });
  });

  test("missing credentials is not_configured", async () => {
    delete process.env.DATAFORSEO_API_KEY;
    delete process.env.DATAFORSEO_LOGIN;
    delete process.env.DATAFORSEO_PASSWORD;
    await expect(fetchKeywordIdeas(q, fakeFetch({}))).rejects.toMatchObject({ kind: "not_configured" });
  });
});
