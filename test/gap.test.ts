import { describe, expect, test } from "bun:test";
import type { CallRow, CitationRow, PromptRow } from "../src/core/db";
import { computeGap, computeRates, renderGapReport } from "../src/core/gap";

function mkPrompt(prompt_id: string, prompt_text: string, provider: string): PromptRow {
  return {
    prompt_id,
    prompt_text,
    model: "gpt-4o-mini",
    provider,
    config_blob: "{}",
    created_at: "2026-05-06T00:00:00Z",
  };
}

function mkCall(prompt_id: string, sample_index: number, error_code: string | null = null): CallRow {
  return {
    run_id: "r1",
    prompt_id,
    sample_index,
    ts: "2026-05-06T00:00:00Z",
    response_text: "x",
    search_results_json: "[]",
    latency_ms: 0,
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    error_code,
    error_message: null,
  };
}

function mkCitation(prompt_id: string, sample_index: number, brand: string): CitationRow {
  return {
    run_id: "r1",
    prompt_id,
    sample_index,
    brand,
    matched_text: brand,
    kind: "name",
  };
}

describe("computeRates", () => {
  test("empty inputs return empty", () => {
    expect(computeRates([], [], [], [])).toEqual([]);
  });

  test("brand cited 1/3 samples", () => {
    const prompts = [mkPrompt("p1", "best tool", "openai")];
    const calls = [mkCall("p1", 0), mkCall("p1", 1), mkCall("p1", 2)];
    const cits = [mkCitation("p1", 0, "Acme")];
    const rates = computeRates(calls, cits, prompts, ["Acme"]);
    expect(rates).toHaveLength(1);
    expect(rates[0]?.samples_total).toBe(3);
    expect(rates[0]?.samples_with_citation).toBe(1);
    expect(rates[0]?.rate).toBeCloseTo(1 / 3);
  });

  test("excludes calls with error_code != null", () => {
    const prompts = [mkPrompt("p1", "x", "openai")];
    const calls = [mkCall("p1", 0), mkCall("p1", 1, "rate_limit")];
    const cits = [mkCitation("p1", 0, "Acme")];
    const rates = computeRates(calls, cits, prompts, ["Acme"]);
    expect(rates[0]?.samples_total).toBe(1);
  });

  test("multiple citations in same sample count once", () => {
    const prompts = [mkPrompt("p1", "x", "openai")];
    const calls = [mkCall("p1", 0)];
    const cits = [mkCitation("p1", 0, "Acme"), mkCitation("p1", 0, "Acme")];
    const rates = computeRates(calls, cits, prompts, ["Acme"]);
    expect(rates[0]?.samples_with_citation).toBe(1);
  });

  test("brand with zero citations gets rate 0", () => {
    const prompts = [mkPrompt("p1", "x", "openai")];
    const calls = [mkCall("p1", 0), mkCall("p1", 1)];
    const rates = computeRates(calls, [], prompts, ["Acme"]);
    expect(rates[0]?.rate).toBe(0);
  });

  test("citations from different runs at same sample_index are NOT collapsed", () => {
    const prompts = [mkPrompt("p1", "x", "openai")];
    // 4 successful calls: 2 per run, sample_index 0 and 1 in each
    const callRun1Sample0 = { ...mkCall("p1", 0), run_id: "r1" };
    const callRun1Sample1 = { ...mkCall("p1", 1), run_id: "r1" };
    const callRun2Sample0 = { ...mkCall("p1", 0), run_id: "r2" };
    const callRun2Sample1 = { ...mkCall("p1", 1), run_id: "r2" };
    const calls = [callRun1Sample0, callRun1Sample1, callRun2Sample0, callRun2Sample1];
    // Acme cited in both runs at sample 0
    const cits = [
      { ...mkCitation("p1", 0, "Acme"), run_id: "r1" },
      { ...mkCitation("p1", 0, "Acme"), run_id: "r2" },
    ];
    const rates = computeRates(calls, cits, prompts, ["Acme"]);
    // 2 cited samples (one per run) out of 4 total samples = 0.5
    expect(rates[0]?.samples_total).toBe(4);
    expect(rates[0]?.samples_with_citation).toBe(2);
    expect(rates[0]?.rate).toBeCloseTo(0.5);
  });
});

describe("computeGap", () => {
  test("returns sorted by gap_score descending", () => {
    const prompts = [mkPrompt("p1", "best", "openai"), mkPrompt("p2", "vs", "openai")];
    const calls = [mkCall("p1", 0), mkCall("p1", 1), mkCall("p2", 0), mkCall("p2", 1)];
    const cits = [
      mkCitation("p1", 0, "Globex"),
      mkCitation("p1", 1, "Globex"),
      mkCitation("p2", 0, "Acme"),
    ];
    const rates = computeRates(calls, cits, prompts, ["Acme", "Globex"]);
    const gaps = computeGap(rates, "Acme", ["Globex"]);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]?.gap_score).toBeGreaterThan(gaps[1]?.gap_score!);
  });

  test("brand winning gives negative gap_score", () => {
    const prompts = [mkPrompt("p1", "x", "openai")];
    const calls = [mkCall("p1", 0), mkCall("p1", 1)];
    const cits = [mkCitation("p1", 0, "Acme"), mkCitation("p1", 1, "Acme")];
    const rates = computeRates(calls, cits, prompts, ["Acme", "Globex"]);
    const gaps = computeGap(rates, "Acme", ["Globex"]);
    expect(gaps[0]?.gap_score).toBeLessThanOrEqual(0);
  });

  test("competitors sorted by rate descending", () => {
    const prompts = [mkPrompt("p1", "x", "openai")];
    const calls = [mkCall("p1", 0), mkCall("p1", 1)];
    const cits = [mkCitation("p1", 0, "Initech"), mkCitation("p1", 1, "Globex")];
    const rates = computeRates(calls, cits, prompts, ["Acme", "Globex", "Initech"]);
    const gaps = computeGap(rates, "Acme", ["Globex", "Initech"]);
    expect(gaps[0]?.competitors[0]?.rate).toBeGreaterThanOrEqual(
      gaps[0]?.competitors[1]?.rate ?? 0,
    );
  });
});

describe("renderGapReport", () => {
  test("empty gaps returns 'No data yet' message", () => {
    const md = renderGapReport([], "Acme", "2026-05-01");
    expect(md).toContain("No data yet");
  });

  test("includes losing and winning sections", () => {
    const prompts = [mkPrompt("p1", "best", "openai"), mkPrompt("p2", "vs", "openai")];
    const calls = [mkCall("p1", 0), mkCall("p2", 0)];
    const cits = [mkCitation("p1", 0, "Globex"), mkCitation("p2", 0, "Acme")];
    const rates = computeRates(calls, cits, prompts, ["Acme", "Globex"]);
    const gaps = computeGap(rates, "Acme", ["Globex"]);
    const md = renderGapReport(gaps, "Acme", "2026-05-01");
    expect(md).toContain("Where you're losing");
    expect(md).toContain("Where you're winning");
  });
});
