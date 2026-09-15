import type { RerunQuota } from "@/lib/rerun-quota";
import { longDate } from "@/lib/dashboard-data";

// "Re-run now · 2 re-runs left until October 2." The allowance is stated
// next to the button so nobody discovers the limit by hitting it.

export function RerunControl({
  brandId,
  quota,
  inFlight,
}: {
  brandId: string;
  quota: RerunQuota;
  inFlight: boolean;
}) {
  const resets = longDate(quota.resetsAt);
  const disabled = inFlight || quota.remaining <= 0;
  const status = inFlight
    ? "A run is in progress."
    : quota.remaining <= 0
      ? `No re-runs left until ${resets}.`
      : `${quota.remaining} re-run${quota.remaining === 1 ? "" : "s"} left until ${resets}.`;

  return (
    <form method="post" action="/api/runs" className="rerun">
      <input type="hidden" name="brand_id" value={brandId} />
      <button type="submit" className="btn-text" disabled={disabled}>
        Re-run now
      </button>
      <span className="rerun-status">{status}</span>
    </form>
  );
}
