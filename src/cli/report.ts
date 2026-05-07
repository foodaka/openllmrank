import { writeFileSync } from "node:fs";
import { defineCommand } from "citty";
import { getCallsSince, getCitationsSince, getPrompts, getRunsForCalls, openDb } from "../core/db";
import { computeGap, computeRates, renderGapReport } from "../core/gap";
import { renderHtmlReport } from "../core/render-html";
import { loadConfig } from "./config-loader";
import pkg from "../../package.json";

function parseSince(spec: string): string {
  const match = /^(\d+)([hd])$/.exec(spec);
  if (match) {
    const n = Number.parseInt(match[1]!, 10);
    const unit = match[2];
    const ms = unit === "h" ? n * 60 * 60 * 1000 : n * 24 * 60 * 60 * 1000;
    return new Date(Date.now() - ms).toISOString();
  }
  const d = new Date(spec);
  if (Number.isNaN(d.getTime())) {
    console.error(`! Invalid --since value '${spec}'. Try '7d', '24h', or an ISO timestamp.`);
    process.exit(1);
  }
  return d.toISOString();
}

export const reportCmd = defineCommand({
  meta: {
    name: "report",
    description: "Generate a gap-analysis report from stored runs",
  },
  args: {
    config: { type: "string", default: "openllmrank.config.json" },
    db: { type: "string", default: "data/openllmrank.db" },
    since: { type: "string", default: "7d" },
    output: { type: "string" },
    html: { type: "boolean", default: false },
  },
  async run({ args }) {
    const cfg = loadConfig(args.config);
    const db = openDb(args.db);
    const since_iso = parseSince(args.since);
    const calls = getCallsSince(db, since_iso);
    const citations = getCitationsSince(db, since_iso);
    const prompt_ids = Array.from(new Set(calls.map((c) => c.prompt_id)));
    const prompts = getPrompts(db, prompt_ids);
    const runs = getRunsForCalls(db, Array.from(new Set(calls.map((c) => c.run_id))));

    const brand_names = [cfg.brand.name, ...cfg.competitors.map((c) => c.name)];
    const rates = computeRates(calls, citations, prompts, brand_names);
    const gaps = computeGap(
      rates,
      cfg.brand.name,
      cfg.competitors.map((c) => c.name),
    );
    const output = args.output ?? (args.html ? "gap-report.html" : "gap-report.md");
    const report = args.html
      ? renderHtmlReport({
          brand_name: cfg.brand.name,
          competitor_names: cfg.competitors.map((c) => c.name),
          rates,
          gaps,
          calls,
          citations,
          runs,
          since_iso,
          generated_at: new Date().toISOString(),
          project_version: pkg.version,
          rolling_window_label: args.since,
        })
      : renderGapReport(gaps, cfg.brand.name, since_iso);
    writeFileSync(output, report);
    console.log(`+ Wrote ${output}`);
    if (calls.length === 0) {
      console.log(`(No data in window since ${since_iso}. Run 'openllmrank run' first.)`);
    } else {
      console.log(`Window: ${calls.length} calls, ${citations.length} citation rows.`);
    }
  },
});
