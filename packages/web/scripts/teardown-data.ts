#!/usr/bin/env bun
/**
 * Turn one local CLI run into the data for a public teardown post.
 *
 *   bun scripts/teardown-data.ts \
 *     --db ../../teardowns/transactional-email-apis/data/openllmrank.db \
 *     --config ../../teardowns/transactional-email-apis/openllmrank.config.json \
 *     --slug transactional-email-apis \
 *     --exclude "Resend vs Postmark vs SendGrid for transactional email"
 *
 * Writes two files:
 *   content/teardowns/<slug>.json          the post's numbers (brand share,
 *                                          per-engine split, cited domains,
 *                                          quote candidates, run metadata)
 *   public/teardowns/<slug>/report.html    the full CLI report for that run,
 *                                          a permanent static copy the post
 *                                          links to as its receipts
 *
 * --exclude "<question>" (repeatable) leaves a question out of every count,
 * for questions that name brands themselves ("A vs B vs C"). The full report
 * still shows its answers.
 *
 * --run <run_id> picks a run; the default is the newest finished one. After
 * generating, trim `quotes` in the JSON to the ones the post shows.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  findLatestFinishedRun,
  getPrompts,
  getRunsForCalls,
  openDb,
  type CallRow,
  type CitationRow,
} from "openllmrank/src/core/db";
import { computeGap, computeRates } from "openllmrank/src/core/gap";
import { renderHtmlReport } from "openllmrank/src/core/render-html";
import { PRODUCT_VERSION } from "openllmrank/src/version";
import { buildTeardown } from "../lib/teardown";

const { values } = parseArgs({
  options: {
    db: { type: "string" },
    config: { type: "string" },
    slug: { type: "string" },
    run: { type: "string" },
    highlight: { type: "string" },
    exclude: { type: "string", multiple: true },
  },
});

function fail(msg: string): never {
  console.error(`! ${msg}`);
  process.exit(1);
}

if (!values.db || !values.config || !values.slug) {
  fail("Usage: teardown-data.ts --db <path> --config <path> --slug <slug> [--run <id>] [--highlight <brand>] [--exclude <question>]...");
}
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(values.slug)) fail(`Slug '${values.slug}' must be lowercase words joined by hyphens.`);

type CliConfig = {
  brand: { name: string; website?: string };
  competitors: { name: string }[];
  providers: { id: string; model: string }[];
};
const cfg = JSON.parse(readFileSync(values.config, "utf8")) as CliConfig;
const brandNames = [cfg.brand.name, ...cfg.competitors.map((c) => c.name)];
if (values.highlight && !brandNames.includes(values.highlight)) {
  fail(`--highlight '${values.highlight}' is not a brand in the config (${brandNames.join(", ")}).`);
}

const db = openDb(values.db);
const runId = values.run ?? findLatestFinishedRun(db) ?? fail("No finished run in this database.");
const run = getRunsForCalls(db, [runId])[0] ?? fail(`Run '${runId}' not found.`);

const calls = db.query<CallRow, [string]>(`SELECT * FROM calls WHERE run_id = ? ORDER BY ts`).all(runId);
const citations = db.query<CitationRow, [string]>(`SELECT * FROM citations WHERE run_id = ?`).all(runId);
const prompts = getPrompts(db, [...new Set(calls.map((c) => c.prompt_id))]);

const data = buildTeardown({
  slug: values.slug,
  highlight: values.highlight,
  excludeQuestions: values.exclude,
  brands: brandNames,
  run,
  calls,
  citations,
  prompts,
});

const webRoot = join(import.meta.dir, "..");
const jsonPath = join(webRoot, "content", "teardowns", `${values.slug}.json`);
const reportPath = join(webRoot, "public", "teardowns", values.slug, "report.html");

const okCitations = citations.filter((c) => calls.some((k) => k.prompt_id === c.prompt_id && k.sample_index === c.sample_index && k.error_code === null));
const rates = computeRates(calls, okCitations, prompts, brandNames);
const html = renderHtmlReport({
  brand_name: cfg.brand.name,
  competitor_names: cfg.competitors.map((c) => c.name),
  rates,
  gaps: computeGap(rates, cfg.brand.name, cfg.competitors.map((c) => c.name)),
  calls,
  citations: okCitations,
  runs: [run],
  since_iso: run.started_at,
  generated_at: run.finished_at ?? run.started_at,
  project_version: PRODUCT_VERSION,
  rolling_window_label: `run ${data.run.date}`,
  brand_website: cfg.brand.website,
  prompts,
  configured_models: cfg.providers.map((p) => ({ provider: p.id, model: p.model })),
});

for (const path of [jsonPath, reportPath]) mkdirSync(dirname(path), { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);
writeFileSync(reportPath, html);

console.log(`+ Wrote ${jsonPath}`);
console.log(`+ Wrote ${reportPath}`);
console.log(`  ${data.run.answers} answers, ${data.run.engines.length} engines, $${data.run.cost_usd.toFixed(2)}`);
for (const b of data.brands) console.log(`  ${b.name.padEnd(16)} ${b.answers}/${data.run.answers}`);
console.log(`  ${data.quotes.length} quote candidates: trim them in the JSON before publishing.`);
