import { describe, expect, test } from "bun:test";
import type { CallRow, CitationRow, PromptRow } from "openllmrank/src/core/db";
import { buildRunMetrics } from "../src/run-metrics";

const prompt = (id: string, text: string, provider = "openai"): PromptRow => ({
  prompt_id: id,
  prompt_text: text,
  model: "gpt-4o-mini",
  provider,
  config_blob: "{}",
  created_at: "2026-08-12T00:00:00.000Z",
});

const call = (prompt_id: string, sample_index = 0): CallRow => ({
  run_id: "run-1",
  prompt_id,
  sample_index,
  ts: "2026-08-12T00:00:00.000Z",
  response_text: "answer",
  search_results_json: "[]",
  latency_ms: 1,
  tokens_in: 1,
  tokens_out: 1,
  cost_usd: 0,
  error_code: null,
  error_message: null,
});

const citation = (
  prompt_id: string,
  brand: string,
  sample_index = 0,
): CitationRow => ({
  run_id: "run-1",
  prompt_id,
  sample_index,
  brand,
  matched_text: brand,
  kind: "name",
});

describe("buildRunMetrics", () => {
  test("computes weighted rates, share of voice, provider rates, and the prompt-level gap", () => {
    const metrics = buildRunMetrics({
      calls: [call("p1"), call("p2")],
      citations: [citation("p1", "Acme"), citation("p2", "Rival")],
      prompts: [prompt("p1", "best CRM"), prompt("p2", "best support tool")],
      brand_name: "Acme",
      competitor_names: ["Rival"],
    });

    expect(metrics).toEqual({
      own_citation_rate: 0.5,
      share_of_voice: 0.5,
      samples_total: 2,
      per_provider_jsonb: { openai: 0.5 },
      per_competitor_jsonb: [{ name: "Rival", rate: 0.5 }],
      top_gap_prompt: "best support tool",
      top_gap_score: 1,
    });
  });

  test("stores zero instead of null when the brand is never cited", () => {
    const metrics = buildRunMetrics({
      calls: [call("p1")],
      citations: [],
      prompts: [prompt("p1", "best CRM")],
      brand_name: "Acme",
      competitor_names: ["Rival"],
    });

    expect(metrics.own_citation_rate).toBe(0);
    expect(metrics.share_of_voice).toBe(0);
    expect(metrics.samples_total).toBe(1);
    expect(metrics.per_provider_jsonb).toEqual({ openai: 0 });
  });

  test("keeps a zero-success run at zero without inventing a metric row", () => {
    const metrics = buildRunMetrics({
      calls: [],
      citations: [],
      prompts: [prompt("p1", "best CRM")],
      brand_name: "Acme",
      competitor_names: ["Rival"],
    });

    expect(metrics).toEqual({
      own_citation_rate: 0,
      share_of_voice: 0,
      samples_total: 0,
      per_provider_jsonb: {},
      per_competitor_jsonb: [{ name: "Rival", rate: 0 }],
      top_gap_prompt: null,
      top_gap_score: null,
    });
  });
});
