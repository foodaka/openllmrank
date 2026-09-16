import Link from "next/link";
import { getBrands, getSubscription } from "@/lib/dashboard-data";
import { BrandForm } from "../../_components/brand-form";
import { createBrandAction } from "../actions";

// Add-brand (E5). The subscription already covers the run, so there is no
// payment step: the form writes brands.config_jsonb and the scheduler queues
// the first run on its next tick.

export default async function NewBrandPage() {
  const [subscription, brands] = await Promise.all([getSubscription(), getBrands()]);
  const active = subscription?.status === "active";

  if (!active) {
    const first = brands.length === 0;
    return (
      <>
        <span className="kicker">Add a brand</span>
        <h1 className="standfirst">
          {first ? "Tracking a brand needs a subscription." : "Tracking more brands needs a subscription."}
        </h1>
        <p className="sub">
          $49 a month covers as many brands as you want to track, with weekly
          runs on up to three and monthly beyond that.
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
        Your brand, who you compete with, and the questions your buyers ask.
        The first run starts as soon as you save.
      </p>
      <BrandForm
        action={createBrandAction}
        initial={{ name: "", website: "", category: "", aliases: "", competitors: "", prompts: "" }}
        submitLabel="Start tracking"
        websiteAssist
      />
      <p className="brand-tools">
        <Link href="/dashboard">Back to dashboard</Link>
      </p>
    </>
  );
}
