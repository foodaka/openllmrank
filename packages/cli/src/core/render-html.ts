import type { CallRow, CitationRow, PromptRow, RunRow } from "./db";
import type { CitationRate, GapRow } from "./gap";

export type HtmlReportArgs = {
  brand_name: string;
  competitor_names: string[];
  rates: CitationRate[];
  gaps: GapRow[];
  calls: CallRow[];
  citations: CitationRow[];
  runs: RunRow[];
  since_iso: string;
  generated_at: string;
  project_version: string;
  rolling_window_label?: string;
  brand_website?: string;
  prompts?: PromptRow[];
  configured_models?: Array<{ provider: string; model: string }>;
  expected_calls?: number;
  failed_calls?: number;
};

type HistoryPoint = {
  run_id: string;
  label: string;
  rates: Map<string, number>;
};

const REPO_URL = "https://github.com/foodaka/openllmrank";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

const INFO_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

export function infoTip(text: string, align: "center" | "right" = "center"): string {
  const alignAttr = align === "right" ? ' data-align="right"' : "";
  return `<span class="info-wrap"${alignAttr}><button type="button" class="info" aria-label="${escapeHtml(text)}">${INFO_ICON_SVG}</button><span class="info-tip" aria-hidden="true">${escapeHtml(text)}</span></span>`;
}

export function gapColor(value: number): string {
  if (value >= 0.5) return "#9f3a21";
  if (value >= 0.25) return "#b86b2b";
  if (value > 0) return "#c99544";
  return "#476f53";
}

export function sparklinePath(values: number[], width = 160, height = 34, pad = 2): string {
  if (values.length === 0) return "";
  if (values.length === 1) {
    const y = height - pad - values[0]! * (height - pad * 2);
    return `M ${pad} ${round(y)} L ${width - pad} ${round(y)}`;
  }
  const step = (width - pad * 2) / (values.length - 1);
  return values
    .map((v, i) => {
      const x = pad + i * step;
      const y = height - pad - v * (height - pad * 2);
      return `${i === 0 ? "M" : "L"} ${round(x)} ${round(y)}`;
    })
    .join(" ");
}

export function renderHtmlReport(args: HtmlReportArgs): string {
  const brandRateRows = args.rates.filter((r) => r.brand === args.brand_name);
  const visibility = computeVisibility(brandRateRows);
  const history = computeHistory(args);
  const trend = computeVisibilityTrend(args);
  const losing = args.gaps.filter((g) => g.gap_score > 0);
  const winning = args.gaps.filter((g) => g.gap_score <= 0);
  const topCompetitors = topCompetitorNames(args.rates, args.competitor_names);
  const successfulSamples = args.calls.filter((call) => call.error_code === null).length;
  const failedSamples = args.failed_calls ?? args.calls.filter((call) => call.error_code !== null).length;
  const expectedSamples = args.expected_calls ?? successfulSamples + failedSamples;
  const coverage = expectedSamples > 0 ? successfulSamples / expectedSamples : 0;
  const dateRange = formatDateRange(args.calls, args.since_iso);
  const providerChart = renderProviderChart(args.rates, args.brand_name, topCompetitors);
  const historyChart = renderHistory(history, [args.brand_name, ...topCompetitors]);
  const noData = successfulSamples === 0;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(args.brand_name)} AI visibility report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=DM+Sans:wght@400;500;600;700&display=swap">
<style>
:root{--paper:#fbf8f0;--ink:#241f19;--muted:#756c60;--line:#e3d8c6;--soft:#f2eadc;--accent:#376b5b;--accent-2:#b86b2b;--win:#476f53;--loss:#9f3a21}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:"DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;line-height:1.48}.wrap{max-width:1120px;margin:0 auto;padding:48px 28px 36px}header{display:grid;grid-template-columns:1.3fr .7fr;gap:28px;border-bottom:1px solid var(--line);padding-bottom:30px}.kicker{font-size:12px;text-transform:uppercase;letter-spacing:.11em;color:var(--accent);font-weight:700}.brand{font-family:"Fraunces",Georgia,"Times New Roman",serif;font-size:54px;line-height:.98;margin:10px 0 16px;font-weight:500}.sub{color:var(--muted);max-width:670px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px}.meta div,.panel{background:rgba(255,255,255,.38);border:1px solid var(--line);border-radius:7px}.meta div{padding:13px}.label{font-size:12px;color:var(--muted);display:block}.value{font-weight:700}.info-wrap{position:relative;display:inline-block;width:15px;height:15px;margin-left:5px;vertical-align:middle;line-height:0}.info{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:inline-flex;width:44px;height:44px;background:transparent;color:var(--muted);align-items:center;justify-content:center;cursor:help;padding:0;border:0;border-radius:50%;transition:color .12s}.info svg{width:15px;height:15px;display:block}.info:hover,.info:focus-visible{color:var(--accent)}.info-tip{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(100% + 8px);background:var(--ink);color:#fbf8f0;font:400 12px/1.42 "DM Sans",sans-serif;padding:9px 11px;border-radius:5px;width:240px;text-align:left;letter-spacing:0;text-transform:none;opacity:0;pointer-events:none;transition:opacity .12s;z-index:10;white-space:normal}.info-tip::after{content:"";position:absolute;left:50%;top:100%;transform:translateX(-50%);border:5px solid transparent;border-top-color:var(--ink)}.info-wrap[data-align="right"] .info-tip{left:auto;right:-6px;transform:none}.info-wrap[data-align="right"] .info-tip::after{left:auto;right:10px;transform:none}.info-wrap:hover .info-tip,.info-wrap:focus-within .info-tip{opacity:1}.hero{display:grid;grid-template-columns:.9fr 1.1fr;gap:26px;padding:34px 0}.score{border-left:6px solid var(--accent);padding:4px 0 6px 24px}.score strong{font-family:"Fraunces",Georgia,"Times New Roman",serif;font-size:96px;line-height:.88;font-weight:500}.trend{display:inline-flex;gap:7px;align-items:center;margin-top:12px;color:var(--muted)}.trend b{color:var(--accent)}.panel{padding:22px}.panel h2,.section h2{font-family:"Fraunces",Georgia,"Times New Roman",serif;font-weight:500;font-size:28px;margin:0 0 16px}.section{padding:28px 0;border-top:1px solid var(--line)}table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--line);padding:11px 10px}td{padding:13px 10px;border-bottom:1px solid var(--line);vertical-align:top}.provider{font-weight:700;text-transform:capitalize}.prompt{max-width:430px}.rate{font-variant-numeric:tabular-nums}.bar{height:9px;background:var(--soft);border-radius:999px;overflow:hidden;min-width:92px}.bar span{display:block;height:100%;border-radius:999px}.gapcell{display:grid;grid-template-columns:48px 1fr;gap:10px;align-items:center}.response{margin-top:10px;color:var(--muted);font-size:13px;background:#fffaf1;border:1px solid var(--line);border-radius:6px;padding:12px;max-width:720px}.mark-brand{background:#dbe7de;color:#183f33;border-radius:3px;padding:0 2px}.mark-competitor{background:#f0dcc6;color:#6f351c;border-radius:3px;padding:0 2px}.two{display:grid;grid-template-columns:1fr 1fr;gap:22px}.chart-row{display:grid;grid-template-columns:110px 1fr 46px;gap:12px;align-items:center;margin:12px 0}.chart-track{height:12px;background:var(--soft);border-radius:999px;overflow:hidden}.chart-track span{display:block;height:100%;background:var(--accent);border-radius:999px}.select{border:1px solid var(--line);background:#fffaf1;border-radius:6px;padding:8px 10px;color:var(--ink);margin-bottom:10px}.spark{width:100%;height:42px}.spark path{fill:none;stroke:var(--accent);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}.muted{color:var(--muted)}footer{display:flex;justify-content:space-between;gap:20px;color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:22px}a{color:var(--accent);text-decoration:none}a:focus-visible,.info:focus-visible,.select:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}@media (max-width:820px){.wrap{padding:32px 18px}header,.hero,.two{grid-template-columns:1fr}.brand{font-size:42px}.score strong{font-size:76px}.meta{grid-template-columns:1fr}table{font-size:13px}.prompt{max-width:none}footer{display:block}}
.response{line-height:1.58;padding:14px;max-height:360px;overflow:auto}
.response p{margin:0 0 10px}
.response p:last-child{margin-bottom:0}
.response ol{margin:0 0 10px 20px;padding:0}
.response li{margin:0 0 8px}
.response strong,.response-heading{color:var(--ink)}
.response-heading{font-weight:700}
.coverage-warning{margin:0 0 28px;padding:14px 16px;border-left:4px solid var(--accent-2);background:var(--soft);color:var(--ink)}.actions{display:grid}.action{display:grid;grid-template-columns:120px minmax(0,1fr);column-gap:24px;padding:20px 0;border-top:1px solid var(--line)}.action:last-child{border-bottom:1px solid var(--line)}.action-rank{grid-row:1/span 4;color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}.action>:not(.action-rank){grid-column:2}.action h3{font-family:"Fraunces",Georgia,"Times New Roman",serif;font-size:24px;line-height:1.15;margin:0 0 10px;font-weight:500}.action p{font-size:16px;line-height:1.55;margin:0 0 10px}.methodology{display:grid;grid-template-columns:1fr 1fr;gap:22px}.methodology p{margin:0 0 12px}.methodology ul{margin:0;padding-left:18px}.methodology li{margin:0 0 7px}@media (max-width:820px){.action{grid-template-columns:1fr;gap:8px}.action-rank{grid-row:auto}.action>:not(.action-rank){grid-column:1}.methodology{grid-template-columns:1fr}}
</style>
</head>
<body>
<main class="wrap">
<header>
<div>
<div class="kicker">Grounded LLM visibility</div>
<h1 class="brand">${escapeHtml(args.brand_name)}</h1>
<p class="sub">${escapeHtml(dateRange)}${args.rolling_window_label ? ` · ${escapeHtml(args.rolling_window_label)}` : ""}. Generated ${escapeHtml(formatDateTime(args.generated_at))}.</p>
</div>
<div class="meta">
<div><span class="label">Runs ${infoTip("One run is a full sweep across all prompts × providers × samples. Typically run weekly.")}</span><span class="value">${args.runs.length}</span></div>
<div><span class="label">Coverage ${infoTip("Successful calls divided by planned calls. Partial provider failures are disclosed here rather than silently omitted.", "right")}</span><span class="value">${formatPercent(coverage)} (${successfulSamples}/${expectedSamples})</span></div>
<div><span class="label">Providers ${infoTip("Distinct AI models queried (e.g. OpenAI, Anthropic).")}</span><span class="value">${new Set(brandRateRows.map((r) => r.provider)).size}</span></div>
</div>
</header>
${failedSamples > 0 ? `<div class="coverage-warning"><strong>Partial data:</strong> ${failedSamples} of ${expectedSamples} planned calls failed. Scores use the ${successfulSamples} successful calls only, so compare this report cautiously.</div>` : ""}
<section class="hero">
<div class="score">
<span class="label">AI visibility score ${infoTip("Percent of prompt-provider pairs where your brand was cited in at least one sample.")}</span>
<strong data-testid="hero-score">${formatPercent(visibility)}</strong>
<div class="trend">${renderTrend(trend)}</div>
</div>
<div class="panel">
<h2>Signal</h2>
<p class="muted">${noData ? "No successful calls in this window yet. Run openllmrank run first." : `${escapeHtml(args.brand_name)} appears in ${formatPercent(visibility)} of prompt-provider pairs at least once. The tables below separate prompts where competitors lead from prompts where your brand is tied or ahead.`}</p>
</div>
</section>
<section class="section">
<h2>Priority actions</h2>
${renderPriorityActions(losing, args)}
</section>
<section class="section">
<h2>Gap analysis</h2>
${renderGapTable(losing, args, "No losing rows in this window.")}
</section>
<section class="section">
<h2>Where you're winning</h2>
${renderGapTable(winning, args, "No winning or tied rows yet.")}
</section>
<section class="section${history.length > 1 ? " two" : ""}">
<div class="panel">
<h2>Provider breakdown</h2>
${providerChart}
</div>
${history.length > 1 ? `<div class="panel">
<h2>Run history</h2>
${historyChart}
</div>` : ""}
</section>
<section class="section">
<h2>Methodology &amp; limits</h2>
${renderMethodology(args, successfulSamples, expectedSamples)}
</section>
<footer>
<span>Generated by <a href="${REPO_URL}">openllmrank v${escapeHtml(args.project_version)}</a></span>
</footer>
</main>
<script>
(function(){var select=document.querySelector("[data-competitor-select]");if(!select)return;function sync(){var v=select.value;document.querySelectorAll("[data-competitor]").forEach(function(el){el.style.display=el.getAttribute("data-competitor")===v?"":"none";});}select.addEventListener("change",sync);sync();})();
</script>
</body>
</html>`;
}

function renderGapTable(rows: GapRow[], args: HtmlReportArgs, empty: string): string {
  if (rows.length === 0) return `<p class="muted">${escapeHtml(empty)}</p>`;
  return `<table><thead><tr><th>Provider</th><th>Prompt</th><th>Your rate ${infoTip("Percent of samples for this prompt + provider that cited your brand.")}</th><th>Top competitor ${infoTip("The competitor cited most often for this prompt + provider, with their citation rate.")}</th><th>Gap ${infoTip("Top competitor's rate minus yours. Larger gap = bigger opportunity to close.", "right")}</th></tr></thead><tbody>${rows
    .map((g) => {
      const best = g.competitors[0];
      const response = findRecentResponse(args.calls, args.rates, g);
      const width = Math.max(0, Math.min(100, g.gap_score * 100));
        return `<tr><td class="provider">${escapeHtml(g.provider)}</td><td class="prompt">${escapeHtml(g.prompt_text)}${response ? `<details><summary class="muted">Most recent response</summary><div class="response">${renderResponseHtml(response, args.brand_name, best?.name)}</div></details>` : ""}</td><td class="rate">${formatPercent(g.brand_rate)}</td><td>${best ? `${escapeHtml(best.name)} <span class="rate">${formatPercent(best.rate)}</span>` : "&mdash;"}</td><td><div class="gapcell"><span class="rate">${formatPercent(Math.max(0, g.gap_score))}</span><div class="bar"><span style="width:${round(width)}%;background:${gapColor(g.gap_score)}"></span></div></div></td></tr>`;
    })
    .join("")}</tbody></table>`;
}

function renderPriorityActions(rows: GapRow[], args: HtmlReportArgs): string {
  const priorities = rows.slice(0, 3);
  if (priorities.length === 0) {
    return `<p class="muted">No tracked competitor currently leads on a measured prompt. Defend the strongest pages behind your current citations and repeat the same prompt set on the next run.</p>`;
  }
  const site = websiteLabel(args.brand_website);
  return `<div class="actions">${priorities.map((gap, index) => {
    const competitor = gap.competitors[0];
    const source = competitor
      ? findGroundedSource(args.citations, gap.prompt_id, competitor.name)
      : null;
    const target = site ? ` on ${site}` : " on your site";
    const evidence = source
      ? `<p><a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">Inspect a source cited for ${escapeHtml(competitor!.name)} →</a></p>`
      : `<p class="muted">No competitor source URL was captured for this prompt; start with the model response below.</p>`;
    return `<article class="action"><span class="action-rank">Priority ${index + 1} · ${escapeHtml(gap.provider)}</span><h3>Close a ${formatPercent(gap.gap_score)} gap</h3><p><strong>Buyer question:</strong> ${escapeHtml(gap.prompt_text)}</p><p>${escapeHtml(competitor?.name ?? "A competitor")} leads at ${formatPercent(competitor?.rate ?? 0)}. Publish or strengthen a decision page${escapeHtml(target)} that answers this exact question in the opening paragraph, compares the buyer criteria in a scannable table, and backs claims with dated first-party evidence.</p>${evidence}</article>`;
  }).join("")}</div>`;
}

function findGroundedSource(
  citations: CitationRow[],
  promptId: string,
  competitor: string,
): string | null {
  const counts = new Map<string, number>();
  for (const citation of citations) {
    if (
      citation.prompt_id !== promptId ||
      citation.brand !== competitor ||
      citation.kind !== "grounded_source" ||
      !safeHttpUrl(citation.matched_text)
    ) continue;
    counts.set(citation.matched_text, (counts.get(citation.matched_text) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function safeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function websiteLabel(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function renderMethodology(
  args: HtmlReportArgs,
  successfulSamples: number,
  expectedSamples: number,
): string {
  const models = Array.from(new Set((
    args.configured_models ?? args.prompts ?? []
  ).map(
    (entry) => `${entry.provider}: ${entry.model}`,
  ))).sort();
  const modelList = models.length > 0
    ? `<ul>${models.map((model) => `<li>${escapeHtml(model)}</li>`).join("")}</ul>`
    : `<p class="muted">Model identifiers were not available for this report.</p>`;
  return `<div class="methodology"><div><p><strong>What was measured.</strong> ${successfulSamples} successful grounded API responses out of ${expectedSamples} planned calls. A citation rate is the share of repeated samples where a tracked brand appeared in the answer or a grounded source.</p><p><strong>How to read it.</strong> Treat this as a directional snapshot, not an absolute market-share metric. Small sample sizes are intentionally shown rather than hidden behind false precision.</p></div><div><p><strong>Models queried.</strong></p>${modelList}<p><strong>Important limit.</strong> Provider APIs with web search can differ from the consumer ChatGPT, Claude, Gemini, Perplexity, or Grok apps because prompts, system instructions, rollout versions, and personalization differ.</p></div></div>`;
}

function renderProviderChart(rates: CitationRate[], brand: string, competitors: string[]): string {
  const providers = Array.from(new Set(rates.map((r) => r.provider))).sort();
  if (providers.length === 0) return `<p class="muted">No provider data yet.</p>`;
  const options = competitors.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  const groups = (competitors.length ? competitors : [""]).map((competitor, index) => {
    const rows = providers
      .map((provider) => {
        const brandRate = averageRate(rates, provider, brand);
        const compRate = competitor ? averageRate(rates, provider, competitor) : 0;
        return `<div class="chart-row"><strong>${escapeHtml(provider)}</strong><div><div class="chart-track"><span style="width:${round(brandRate * 100)}%"></span></div><div class="chart-track" style="margin-top:5px"><span style="width:${round(compRate * 100)}%;background:var(--accent-2)"></span></div></div><span class="rate">${formatPercent(brandRate)}</span></div>`;
      })
      .join("");
    return `<div data-competitor="${escapeHtml(competitor)}" style="${index === 0 ? "" : "display:none"}">${rows}</div>`;
  });
  const select = competitors.length > 1 ? `<select class="select" data-competitor-select>${options}</select>` : "";
  return `${select}<p class="muted">Top bar is ${escapeHtml(brand)}; lower bar is selected competitor.</p>${groups.join("")}`;
}

function renderHistory(history: HistoryPoint[], brands: string[]): string {
  return brands
    .map((brand) => {
      const values = history.map((point) => point.rates.get(brand) ?? 0);
      return `<div class="chart-row"><strong>${escapeHtml(brand)}</strong><svg class="spark" viewBox="0 0 160 42" role="img" aria-label="${escapeHtml(brand)} history"><path d="${sparklinePath(values, 160, 42, 4)}"></path></svg><span class="rate">${formatPercent(values.at(-1) ?? 0)}</span></div>`;
    })
    .join("");
}

function renderTrend(trend: number | null): string {
  if (trend === null) return `<span>No previous run in window</span>`;
  if (trend === 0) return `<span>Flat vs previous run</span>`;
  const arrow = trend > 0 ? "up" : "down";
  return `<span>${arrow} <b>${formatPercent(Math.abs(trend))}</b> vs previous run</span>`;
}

function computeVisibility(rows: CitationRate[]): number {
  if (rows.length === 0) return 0;
  return rows.filter((r) => r.rate > 0).length / rows.length;
}

function computeHistory(args: HtmlReportArgs): HistoryPoint[] {
  const promptProvider = new Map(args.rates.map((r) => [r.prompt_id, r.provider]));
  const runOrder = args.runs.length
    ? args.runs
    : Array.from(new Set(args.calls.map((c) => c.run_id))).map((run_id) => ({
        run_id,
        started_at: args.calls.find((c) => c.run_id === run_id)?.ts ?? "",
        finished_at: null,
        config_hash: "",
      }));
  return runOrder.map((run) => {
    const calls = args.calls.filter(
      (c) => c.run_id === run.run_id && c.error_code === null,
    );
    const citations = args.citations.filter((c) => c.run_id === run.run_id);
    const brands = new Map<string, Set<string>>();
    for (const cit of citations) {
      const provider = promptProvider.get(cit.prompt_id);
      if (!provider) continue;
      const key = `${cit.prompt_id}|${provider}|${cit.sample_index}`;
      if (!brands.has(cit.brand)) brands.set(cit.brand, new Set());
      brands.get(cit.brand)!.add(key);
    }
    const sampleTotal = calls.length || 1;
    const rates = new Map<string, number>();
    for (const [brand, samples] of brands) rates.set(brand, samples.size / sampleTotal);
    return { run_id: run.run_id, label: formatDate(run.started_at), rates };
  });
}

function computeVisibilityTrend(args: HtmlReportArgs): number | null {
  const runIds = args.runs.map((run) => run.run_id);
  if (runIds.length < 2) return null;
  const latest = runIds.at(-1)!;
  const previous = runIds.at(-2)!;
  return visibilityForRun(args, latest) - visibilityForRun(args, previous);
}

function visibilityForRun(args: HtmlReportArgs, runId: string): number {
  const providerByPrompt = new Map(args.rates.map((r) => [r.prompt_id, r.provider]));
  const pairs = new Set<string>();
  for (const call of args.calls.filter(
    (c) => c.run_id === runId && c.error_code === null,
  )) {
    const provider = providerByPrompt.get(call.prompt_id);
    if (provider) pairs.add(`${call.prompt_id}|${provider}`);
  }
  if (pairs.size === 0) return 0;
  const citedPairs = new Set<string>();
  for (const cit of args.citations.filter((c) => c.run_id === runId && c.brand === args.brand_name)) {
    const provider = providerByPrompt.get(cit.prompt_id);
    const key = `${cit.prompt_id}|${provider}`;
    if (provider && pairs.has(key)) citedPairs.add(key);
  }
  return citedPairs.size / pairs.size;
}

function topCompetitorNames(rates: CitationRate[], competitors: string[]): string[] {
  return competitors
    .map((name) => ({ name, rate: rates.filter((r) => r.brand === name).reduce((sum, r) => sum + r.rate, 0) }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 3)
    .map((r) => r.name);
}

function findRecentResponse(calls: CallRow[], rates: CitationRate[], gap: GapRow): string | null {
  const providerByPrompt = new Map(rates.map((r) => [r.prompt_id, r.provider]));
  const matches = calls
    .filter((c) => c.error_code === null && c.prompt_id === gap.prompt_id && providerByPrompt.get(c.prompt_id) === gap.provider)
    .sort((a, b) => b.ts.localeCompare(a.ts));
  return matches[0]?.response_text ?? null;
}

function renderResponseHtml(text: string, brand: string, competitor?: string): string {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\s+###\s+/g, "\n\n### ")
    .replace(/\s+(\d+)\.\s+\*\*/g, "\n$1. **")
    .trim();
  const lines = normalized.split("\n");
  const out: string[] = [];
  let listItems: string[] = [];

  function flushList(): void {
    if (listItems.length === 0) return;
    out.push(`<ol>${listItems.map((item) => `<li>${formatResponseInline(item, brand, competitor)}</li>`).join("")}</ol>`);
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    const heading = /^#{2,3}\s+(.+)$/.exec(line);
    if (heading) {
      flushList();
      out.push(`<p class="response-heading">${formatResponseInline(heading[1]!, brand, competitor)}</p>`);
      continue;
    }
    const item = /^\d+\.\s+(.+)$/.exec(line);
    if (item) {
      listItems.push(item[1]!);
      continue;
    }
    flushList();
    out.push(`<p>${formatResponseInline(line, brand, competitor)}</p>`);
  }
  flushList();

  return out.length > 0 ? out.join("") : formatResponseInline(normalized, brand, competitor);
}

function formatResponseInline(text: string, brand: string, competitor?: string): string {
  return highlightText(
    escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"),
    brand,
    competitor,
  );
}

function highlightText(escapedHtml: string, brand: string, competitor?: string): string {
  const names = [brand, competitor].filter((v): v is string => Boolean(v)).sort((a, b) => b.length - a.length);
  if (names.length === 0) return escapedHtml;
  const pattern = new RegExp(`(${names.map(escapeRegExp).join("|")})`, "gi");
  return escapedHtml.replace(pattern, (match) => {
    const cls = match.toLowerCase() === brand.toLowerCase() ? "mark-brand" : "mark-competitor";
    return `<span class="${cls}">${match}</span>`;
  });
}

function averageRate(rates: CitationRate[], provider: string, brand: string): number {
  const rows = rates.filter((r) => r.provider === provider && r.brand === brand);
  if (rows.length === 0) return 0;
  return rows.reduce((sum, r) => sum + r.rate, 0) / rows.length;
}

function formatDateRange(calls: CallRow[], sinceIso: string): string {
  if (calls.length === 0) return `Window since ${formatDate(sinceIso)}`;
  const sorted = [...calls].sort((a, b) => a.ts.localeCompare(b.ts));
  return `${formatDate(sorted[0]!.ts)} to ${formatDate(sorted.at(-1)!.ts)}`;
}

function formatDate(value: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
