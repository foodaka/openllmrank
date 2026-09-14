import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_MANUAL_RERUNS_PER_MONTH,
  positiveIntEnv,
} from "@openllmrank/shared/cadence";

// Manual re-run allowance (D9): a subscriber may trigger a small number of
// extra runs per billing period on top of the schedule. Counted per account,
// not per brand, because the cost is per run regardless of which brand it is.
//
// The billing period comes from the subscription row when Stripe has told us
// the period end; otherwise the calendar month stands in.

export type RerunQuota = {
  used: number;
  limit: number;
  remaining: number;
  /** Start of the current period, ISO. */
  periodStart: string;
  /** When the allowance resets, ISO. */
  resetsAt: string;
};

export function manualRerunLimit(): number {
  return positiveIntEnv(
    process.env.MANUAL_RERUNS_PER_MONTH,
    DEFAULT_MANUAL_RERUNS_PER_MONTH,
  );
}

export function billingPeriod(
  currentPeriodEnd: string | null | undefined,
  now: Date = new Date(),
): { periodStart: Date; resetsAt: Date } {
  if (currentPeriodEnd) {
    const end = new Date(currentPeriodEnd);
    if (!Number.isNaN(end.getTime()) && end.getTime() > now.getTime()) {
      const start = new Date(end.getTime());
      start.setUTCMonth(start.getUTCMonth() - 1);
      return { periodStart: start, resetsAt: end };
    }
  }
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { periodStart, resetsAt };
}

/**
 * Quota for the signed-in user. `supabase` must be the RLS-scoped user
 * client, so the count is naturally the caller's own manual jobs.
 */
export async function getRerunQuota(
  supabase: SupabaseClient,
  currentPeriodEnd: string | null | undefined,
  now: Date = new Date(),
): Promise<RerunQuota> {
  const limit = manualRerunLimit();
  const { periodStart, resetsAt } = billingPeriod(currentPeriodEnd, now);
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("origin", "manual")
    .gte("created_at", periodStart.toISOString());
  if (error) throw new Error(`manual re-run count: ${error.message}`);
  const used = count ?? 0;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    periodStart: periodStart.toISOString(),
    resetsAt: resetsAt.toISOString(),
  };
}
