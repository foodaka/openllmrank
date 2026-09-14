// Run cadence rules shared by the web app (add/archive brand, dashboard copy)
// and the worker scheduler, so both sides compute the same answer.
//
// D9: subscribers get weekly runs plus a small manual re-run allowance.
// D12: unlimited brands, but break-even at $29/mo is two brands, so past
// WEEKLY_MAX_BRANDS active brands the whole account drops to monthly. Every
// brand stays tracked and visible; only the cadence changes.

export type RunCadence = "weekly" | "monthly" | "paused";
export type ActiveCadence = Exclude<RunCadence, "paused">;

export const DEFAULT_WEEKLY_MAX_BRANDS = 2;
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
