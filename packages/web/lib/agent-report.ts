import type { CitationRate } from "openllmrank/src/core/gap";
import { findGroundedSource } from "openllmrank/src/core/render-html";
import type { ReportData } from "./report-data";

// The agent-facing rendering of a completed report: compact, typed JSON for
// another LLM to read, where /reports/[id] is the HTML rendering for a
// person. Same rows, same computeRates / computeGap output, same run_metrics
// numbers the dashboard charts. Nothing here is new analysis, and nothing is
// written by a model: a field we cannot back with stored data is null or
// absent rather than guessed.

/** The run_metrics row the worker wrote for this run (null if absent). */
export type StoredRunMetrics = {
  own_citation_rate: number;
  share_of_voice: number;
  samples_total: number;
  per_provider_jsonb: Record<string, number>;
  per_competitor_jsonb: { name: string; rate: number }[];
};

export type AgentReport = {
  status: "completed";
  brand: string;
  website: string | null;
  summary: string;
  visibility: {
    /** Share of AI answers that cited the brand, 0..1. */
    citation_rate: number | null;
    /** Brand citations / (brand + competitor citations), 0..1. */
    share_of_voice: number | null;
    answers_analyzed: number | null;
    failed_calls: number;
  };
  providers: { provider: string; model: string; citation_rate: number | null }[];
  strongest_provider: string | null;
  weakest_provider: string | null;
  competitors: { name: string; citation_rate: number }[];
  top_competitor: string | null;
  prompts: {
    prompt: string;
    brand_citation_rate: number;
    leader: { name: string; citation_rate: number } | null;
    outcome: "winning" | "losing" | "tied" | "nobody_cited";
  }[];
  opportunities: {
    prompt: string;
    provider: string;
    brand_citation_rate: number;
    leading_competitor: string;
    competitor_citation_rate: number;
    gap_points: number;
    /** A page the AI cited for the competitor on this prompt, when captured. */
    competitor_source_url: string | null;
  }[];
  report_url: string;
};

const MAX_OPPORTUNITIES = 5;

function round(value: number): number {
  return Number(value.toFixed(4));
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function pooledRate(rows: CitationRate[]): number {
  const total = rows.reduce((n, row) => n + row.samples_total, 0);
  if (total === 0) return 0;
  return round(rows.reduce((n, row) => n + row.samples_with_citation, 0) / total);
}

export function buildAgentReport(args: {
  data: ReportData;
  metrics: StoredRunMetrics | null;
  failedCalls: number;
  reportUrl: string;
}): AgentReport {
  const { data, metrics } = args;
  const { brandName, competitorNames, rates, gaps, cfg } = data;

  const providers = cfg.providers.map((provider) => ({
    provider: provider.id,
    model: provider.model,
    citation_rate: metrics?.per_provider_jsonb[provider.id] ?? null,
  }));
  const measured = providers
    .filter((p): p is typeof p & { citation_rate: number } => p.citation_rate !== null)
    .sort((a, b) => b.citation_rate - a.citation_rate);
  // A strongest/weakest split only means something when the rates differ.
  const spread =
    measured.length > 1 && measured[0]!.citation_rate !== measured.at(-1)!.citation_rate;

  const competitors = [...(metrics?.per_competitor_jsonb ?? [])]
    .map((c) => ({ name: c.name, citation_rate: c.rate }))
    .sort((a, b) => b.citation_rate - a.citation_rate);
  const topCompetitor =
    competitors[0] && competitors[0].citation_rate > 0 ? competitors[0] : null;

  // prompt_id is per (question, assistant); pool by the question itself.
  const questions = [...new Set(rates.map((row) => row.prompt_text))];
  const prompts = questions.map((question) => {
    const rows = rates.filter((row) => row.prompt_text === question);
    const brandRate = pooledRate(rows.filter((row) => row.brand === brandName));
    const leader = competitorNames
      .map((name) => ({
        name,
        citation_rate: pooledRate(rows.filter((row) => row.brand === name)),
      }))
      .sort((a, b) => b.citation_rate - a.citation_rate)[0];
    const leaderRate = leader?.citation_rate ?? 0;
    const outcome =
      brandRate === 0 && leaderRate === 0
        ? ("nobody_cited" as const)
        : brandRate > leaderRate
          ? ("winning" as const)
          : brandRate < leaderRate
            ? ("losing" as const)
            : ("tied" as const);
    return {
      prompt: question,
      brand_citation_rate: brandRate,
      leader: leader && leaderRate > 0 ? leader : null,
      outcome,
    };
  });

  const opportunities = gaps
    .filter((gap) => gap.gap_score > 0 && gap.competitors[0])
    .slice(0, MAX_OPPORTUNITIES)
    .map((gap) => {
      const competitor = gap.competitors[0]!;
      return {
        prompt: gap.prompt_text,
        provider: gap.provider,
        brand_citation_rate: round(gap.brand_rate),
        leading_competitor: competitor.name,
        competitor_citation_rate: round(competitor.rate),
        gap_points: Math.round(gap.gap_score * 100),
        competitor_source_url: findGroundedSource(
          data.citationRows,
          gap.prompt_id,
          competitor.name,
        ),
      };
    });

  const summaryParts: string[] = [];
  if (metrics) {
    summaryParts.push(
      `${brandName} was cited in ${pct(metrics.own_citation_rate)} of ${metrics.samples_total} AI answers across ${measured.length} assistants (share of voice against the tracked competitors: ${pct(metrics.share_of_voice)}).`,
    );
    if (topCompetitor) {
      summaryParts.push(
        `The most-cited competitor was ${topCompetitor.name} at ${pct(topCompetitor.citation_rate)}.`,
      );
    }
    if (spread) {
      summaryParts.push(
        `Visibility was highest on ${measured[0]!.provider} (${pct(measured[0]!.citation_rate)}) and lowest on ${measured.at(-1)!.provider} (${pct(measured.at(-1)!.citation_rate)}).`,
      );
    }
  }
  const losing = prompts.filter((p) => p.outcome === "losing").length;
  summaryParts.push(
    `${brandName} trails a competitor on ${losing} of ${prompts.length} buyer questions.`,
  );

  return {
    status: "completed",
    brand: brandName,
    website: cfg.brand.website ?? null,
    summary: summaryParts.join(" "),
    visibility: {
      citation_rate: metrics?.own_citation_rate ?? null,
      share_of_voice: metrics?.share_of_voice ?? null,
      answers_analyzed: metrics?.samples_total ?? null,
      failed_calls: args.failedCalls,
    },
    providers,
    strongest_provider: spread ? measured[0]!.provider : null,
    weakest_provider: spread ? measured.at(-1)!.provider : null,
    competitors,
    top_competitor: topCompetitor?.name ?? null,
    prompts,
    opportunities,
    report_url: args.reportUrl,
  };
}
