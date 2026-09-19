// buildAgentReport: the agent-facing JSON rendering of a completed report.
// Pure, so the fixture is built with the CLI's own computeRates/computeGap.

import { describe, expect, test } from "bun:test";
import { HostedConfigSchema } from "@openllmrank/shared/config";
import type { CallRow, CitationRow, PromptRow } from "openllmrank/src/core/db";
import { computeGap, computeRates } from "openllmrank/src/core/gap";
import { buildAgentReport } from "../lib/agent-report";
import type { ReportData } from "../lib/report-data";

const cfg = HostedConfigSchema.parse({
  brand: { name: "Aave", aliases: [], website: "https://aave.com/" },
  competitors: [{ name: "Compound", aliases: [] }, { name: "Morpho", aliases: [] }],
  prompts: ["Where can I borrow against ETH?", "Safest DeFi lending protocols?"],
  providers: [
    { id: "openai", model: "gpt-5.4-mini" },
    { id: "perplexity", model: "sonar" },
  ],
  samples_per_prompt: 2,
  concurrency_per_provider: 4,
});

// prompt_id is per (question, provider), as the CLI stores it.
const prompts: PromptRow[] = [
  ["p1-openai", cfg.prompts[0]!, "openai"],
  ["p1-pplx", cfg.prompts[0]!, "perplexity"],
  ["p2-openai", cfg.prompts[1]!, "openai"],
  ["p2-pplx", cfg.prompts[1]!, "perplexity"],
].map(([prompt_id, prompt_text, provider]) => ({
  prompt_id: prompt_id!,
  prompt_text: prompt_text!,
  provider: provider!,
  model: "m",
  config_blob: "{}",
  created_at: "2026-09-19T00:00:00Z",
}));

const calls: CallRow[] = prompts.flatMap((p) =>
  [0, 1].map((sample_index) => ({
    run_id: "run1",
    prompt_id: p.prompt_id,
    sample_index,
    ts: "2026-09-19T00:00:00Z",
    response_text: "",
    search_results_json: "[]",
    latency_ms: 1,
    tokens_in: 1,
    tokens_out: 1,
    cost_usd: 0,
    error_code: null,
    error_message: null,
  })),
);

function cite(prompt_id: string, sample_index: number, brand: string, kind = "name", matched_text = brand): CitationRow {
  return { run_id: "run1", prompt_id, sample_index, brand, matched_text, kind };
}

// Aave wins question 1 everywhere; Compound wins question 2 on openai, and
// nobody is cited for question 2 on perplexity.
const citations: CitationRow[] = [
  cite("p1-openai", 0, "Aave"),
  cite("p1-openai", 1, "Aave"),
  cite("p1-pplx", 0, "Aave"),
  cite("p1-pplx", 1, "Aave"),
  cite("p1-pplx", 0, "Compound"),
  cite("p2-openai", 0, "Compound"),
  cite("p2-openai", 1, "Compound"),
  cite("p2-openai", 0, "Compound", "grounded_source", "https://compound.finance/safety"),
];

const names = ["Aave", "Compound", "Morpho"];
const rates = computeRates(calls, citations, prompts, names);
const data: ReportData = {
  cfg,
  brandName: "Aave",
  competitorNames: ["Compound", "Morpho"],
  runRows: [],
  callRows: calls,
  promptRows: prompts,
  citationRows: citations,
  rates,
  gaps: computeGap(rates, "Aave", ["Compound", "Morpho"]),
};

const metrics = {
  own_citation_rate: 0.5,
  share_of_voice: 0.57143,
  samples_total: 8,
  per_provider_jsonb: { openai: 0.5, perplexity: 0.5 },
  per_competitor_jsonb: [
    { name: "Morpho", rate: 0 },
    { name: "Compound", rate: 0.375 },
  ],
};

describe("buildAgentReport", () => {
  const report = buildAgentReport({
    data,
    metrics,
    failedCalls: 1,
    reportUrl: "https://openllmrank.io/reports/abc?t=tok",
  });

  test("headline numbers come from the stored run_metrics row", () => {
    expect(report.visibility).toEqual({
      citation_rate: 0.5,
      share_of_voice: 0.57143,
      answers_analyzed: 8,
      failed_calls: 1,
    });
    expect(report.top_competitor).toBe("Compound");
    expect(report.competitors[0]).toEqual({ name: "Compound", citation_rate: 0.375 });
    expect(report.summary).toContain("Aave was cited in 50% of 8 AI answers");
    expect(report.report_url).toContain("/reports/abc");
  });

  test("no strongest/weakest provider is claimed when the rates are equal", () => {
    expect(report.strongest_provider).toBeNull();
    expect(report.weakest_provider).toBeNull();
    expect(report.summary).not.toContain("highest on");
  });

  test("questions are pooled across assistants and labelled won or lost", () => {
    const [q1, q2] = report.prompts;
    expect(q1).toMatchObject({ brand_citation_rate: 1, outcome: "winning" });
    expect(q2).toMatchObject({
      brand_citation_rate: 0,
      outcome: "losing",
      leader: { name: "Compound", citation_rate: 0.5 },
    });
  });

  test("opportunities are real gaps only, with the competitor page the AI cited", () => {
    expect(report.opportunities).toHaveLength(1);
    expect(report.opportunities[0]).toMatchObject({
      provider: "openai",
      leading_competitor: "Compound",
      gap_points: 100,
      competitor_source_url: "https://compound.finance/safety",
    });
  });

  test("without a run_metrics row the numbers are null, not invented", () => {
    const bare = buildAgentReport({ data, metrics: null, failedCalls: 0, reportUrl: "u" });
    expect(bare.visibility.citation_rate).toBeNull();
    expect(bare.competitors).toEqual([]);
    expect(bare.summary).toBe("Aave trails a competitor on 1 of 2 buyer questions.");
  });
});
