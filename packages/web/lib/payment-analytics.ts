import { track } from "@vercel/analytics/server";
import { sanitizeAcquisition } from "./acquisition";

export function paymentProperties(event: unknown) {
  const e = event as { type?: string; livemode?: boolean; data?: { object?: {
    payment_status?: string; mode?: string; amount_total?: number | null; currency?: string;
    metadata?: Record<string, string> | null;
  } } } | null;
  const s = e?.data?.object;
  if (e?.type !== "checkout.session.completed" || e.livemode !== true || s?.payment_status !== "paid" || !s.metadata?.lead_id || s.metadata.kind === "monitor") return null;
  return {
    ...sanitizeAcquisition({ landing: s.metadata.acquisition_landing, source: s.metadata.acquisition_source }),
    plan: s.mode === "subscription" ? "tracking" : "report",
    amount_cents: s.amount_total ?? 0,
    currency: s.currency ?? "unknown",
  };
}

/** Aggregate telemetry only; deduplicated Stripe records remain the revenue ledger. */
export async function trackPaidCheckout(event: unknown) {
  const properties = paymentProperties(event);
  if (!properties) return;
  try { await track("payment_complete", properties); }
  catch { console.warn("[analytics] payment event unavailable"); }
}
