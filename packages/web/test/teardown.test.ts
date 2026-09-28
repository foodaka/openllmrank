import { describe, expect, test } from "bun:test";
import sitemap from "../app/sitemap";
import published from "../content/teardowns/transactional-email-apis.json";
import { getPostBySlug, getRelatedPosts } from "../lib/blog";
import { buildTeardown, domainOf, type TeardownData, type TeardownInput } from "../lib/teardown";

const RUN = "2026-07-14T08-00-00-000Z";

function call(prompt_id: string, sample_index: number, text: string, extra: Partial<TeardownInput["calls"][number]> = {}) {
  return {
    run_id: RUN,
    prompt_id,
    sample_index,
    response_text: text,
    search_results_json: "[]",
    cost_usd: 0.01,
    error_code: null,
    ...extra,
  };
}

const base: TeardownInput = {
  slug: "test-teardown",
  highlight: "Mine",
  brands: ["Mine", "Big", "Other"],
  run: { run_id: RUN, started_at: "2026-07-14T08:00:00.000Z" },
  prompts: [
    { prompt_id: "q1-openai", prompt_text: "best widget app", provider: "openai", model: "gpt" },
    { prompt_id: "q1-google", prompt_text: "best widget app", provider: "google", model: "gem" },
  ],
  calls: [
    call("q1-openai", 0, "Big is the best widget app for most teams by a clear margin today."),
    call("q1-openai", 1, "Try Mine or Big.", {
      search_results_json: JSON.stringify([{ url: "https://www.g2.com/x" }, { url: "https://vertexaisearch.cloud.google.com/r/1" }]),
    }),
    call("q1-google", 0, "Big.", { search_results_json: JSON.stringify([{ url: "https://g2.com/y" }]) }),
    call("q1-google", 1, "", { error_code: "TIMEOUT", cost_usd: 0 }),
  ],
  citations: [
    { run_id: RUN, prompt_id: "q1-openai", sample_index: 0, brand: "Big", kind: "name" },
    { run_id: RUN, prompt_id: "q1-openai", sample_index: 0, brand: "Big", kind: "name" }, // same answer twice
    { run_id: RUN, prompt_id: "q1-openai", sample_index: 1, brand: "Mine", kind: "name" },
    { run_id: RUN, prompt_id: "q1-openai", sample_index: 1, brand: "Big", kind: "url" },
    { run_id: RUN, prompt_id: "q1-google", sample_index: 0, brand: "Big", kind: "name" },
    { run_id: RUN, prompt_id: "q1-google", sample_index: 0, brand: "Other", kind: "grounded_source" },
    { run_id: RUN, prompt_id: "q1-google", sample_index: 1, brand: "Other", kind: "name" }, // failed call
  ],
};

describe("buildTeardown", () => {
  const t = buildTeardown(base);

  test("counts answers whose text names a brand, once per answer", () => {
    expect(t.run.answers).toBe(3);
    expect(t.brands).toEqual([
      { name: "Big", answers: 3 },
      { name: "Mine", answers: 1 },
      { name: "Other", answers: 0 }, // a cited source alone and a failed call don't count
    ]);
  });

  test("splits counts per engine", () => {
    const openai = t.by_engine.find((e) => e.provider === "openai")!;
    const google = t.by_engine.find((e) => e.provider === "google")!;
    expect(openai.answers).toBe(2);
    expect(openai.brands[0]).toEqual({ name: "Big", answers: 2 });
    expect(google.answers).toBe(1);
    expect(google.brands.find((b) => b.name === "Mine")!.answers).toBe(0);
  });

  test("counts cited domains, dropping www and Gemini redirect hosts", () => {
    expect(t.domains).toEqual([{ domain: "g2.com", citations: 2, answers: 2 }]);
    expect(domainOf("https://vertexaisearch.cloud.google.com/grounding/x")).toBeNull();
    expect(domainOf("not a url")).toBeNull();
  });

  test("records run metadata and quote candidates that name a tracked brand", () => {
    expect(t.run.date).toBe("2026-07-14");
    expect(t.run.samples).toBe(2);
    expect(t.run.cost_usd).toBe(0.03);
    expect(t.highlight).toBe("Mine");
    expect(t.quotes.map((q) => q.text)).toEqual(["Big is the best widget app for most teams by a clear margin today."]);
  });
});

describe("published teardown: transactional-email-apis", () => {
  const data = published as TeardownData;

  test("its data file is internally consistent", () => {
    expect(data.slug).toBe("transactional-email-apis");
    expect(data.run.answers).toBe(60);
    expect(data.run.excluded_questions.length).toBe(2);
    for (const b of data.brands) expect(b.answers).toBeLessThanOrEqual(data.run.answers);
    for (const e of data.by_engine) {
      for (const b of e.brands) expect(b.answers).toBeLessThanOrEqual(e.answers);
    }
    // Per-engine counts add up to the totals.
    for (const b of data.brands) {
      const sum = data.by_engine.reduce((s, e) => s + (e.brands.find((x) => x.name === b.name)?.answers ?? 0), 0);
      expect(sum).toBe(b.answers);
    }
    if (data.highlight) expect(data.brands.some((b) => b.name === data.highlight)).toBe(true);
    expect(data.quotes.length).toBeGreaterThan(0);
  });

  test("the post is registered, in the sitemap, and its related links resolve", () => {
    expect(getPostBySlug(data.slug)).toBeDefined();
    const related = getRelatedPosts(data.slug);
    expect(related.length).toBe(3);
    expect(sitemap().map((e) => e.url)).toContain(`https://openllmrank.io/blog/${data.slug}`);
  });
});
