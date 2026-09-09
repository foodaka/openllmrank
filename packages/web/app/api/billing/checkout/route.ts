import { NextResponse } from "next/server";
import { createSubscriptionSession } from "@/lib/stripe";
import { userClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// Subscription Checkout is session-authenticated. The webhook remains the
// source of truth for provisioning; this route only starts the payment flow.
export async function POST(req: Request) {
  const supabase = await userClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to subscribe" }, { status: 401 });
  }
  if (!user.email) {
    return NextResponse.json(
      { error: "Your account does not have an email address" },
      { status: 400 },
    );
  }

  // A live row means another Checkout has already completed for this user.
  // The partial unique index is still the race-safe backstop in the webhook;
  // this check keeps a normal second click from opening another session.
  const { data: existing, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select("status")
    .in("status", ["incomplete", "active", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subscriptionError) {
    return NextResponse.json(
      { error: "Could not check subscription status", detail: subscriptionError.message },
      { status: 500 },
    );
  }
  if (existing) {
    return NextResponse.redirect(
      new URL("/dashboard/billing?checkout=already_started", req.url),
      303,
    );
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_ORIGIN ?? new URL(req.url).origin;
  let session;
  try {
    session = await createSubscriptionSession({
      amountCents: Number.parseInt(
        process.env.SUBSCRIPTION_PRICE_CENTS ?? "2900",
        10,
      ),
      currency: "usd",
      productName:
        process.env.SUBSCRIPTION_PRODUCT_NAME ?? "openllmrank tracking",
      userId: user.id,
      email: user.email,
      successUrl: `${origin}/checkout/success`,
      cancelUrl: `${origin}/dashboard/billing`,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Could not create subscription checkout",
        detail: (e as Error).message,
      },
      { status: 502 },
    );
  }

  return NextResponse.redirect(new URL(session.url), 303);
}
