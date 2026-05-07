import type { CallRow, CitationRow, PromptRow } from "./db";

export type CitationRate = {
  prompt_id: string;
  prompt_text: string;
  provider: string;
  brand: string;
  samples_total: number;
  samples_with_citation: number;
  rate: number;
};

export type GapRow = {
  prompt_id: string;
  prompt_text: string;
  provider: string;
  brand_rate: number;
  competitors: { name: string; rate: number }[];
  gap_score: number;
};

export function computeRates(
  calls: CallRow[],
  citations: CitationRow[],
  prompts: PromptRow[],
  brand_names: string[],
): CitationRate[] {
  const promptById = new Map(prompts.map((p) => [p.prompt_id, p]));
  const totalSamples = new Map<string, number>();
  for (const c of calls) {
    if (c.error_code !== null) continue;
    const p = promptById.get(c.prompt_id);
    if (!p) continue;
    const key = `${c.prompt_id}|${p.provider}`;
    totalSamples.set(key, (totalSamples.get(key) ?? 0) + 1);
  }

  const cited = new Map<string, Set<string>>();
  for (const cit of citations) {
    if (!brand_names.includes(cit.brand)) continue;
    const p = promptById.get(cit.prompt_id);
    if (!p) continue;
    const key = `${cit.prompt_id}|${p.provider}|${cit.brand}`;
    // Include run_id so sample_index=0 from two different runs are NOT collapsed.
    // Without this, citation rates undercount when the window covers >1 run.
    const sampleKey = `${cit.run_id}|${cit.sample_index}`;
    if (!cited.has(key)) cited.set(key, new Set());
    cited.get(key)!.add(sampleKey);
  }

  const out: CitationRate[] = [];
  for (const p of prompts) {
    const key = `${p.prompt_id}|${p.provider}`;
    const samples_total = totalSamples.get(key) ?? 0;
    if (samples_total === 0) continue;
    for (const brand of brand_names) {
      const ck = `${p.prompt_id}|${p.provider}|${brand}`;
      const samples_with_citation = cited.get(ck)?.size ?? 0;
      out.push({
        prompt_id: p.prompt_id,
        prompt_text: p.prompt_text,
        provider: p.provider,
        brand,
        samples_total,
        samples_with_citation,
        rate: samples_with_citation / samples_total,
      });
    }
  }
  return out;
}

export function computeGap(
  rates: CitationRate[],
  brand_name: string,
  competitor_names: string[],
): GapRow[] {
  const byPromptProvider = new Map<string, CitationRate[]>();
  for (const r of rates) {
    const key = `${r.prompt_id}|${r.provider}`;
    if (!byPromptProvider.has(key)) byPromptProvider.set(key, []);
    byPromptProvider.get(key)!.push(r);
  }

  const out: GapRow[] = [];
  for (const [_key, group] of byPromptProvider) {
    const brandRate = group.find((r) => r.brand === brand_name);
    if (!brandRate) continue;
    const competitors = competitor_names
      .map((name) => {
        const cr = group.find((r) => r.brand === name);
        return { name, rate: cr?.rate ?? 0 };
      })
      .sort((a, b) => b.rate - a.rate);
    const bestCompetitorRate = competitors[0]?.rate ?? 0;
    const gap_score = bestCompetitorRate - brandRate.rate;
    out.push({
      prompt_id: brandRate.prompt_id,
      prompt_text: brandRate.prompt_text,
      provider: brandRate.provider,
      brand_rate: brandRate.rate,
      competitors,
      gap_score,
    });
  }
  return out.sort((a, b) => b.gap_score - a.gap_score);
}

export function renderGapReport(
  gaps: GapRow[],
  brand_name: string,
  since_iso: string,
): string {
  const lines: string[] = [];
  lines.push(`# Gap analysis: ${brand_name}`);
  lines.push("");
  lines.push(`_Window: data since ${since_iso}_`);
  lines.push("");
  if (gaps.length === 0) {
    lines.push("No data yet — run `openllmrank run` first.");
    return lines.join("\n");
  }

  const losing = gaps.filter((g) => g.gap_score > 0);
  const winning = gaps.filter((g) => g.gap_score <= 0);

  lines.push(`## Where you're losing (${losing.length})`);
  lines.push("");
  if (losing.length === 0) {
    lines.push("_None — you're matching or beating all tracked competitors._");
  } else {
    lines.push("| Provider | Prompt | You | Best competitor | Gap |");
    lines.push("|----------|--------|-----|-----------------|-----|");
    for (const g of losing) {
      const best = g.competitors[0];
      const bestText = best ? `${best.name} (${(best.rate * 100).toFixed(0)}%)` : "—";
      const gapText = `${(g.gap_score * 100).toFixed(0)}%`;
      const promptShort = g.prompt_text.length > 60 ? g.prompt_text.slice(0, 57) + "…" : g.prompt_text;
      lines.push(
        `| ${g.provider} | ${promptShort} | ${(g.brand_rate * 100).toFixed(0)}% | ${bestText} | ${gapText} |`,
      );
    }
  }
  lines.push("");
  lines.push(`## Where you're winning or tied (${winning.length})`);
  lines.push("");
  if (winning.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| Provider | Prompt | You | Best competitor |");
    lines.push("|----------|--------|-----|-----------------|");
    for (const g of winning) {
      const best = g.competitors[0];
      const bestText = best ? `${best.name} (${(best.rate * 100).toFixed(0)}%)` : "—";
      const promptShort = g.prompt_text.length > 60 ? g.prompt_text.slice(0, 57) + "…" : g.prompt_text;
      lines.push(
        `| ${g.provider} | ${promptShort} | ${(g.brand_rate * 100).toFixed(0)}% | ${bestText} |`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}
