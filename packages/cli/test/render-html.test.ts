import { describe, expect, test } from "bun:test";
import type { CallRow, CitationRow, RunRow } from "../src/core/db";
import { computeGap, computeRates } from "../src/core/gap";
import { gapColor, renderHtmlReport, sparklinePath } from "../src/core/render-html";

const generatedAt = "2026-05-06T12:00:00.000Z";

function call(args: Partial<CallRow> & Pick<CallRow, "run_id" | "prompt_id" | "sample_index">): CallRow {
  return {
    ts: "2026-05-06T09:00:00.000Z",
    response_text: "Globex is often cited for analytics. Acme is a newer option.",
    search_results_json: "[]",
    latency_ms: 200,
    tokens_in: 100,
    tokens_out: 80,
    cost_usd: 0.025,
    error_code: null,
    error_message: null,
    ...args,
  };
}

function citation(args: Pick<CitationRow, "run_id" | "prompt_id" | "sample_index" | "brand">): CitationRow {
  return { matched_text: args.brand, kind: "name", ...args };
}

const prompts = [
  {
    prompt_id: "p1",
    prompt_text: "best privacy-friendly analytics tools",
    provider: "openai",
    model: "gpt-4o-mini",
    config_blob: "{}",
    created_at: "2026-05-06T00:00:00.000Z",
  },
  {
    prompt_id: "p2",
    prompt_text: "best product analytics for startups",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    config_blob: "{}",
    created_at: "2026-05-06T00:00:00.000Z",
  },
];

const calls = [
  call({ run_id: "r1", prompt_id: "p1", sample_index: 0, ts: "2026-05-05T09:00:00.000Z" }),
  call({ run_id: "r1", prompt_id: "p2", sample_index: 0, ts: "2026-05-05T09:01:00.000Z" }),
  call({ run_id: "r2", prompt_id: "p1", sample_index: 0, ts: "2026-05-06T09:00:00.000Z" }),
  call({ run_id: "r2", prompt_id: "p2", sample_index: 0, ts: "2026-05-06T09:01:00.000Z" }),
];

const citations = [
  citation({ run_id: "r1", prompt_id: "p1", sample_index: 0, brand: "Globex" }),
  citation({ run_id: "r1", prompt_id: "p2", sample_index: 0, brand: "Acme" }),
  citation({ run_id: "r2", prompt_id: "p1", sample_index: 0, brand: "Globex" }),
  citation({ run_id: "r2", prompt_id: "p2", sample_index: 0, brand: "Acme" }),
];

const runs: RunRow[] = [
  {
    run_id: "r1",
    started_at: "2026-05-05T09:00:00.000Z",
    finished_at: "2026-05-05T09:02:00.000Z",
    config_hash: "a",
  },
  {
    run_id: "r2",
    started_at: "2026-05-06T09:00:00.000Z",
    finished_at: "2026-05-06T09:02:00.000Z",
    config_hash: "b",
  },
];

function fixtureHtml(): string {
  const rates = computeRates(calls, citations, prompts, ["Acme", "Globex", "Initech"]);
  const gaps = computeGap(rates, "Acme", ["Globex", "Initech"]);
  return renderHtmlReport({
    brand_name: "Acme",
    competitor_names: ["Globex", "Initech"],
    rates,
    gaps,
    calls,
    citations,
    runs,
    since_iso: "2026-05-01T00:00:00.000Z",
    generated_at: generatedAt,
    project_version: "0.2.0",
    rolling_window_label: "7d",
  });
}

describe("renderHtmlReport helpers", () => {
  test("sparklinePath maps values into an SVG path", () => {
    expect(sparklinePath([0, 0.5, 1], 100, 20, 2)).toBe("M 2 18 L 50 10 L 98 2");
  });

  test("gapColor escalates large gaps", () => {
    expect(gapColor(0)).toBe("#476f53");
    expect(gapColor(0.3)).toBe("#b86b2b");
    expect(gapColor(0.6)).toBe("#9f3a21");
  });
});

describe("renderHtmlReport", () => {
  test("pins the high-level HTML structure", () => {
    const html = fixtureHtml();
    const structure = html
      .split("\n")
      .filter((line) => /^<(main|header|section|footer|script|h1|h2|table|select|\!doctype|html|head|body)/.test(line))
      .join("\n");
    expect(structure).toMatchSnapshot();
  });

  test("parses the generated HTML and finds the expected hero score", async () => {
    let heroScore = "";
    const rewriter = new HTMLRewriter().on('[data-testid="hero-score"]', {
      text(text) {
        heroScore += text.text;
      },
    });
    await rewriter.transform(new Response(fixtureHtml())).text();
    expect(heroScore).toBe("50%");
  });

  test("does not expose internal run costs in the customer HTML report", () => {
    const html = fixtureHtml();
    expect(html).not.toContain("Total run cost");
    expect(html).not.toContain("Total API + web-search fees");
  });
});
