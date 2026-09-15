import { describe, expect, it } from "bun:test";
import type { RunMetric } from "../lib/dashboard-data";
import {
  buildSecondaryStandfirst,
  buildTrendSeries,
  findCrossoverIndex,
  leadingCompetitor,
  type TrendPoint,
} from "../lib/trend-data";

function metric(
  ownRate: number,
  competitors: { name: string; rate: number }[],
  options: Partial<RunMetric> = {},
): RunMetric {
  return {
    run_id: crypto.randomUUID(),
    job_id: crypto.randomUUID(),
    computed_at: "2026-08-01T00:00:00.000Z",
    origin: "scheduled",
    own_citation_rate: ownRate,
    share_of_voice: ownRate,
    samples_total: 10,
    per_provider_jsonb: { openai: ownRate },
    per_competitor_jsonb: competitors,
    top_gap_prompt: "best tool for teams",
    top_gap_score: 0.2,
    ...options,
  };
}

describe("trend data", () => {
  it("uses the latest run's leading competitor for the comparison series", () => {
    const metrics = [
      metric(0.2, [
        { name: "Jira", rate: 0.5 },
        { name: "Asana", rate: 0.4 },
      ]),
      metric(0.3, [
        { name: "Jira", rate: 0.45 },
        { name: "Asana", rate: 0.48 },
      ]),
    ];

    expect(leadingCompetitor(metrics)).toBe("Asana");
    expect(
      buildTrendSeries(metrics).points.map((point) => point.competitorRate),
    ).toEqual([0.4, 0.48]);
  });

  it("finds the first run where the brand passes its rival", () => {
    const points: TrendPoint[] = [
      { computedAt: "2026-07-01", ownRate: 0.2, competitorRate: 0.5, origin: "one_shot" },
      { computedAt: "2026-07-08", ownRate: 0.4, competitorRate: 0.45, origin: "manual" },
      { computedAt: "2026-07-15", ownRate: 0.6, competitorRate: 0.42, origin: "scheduled" },
    ];

    expect(findCrossoverIndex(points)).toBe(2);
  });

  it("leaves an older missing competitor snapshot as a gap", () => {
    const metrics = [
      metric(0.2, [{ name: "Asana", rate: 0.4 }]),
      metric(0.3, [{ name: "Jira", rate: 0.5 }]),
    ];

    const series = buildTrendSeries(metrics);
    expect(series.competitorName).toBe("Jira");
    expect(series.points.map((point) => point.competitorRate)).toEqual([
      null,
      0.5,
    ]);
    expect(series.crossoverIndex).toBeNull();
  });

  it("marks a current crossover in the secondary standfirst", () => {
    const metrics = [
      metric(0.2, [{ name: "Jira", rate: 0.5 }], {
        computed_at: "2026-07-25T00:00:00.000Z",
      }),
      metric(0.6, [{ name: "Jira", rate: 0.42 }], {
        computed_at: "2026-08-01T00:00:00.000Z",
      }),
    ];

    expect(buildSecondaryStandfirst(metrics)).toBe(
      "This is the first run in which you out-cite Jira.",
    );
  });

  it("gives a truthful explanation when the overall rate is flat", () => {
    const metrics = [
      metric(0.3, [{ name: "Jira", rate: 0.5 }], {
        computed_at: "2026-07-25T00:00:00.000Z",
        per_provider_jsonb: { openai: 0.3 },
      }),
      metric(0.302, [{ name: "Jira", rate: 0.49 }], {
        computed_at: "2026-08-01T00:00:00.000Z",
        per_provider_jsonb: { openai: 0.3 },
      }),
    ];

    expect(buildSecondaryStandfirst(metrics)).toContain("held steady");
  });
});
