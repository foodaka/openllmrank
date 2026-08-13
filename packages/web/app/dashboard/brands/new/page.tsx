import Link from "next/link";
import { getSubscription } from "@/lib/dashboard-data";

// Add-brand (E5). The real implementation reuses the existing wizard steps
// (brand -> competitors -> prompts) writing to brands.config_jsonb with no
// payment step, since the subscription already covers it. Stubbed in the
// prototype so the gating rule is visible without rebuilding the wizard.

export default async function NewBrandPage() {
  const subscription = await getSubscription();
  const active = subscription?.status === "active";

  if (!active) {
    return (
      <>
        <span className="kicker">Add a brand</span>
        <h1 className="standfirst">Tracking more brands needs a subscription.</h1>
        <p className="sub">
          $29 a month covers as many brands as you want to track, with weekly
          runs on up to two and monthly beyond that.
        </p>
        <Link href="/dashboard/billing" className="btn-primary">
          See the plan
        </Link>
      </>
    );
  }

  return (
    <>
      <span className="kicker">Add a brand</span>
      <h1 className="standfirst">What should we track?</h1>
      <p className="sub">
        In the shipped version this is the existing wizard — brand, competitors,
        questions — writing to <code>brands.config_jsonb</code> with no payment
        step, then scheduling the first run immediately.
      </p>
      <p className="note">
        Stubbed in this prototype. The gating above is real: without an active
        subscription this page shows the upgrade prompt and creates nothing.
      </p>
      <Link href="/dashboard">Back to dashboard</Link>
    </>
  );
}
