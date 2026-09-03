import Link from "next/link";
import { getBrands, getSubscription, longDate } from "@/lib/dashboard-data";

// Billing (E6). Read-only by design: Stripe is the source of truth and the
// Billing Portal owns cancel / update-card / invoice history. Rebuilding
// those flows here would mean keeping two states in sync for no gain.

const STATUS_COPY: Record<string, string> = {
  active: "Active",
  past_due: "Payment failed",
  incomplete: "Awaiting first payment",
  canceled: "Canceled",
};

export default async function BillingPage() {
  const [subscription, brands] = await Promise.all([getSubscription(), getBrands()]);

  if (!subscription || subscription.status === "canceled") {
    const canceled = subscription?.status === "canceled";
    return (
      <>
        <span className="kicker">Billing</span>
        <h1 className="standfirst">
          {canceled ? "Your subscription has ended." : "Keep tracking, every week."}
        </h1>
        <p className="sub">
          {canceled
            ? "Your previous reports remain readable. Restart your subscription whenever you want to keep tracking changes over time."
            : "You bought a one-time report. A subscription re-runs it on a schedule so you can see whether your changes moved anything."}
        </p>
        <p className="sub">
          <strong>$29 a month.</strong> Unlimited brands, weekly tracking on up
          to two, monthly beyond that, plus two manual re-runs a month.
        </p>
        <form action="/api/billing/checkout" method="post">
          <button className="btn-primary" type="submit">
            {canceled ? "Restart tracking — $29/month" : "Subscribe — $29/month"}
          </button>
        </form>
      </>
    );
  }

  const throttled = brands.length > 2;

  return (
    <>
      <span className="kicker">Billing</span>
      <h1 className="standfirst">
        {STATUS_COPY[subscription.status] ?? subscription.status}.
      </h1>

      <p className="sub">
        <strong>$29 per month.</strong> Unlimited brands, weekly tracking on up
        to two, monthly beyond that. {brands.length} brand
        {brands.length === 1 ? "" : "s"} tracked.
        {subscription.current_period_end
          ? subscription.cancel_at_period_end
            ? ` Ends ${longDate(subscription.current_period_end)}.`
            : ` Next charge ${longDate(subscription.current_period_end)}.`
          : ""}
      </p>

      <p className="note">
        {throttled
          ? `Weekly runs cover up to two brands. You track ${brands.length}, so runs are scheduled monthly. Drop to two brands or fewer and weekly resumes automatically.`
          : "Your brands run weekly. Add a third brand and runs move to monthly."}
      </p>

      {subscription.status === "past_due" && (
        <p className="note">
          Scheduled runs are paused until payment succeeds. Every report you have
          already run stays readable.
        </p>
      )}

      <hr className="rule" />
      <form action="/api/billing/portal" method="post">
        <button className="btn-primary" type="submit">
          Manage billing in Stripe
        </button>
      </form>
      <p>
        <Link href="/dashboard">Back to dashboard</Link>
      </p>
    </>
  );
}
