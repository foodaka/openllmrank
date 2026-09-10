import { describe, expect, test } from "bun:test";
import {
  sortBrandsByLatestRun,
  type DashBrand,
  type RunMetric,
} from "../lib/dashboard-data";

function brand(id: string, lastRunAt: string | null): DashBrand {
  return {
    id,
    name: id,
    aliases: [],
    website: null,
    category: null,
    config_jsonb: null,
    cadence: "weekly",
    next_run_at: null,
    last_run_at: lastRunAt,
    archived_at: null,
  };
}

function metric(jobId: string, computedAt: string): RunMetric {
  return {
    run_id: `run-${jobId}`,
    job_id: jobId,
    computed_at: computedAt,
    origin: "scheduled",
    own_citation_rate: 0.5,
    share_of_voice: 0.5,
    samples_total: 1,
    per_provider_jsonb: {},
    per_competitor_jsonb: [],
    top_gap_prompt: null,
    top_gap_score: null,
  };
}

describe("sortBrandsByLatestRun", () => {
  test("uses metric history when last_run_at has not been backfilled", () => {
    const brands = [
      brand("older", null),
      brand("newer", null),
    ];
    const metrics = new Map([
      ["older", [metric("old", "2026-09-01T00:00:00.000Z")]],
      ["newer", [metric("new", "2026-09-08T00:00:00.000Z")]],
    ]);

    expect(sortBrandsByLatestRun(brands, metrics).map((item) => item.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  test("uses newer metric history when it is ahead of the denormalized field", () => {
    const brands = [
      brand("older", "2026-09-01T00:00:00.000Z"),
      brand("newer", "2026-09-08T00:00:00.000Z"),
    ];
    const metrics = new Map([
      ["older", [metric("old", "2026-09-09T00:00:00.000Z")]],
    ]);

    expect(sortBrandsByLatestRun(brands, metrics).map((item) => item.id)).toEqual([
      "older",
      "newer",
    ]);
  });
});
