import { NextResponse } from "next/server";
import { createBillingPortalSession } from "@/lib/stripe";
import { userClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// Stripe owns cancellation, payment-method updates, and invoice history. The
// app only creates a short-lived portal session for the signed-in customer.
export async function POST(req: Request) {
  const supabase = await userClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to manage billing" }, { status: 401 });
  }

  const { data: subscription, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .in("status", ["incomplete", "active", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subscriptionError) {
    return NextResponse.json(
      { error: "Could not load billing account", detail: subscriptionError.message },
      { status: 500 },
    );
  }
  if (!subscription?.stripe_customer_id) {
    return NextResponse.json(
      { error: "No active billing account found" },
      { status: 404 },
    );
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_ORIGIN ?? new URL(req.url).origin;
  try {
    const session = await createBillingPortalSession({
      customerId: subscription.stripe_customer_id,
      returnUrl: `${origin}/dashboard/billing`,
    });
    return NextResponse.redirect(new URL(session.url), 303);
  } catch (e) {
    return NextResponse.json(
      { error: "Could not open billing portal", detail: (e as Error).message },
      { status: 502 },
    );
  }
}
