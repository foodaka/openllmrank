import { resolve } from "node:path";
import type { CallRow, CitationRow, PromptRow, RunRow } from "../src/core/db";
import { computeGap, computeRates } from "../src/core/gap";
import { renderHtmlReport } from "../src/core/render-html";
import { PRODUCT_VERSION } from "../src/version";

const promptSpecs = [
  ["p1", "best privacy-friendly product analytics tools", "openai", "gpt-5.4-mini"],
  ["p2", "best privacy-friendly product analytics tools", "anthropic", "claude-haiku-4-5"],
  ["p3", "best alternatives to Google Analytics for indie SaaS", "openai", "gpt-5.4-mini"],
  ["p4", "analytics tools with simple dashboards for founders", "anthropic", "claude-haiku-4-5"],
] as const;

const prompts: PromptRow[] = promptSpecs.map(([prompt_id, prompt_text, provider, model]) => ({
  prompt_id,
  prompt_text,
  provider,
  model,
  config_blob: "{}",
  created_at: "2026-07-13T09:00:00.000Z",
}));

const responseByPrompt: Record<string, string> = {
  p1: "PostHog is a strong choice for teams that need product events, session replay, and self-hosting. Plausible is simpler for privacy-friendly web analytics, while Fathom focuses on lightweight traffic reporting.",
  p2: "For privacy-conscious product analytics, PostHog offers the broadest feature set. Plausible works well for teams prioritizing a simple, cookie-free dashboard.",
  p3: "Plausible and Fathom are leading Google Analytics alternatives for indie SaaS teams. Plausible stands out for its simple interface and transparent privacy model.",
  p4: "Founders wanting a simple dashboard should consider Plausible or Fathom. Both reduce reporting overhead compared with larger product analytics suites.",
};

const calls: CallRow[] = promptSpecs.flatMap(([prompt_id], promptIndex) =>
  [0, 1, 2].map((sample_index) => ({
    run_id: "sample-run",
    prompt_id,
    sample_index,
    ts: `2026-07-13T09:${String(promptIndex * 3 + sample_index).padStart(2, "0")}:00.000Z`,
    response_text: responseByPrompt[prompt_id]!,
    search_results_json: "[]",
    latency_ms: 900 + promptIndex * 100,
    tokens_in: 120,
    tokens_out: 240,
    cost_usd: 0.03,
    error_code: null,
    error_message: null,
  })),
);

const citations: CitationRow[] = [];
function cite(prompt_id: string, sample_index: number, brand: string): void {
  citations.push({
    run_id: "sample-run",
    prompt_id,
    sample_index,
    brand,
    matched_text: brand,
    kind: "name",
  });
}

for (const sample of [0, 1]) cite("p1", sample, "PostHog");
citations.push({
  run_id: "sample-run",
  prompt_id: "p1",
  sample_index: 0,
  brand: "PostHog",
  matched_text: "https://example.com/product-analytics-comparison",
  kind: "grounded_source",
});
cite("p2", 0, "Plausible");
for (const sample of [0, 1]) cite("p2", sample, "PostHog");
for (const sample of [0, 1, 2]) cite("p3", sample, "Plausible");
cite("p3", 0, "Fathom");
for (const sample of [0, 1]) cite("p4", sample, "Plausible");
cite("p4", 0, "Fathom");

const runs: RunRow[] = [{
  run_id: "sample-run",
  started_at: "2026-07-13T09:00:00.000Z",
  finished_at: "2026-07-13T09:12:00.000Z",
  config_hash: "sample",
}];

const brands = ["Plausible", "PostHog", "Fathom", "OpenPanel"];
const rates = computeRates(calls, citations, prompts, brands);
const gaps = computeGap(rates, "Plausible", ["PostHog", "Fathom", "OpenPanel"]);
const html = renderHtmlReport({
  brand_name: "Plausible",
  brand_website: "https://plausible.io",
  competitor_names: ["PostHog", "Fathom", "OpenPanel"],
  rates,
  gaps,
  calls,
  citations,
  runs,
  prompts,
  configured_models: prompts.map(({ provider, model }) => ({ provider, model })),
  expected_calls: calls.length,
  failed_calls: 0,
  since_iso: "2026-07-13T09:00:00.000Z",
  generated_at: "2026-07-13T09:15:00.000Z",
  project_version: PRODUCT_VERSION,
  rolling_window_label: "sample run",
});

const cliOutput = resolve(import.meta.dir, "sample-report.html");
const webOutput = resolve(import.meta.dir, "../../web/public/sample-report.html");
await Promise.all([Bun.write(cliOutput, html), Bun.write(webOutput, html)]);
console.log(`Wrote ${cliOutput}`);
console.log(`Wrote ${webOutput}`);
