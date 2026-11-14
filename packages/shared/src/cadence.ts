// Run cadence rules shared by the web app (add/archive brand, dashboard copy)
// and the worker scheduler, so both sides compute the same answer.
//
// D9: subscribers get weekly runs plus a small manual re-run allowance.
// D12: unlimited brands, but a full run measured $5.50 in provider fees
// (2026-09-15, 10 prompts × 3 samples × 5 providers), so past
// WEEKLY_MAX_BRANDS active brands the whole account drops to monthly.
// Re-runs after the first also use fewer samples per question; see
// rerunConfig below. Every
// brand stays tracked and visible; only the cadence changes.

export type RunCadence = "weekly" | "monthly" | "paused";
export type ActiveCadence = Exclude<RunCadence, "paused">;

export const DEFAULT_WEEKLY_MAX_BRANDS = 2;

/**
 * Samples per question for every run after a brand's first. The first run is
 * the report the customer bought and keeps full depth; weekly re-runs exist
 * to show direction, and 100 samples versus 150 moves the noise on the rate
 * by about one point while cutting the bill by a third.
 */
export const DEFAULT_RERUN_SAMPLES_PER_PROMPT = 2;
export const DEFAULT_MANUAL_RERUNS_PER_MONTH = 2;

/** Cadence an account runs at, given how many non-archived brands it tracks. */
export function effectiveCadence(
  activeBrandCount: number,
  weeklyMaxBrands: number = DEFAULT_WEEKLY_MAX_BRANDS,
): ActiveCadence {
  return activeBrandCount > weeklyMaxBrands ? "monthly" : "weekly";
}

/** When the next scheduled run is due after a run scheduled at `from`. */
export function nextRunAfter(from: Date, cadence: ActiveCadence): Date {
  const next = new Date(from.getTime());
  if (cadence === "weekly") {
    next.setUTCDate(next.getUTCDate() + 7);
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next;
}

/** Parse an env-style integer with a fallback; rejects zero and negatives. */
export function positiveIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** A copy of `config` with samples_per_prompt capped for a re-run. Never
 * raises the sample count above what the brand was configured with. */
export function rerunConfig<T extends { samples_per_prompt?: number }>(
  config: T,
  samples: number = DEFAULT_RERUN_SAMPLES_PER_PROMPT,
): T {
  const current = config.samples_per_prompt ?? 3;
  return { ...config, samples_per_prompt: Math.max(1, Math.min(current, samples)) };
}
