import Link from "next/link";
import { redirect } from "next/navigation";
import { getBrands, getSubscription } from "@/lib/dashboard-data";

// Add-brand (E5). The existing four-step wizard owns the form state and is
// reused here in add mode so this path never opens a second payment flow.

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
          $29 a month covers as many brands as you want to track, with weekly
          runs on up to two and monthly beyond that.
        </p>
        <Link href="/dashboard/billing" className="btn-primary">
          See the plan
        </Link>
      </>
    );
  }

  redirect("/wizard/brand?mode=add");
}
