import { direction, longDate, pct, type RunMetric } from "./dashboard-data";

export type TrendPoint = {
  computedAt: string;
  ownRate: number;
  competitorRate: number | null;
  origin: RunMetric["origin"];
};

export type TrendSeries = {
  competitorName: string | null;
  points: TrendPoint[];
  crossoverIndex: number | null;
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Gemini",
  perplexity: "Perplexity",
  xai: "xAI",
};

/** Pick the same current leader shown by the latest rate-bar comparison. */
export function leadingCompetitor(metrics: RunMetric[]): string | null {
  const latest = metrics.at(-1);
  const currentLeader = latest?.per_competitor_jsonb
    .filter((competitor) => Number.isFinite(competitor.rate))
    .reduce<{ name: string; rate: number } | null>(
      (leader, competitor) =>
        !leader || competitor.rate > leader.rate ? competitor : leader,
      null,
    );
  if (currentLeader?.name) return currentLeader.name;

  // Older rows can still carry competitor data when the latest run is empty.
  // Use the strongest average as a fallback instead of hiding a valid series.
  const totals = new Map<string, { total: number; count: number }>();
  for (const metric of metrics) {
    for (const competitor of metric.per_competitor_jsonb) {
      if (!Number.isFinite(competitor.rate)) continue;
      const current = totals.get(competitor.name) ?? { total: 0, count: 0 };
      current.total += competitor.rate;
      current.count += 1;
      totals.set(competitor.name, current);
    }
  }

  return [...totals.entries()].sort(
    (a, b) => b[1].total / b[1].count - a[1].total / a[1].count,
  )[0]?.[0] ?? null;
}

export function findCrossoverIndex(points: TrendPoint[]): number | null {
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (
      previous.competitorRate !== null &&
      current.competitorRate !== null &&
      previous.ownRate <= previous.competitorRate &&
      current.ownRate > current.competitorRate
    ) {
      return index;
    }
  }
  return null;
}

export function buildTrendSeries(metrics: RunMetric[]): TrendSeries {
  const competitorName = leadingCompetitor(metrics);
  const points = metrics.map((metric) => ({
    computedAt: metric.computed_at,
    ownRate: metric.own_citation_rate,
    competitorRate:
      competitorName === null
        ? null
        : metric.per_competitor_jsonb.find(
            (competitor) => competitor.name === competitorName,
          )?.rate ?? null,
    origin: metric.origin,
  }));

  return {
    competitorName,
    points,
    crossoverIndex: findCrossoverIndex(points),
  };
}

function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

/**
 * One extra sentence under the standfirst. It prefers a real crossover or
 * provider movement, then falls back to an honest explanation of a flat run.
 */
export function buildSecondaryStandfirst(metrics: RunMetric[]): string | null {
  if (metrics.length < 2) return null;

  const latest = metrics.at(-1)!;
  const previous = metrics.at(-2)!;
  const series = buildTrendSeries(metrics);

  if (series.crossoverIndex !== null && series.competitorName) {
    const crossover = series.points[series.crossoverIndex]!;
    if (series.crossoverIndex === series.points.length - 1) {
      return `This is the first run in which you out-cite ${series.competitorName}.`;
    }
    return `You first out-cited ${series.competitorName} on ${longDate(crossover.computedAt)}.`;
  }

  const providerMove = Object.keys(latest.per_provider_jsonb)
    .map((provider) => ({
      provider,
      delta:
        (latest.per_provider_jsonb[provider] ?? 0) -
        (previous.per_provider_jsonb[provider] ?? 0),
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];

  if (providerMove && Math.abs(providerMove.delta) >= 0.02) {
    const oldRate = previous.per_provider_jsonb[providerMove.provider] ?? 0;
    const newRate = latest.per_provider_jsonb[providerMove.provider] ?? 0;
    return `${providerLabel(providerMove.provider)} was the biggest mover this run, ${
      providerMove.delta > 0 ? "up" : "down"
    } from ${pct(oldRate)} to ${pct(newRate)}.`;
  }

  if (
    latest.top_gap_prompt &&
    latest.top_gap_prompt !== previous.top_gap_prompt
  ) {
    return `Your widest gap shifted to "${latest.top_gap_prompt}" this run.`;
  }

  if (direction(latest.own_citation_rate, previous.own_citation_rate) === "flat") {
    return "The overall rate held steady; the next run will show whether this is a pause or a pattern.";
  }

  return "The latest run moved, and the next comparison will show whether it holds.";
}
