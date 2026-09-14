#!/usr/bin/env bun
// Dogfood CLI: run the crawl check against a live domain from the terminal.
//
//   bun run packages/crawl/bin/crawl-check.ts openllmrank.io
//   bun run packages/crawl/bin/crawl-check.ts openllmrank.io --json
//   bun run packages/crawl/bin/crawl-check.ts openllmrank.io --max-pages 50

import { runCheck } from "../src/crawler";
import { domainInputToOrigin } from "../src/normalize";
import { buildFixPrompt } from "../src/fix-prompt";
import { describeFinding } from "../src/describe";

const args = process.argv.slice(2);
const domain = args.find((a) => !a.startsWith("--"));
const asJson = args.includes("--json");
const maxPagesIdx = args.indexOf("--max-pages");
const maxPages = maxPagesIdx >= 0 ? Number(args[maxPagesIdx + 1]) : undefined;

if (!domain) {
  console.error("Usage: crawl-check <domain> [--json] [--max-pages N]");
  process.exit(1);
}

const origin = domainInputToOrigin(domain);
if (!origin) {
  console.error(`Not a checkable domain: ${domain}`);
  process.exit(1);
}


const started = Date.now();
console.error(`Checking ${origin} ...`);

const result = await runCheck(origin, {
  maxPages,
  onPhase1: (p) => {
    console.error(
      `  phase 1: robots=${p.robots_txt_found ? "found" : "missing"} sitemap=${p.sitemap_found ? `found (${p.sitemap_urls.length} URLs)` : "missing"} blocked-bots=${p.bot_access.filter((b) => !b.allowed).map((b) => b.bot).join(",") || "none"}`,
    );
  },
  onProgress: (p) => {
    console.error(`  crawled ${p.pages_crawled}/${p.pages_discovered} discovered pages...`);
  },
});

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const secs = Math.round((Date.now() - started) / 1000);
console.log(`\n${origin} — ${result.state.toUpperCase()} (${result.pages_crawled} pages, ${secs}s)`);
if (result.failure_reason) console.log(`Failure: ${result.failure_reason}`);

const headline = result.findings.filter((f) => f.tier === "headline");
const secondary = result.findings.filter((f) => f.tier === "secondary");

console.log(`\nHEADLINE FINDINGS (${headline.length})`);
for (const f of headline) console.log(`  [${f.severity}] ${describeFinding(f)}`);
if (headline.length === 0) console.log("  none — crawl paths look healthy");

console.log(`\nSECONDARY (${secondary.length})`);
for (const f of secondary) console.log(`  [${f.severity}] ${describeFinding(f)}`);

const prompt = buildFixPrompt(result);
if (prompt) {
  console.log("\n──── copy-paste fix prompt for your agent ────\n");
  console.log(prompt);
}
