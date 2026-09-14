import Link from "next/link";
import type { Subscription } from "@/lib/dashboard-data";

// Billing state, said plainly, on the page the customer actually lands on.
// Single-brand accounts skip the brand list, so the brand page has to carry
// this too. Nothing renders for an active subscription.

export function SubscriptionNotice({
  subscription,
  brandName,
}: {
  subscription: Subscription | null;
  brandName?: string;
}) {
  if (subscription?.status === "active") return null;

  if (subscription?.status === "past_due") {
    return (
      <p className="note" role="alert">
        Your last payment failed, so scheduled runs are paused. Update your card
        in <Link href="/dashboard/billing">Billing</Link> to resume.
      </p>
    );
  }
  if (subscription?.status === "incomplete") {
    return (
      <p className="note">
        Your subscription is still being confirmed. Scheduled runs start as soon
        as Stripe confirms the first payment.
      </p>
    );
  }
  if (subscription?.status === "canceled") {
    return (
      <p className="note">
        Your subscription ended. History stays readable;{" "}
        <Link href="/dashboard/billing">subscribe</Link> to resume weekly runs.
      </p>
    );
  }
  return (
    <p className="note">
      You bought a one-time report.{" "}
      <Link href="/dashboard/billing">Subscribe</Link> to keep tracking
      {brandName ? ` ${brandName}` : ""} weekly and watch the trend move.
    </p>
  );
}
