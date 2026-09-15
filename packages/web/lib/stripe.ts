// Stripe wrapper with a `local_stub` mode so the whole webapp can run
// end-to-end on a developer machine without a Stripe account. When the user
// signs up for Stripe (test mode is free), flip STRIPE_MODE=test in
// .env.local and the same code paths route to the real Stripe API.

import Stripe from "stripe";

export type CheckoutSessionInput = {
  amountCents: number;
  currency: string;
  productName: string;
  leadId: string;            // our leads.id (becomes Stripe metadata.lead_id)
  email: string;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutSessionResult = {
  id: string;
  url: string;
  mode: "local_stub" | "test" | "live";
};

export type SubscriptionSessionInput = {
  amountCents: number;
  currency: string;
  productName: string;
  userId: string;
  email: string;
  successUrl: string;
  cancelUrl: string;
};

export type BillingPortalSessionInput = {
  customerId: string;
  returnUrl: string;
};

// Stub mode is OPT-IN only — production must explicitly set STRIPE_MODE.
// A missing STRIPE_MODE env var in production would otherwise default this to
// "local_stub", which the webhook accepts with header `x-stub-event: 1` and
// no signature verification — letting anyone create unlimited paid jobs.
// (P0 finding from /review on 2026-05-18.)
function isStubMode(): boolean {
  const mode = process.env.STRIPE_MODE;
  if (!mode) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "STRIPE_MODE is required in production (set to 'test' or 'live'). " +
          "local_stub is dev-only.",
      );
    }
    return true; // dev default
  }
  return mode === "local_stub";
}

let stripeClient: Stripe | null = null;

// Catalog prices. When a Price id is configured the Checkout line item
// references it, so revenue rolls up under one Product in the Dashboard and
// the price can change without a deploy. Without one, the amount from env
// is charged inline (price_data), which is how the first customers paid.
function lineItem(
  priceId: string | undefined,
  inline: Stripe.Checkout.SessionCreateParams.LineItem.PriceData,
): Stripe.Checkout.SessionCreateParams.LineItem {
  return priceId ? { quantity: 1, price: priceId } : { quantity: 1, price_data: inline };
}

function realStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is required when STRIPE_MODE is not local_stub",
    );
  }
  stripeClient = new Stripe(key, {
    apiVersion: "2025-09-30.clover" as Stripe.LatestApiVersion,
  });
  return stripeClient;
}

export async function createCheckoutSession(
  input: CheckoutSessionInput,
): Promise<CheckoutSessionResult> {
  if (isStubMode()) {
    // Local stub: synthesize a session id, and the URL points right at our
    // own /checkout/success page with the synthetic event id encoded so
    // the success page can trigger our webhook locally. We also encode
    // the lead_id so the stub webhook can pass it through in metadata
    // (mirrors what real Stripe does with our session metadata).
    const sessionId = `cs_stub_${input.leadId}`;
    const stubUrl =
      `${input.successUrl}?session_id=${encodeURIComponent(sessionId)}&stub=1&lead_id=${encodeURIComponent(input.leadId)}`;
    return { id: sessionId, url: stubUrl, mode: "local_stub" };
  }

  const stripe = realStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: input.email,
    line_items: [
      lineItem(process.env.REPORT_PRICE_ID, {
        currency: input.currency,
        unit_amount: input.amountCents,
        product_data: { name: input.productName },
      }),
    ],
    metadata: {
      // Webhook reads lead_id to look up the full wizard config and
      // provision the user / brand / job post-payment.
      lead_id: input.leadId,
    },
    success_url: input.successUrl + "?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: input.cancelUrl,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }
  return {
    id: session.id,
    url: session.url,
    mode: (process.env.STRIPE_MODE as "test" | "live") ?? "test",
  };
}

export async function createSubscriptionSession(
  input: SubscriptionSessionInput,
): Promise<CheckoutSessionResult> {
  if (isStubMode()) {
    // Keep the stub URL shaped like a real Checkout success URL. The success
    // page turns its query parameters into the same webhook event Stripe
    // would send after a completed recurring Checkout session.
    const sessionId = `cs_stub_subscription_${crypto.randomUUID()}`;
    const subscriptionId = `sub_stub_${crypto.randomUUID()}`;
    const customerId = `cus_stub_${input.userId}`;
    const stubUrl = new URL(input.successUrl);
    stubUrl.searchParams.set("session_id", sessionId);
    stubUrl.searchParams.set("stub", "1");
    stubUrl.searchParams.set("subscription", "1");
    stubUrl.searchParams.set("user_id", input.userId);
    stubUrl.searchParams.set("subscription_id", subscriptionId);
    stubUrl.searchParams.set("customer_id", customerId);
    return { id: sessionId, url: stubUrl.toString(), mode: "local_stub" };
  }

  const stripe = realStripe();
  // One Customer per email, shared with the crawl-monitor checkout, so the
  // billing portal reaches every subscription a person holds.
  const customerId = await findOrCreateCustomer(input.email);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      lineItem(process.env.SUBSCRIPTION_PRICE_ID, {
        currency: input.currency,
        unit_amount: input.amountCents,
        recurring: { interval: "month" },
        product_data: { name: input.productName },
      }),
    ],
    metadata: {
      user_id: input.userId,
    },
    subscription_data: {
      metadata: {
        user_id: input.userId,
      },
    },
    success_url: input.successUrl + "?session_id={CHECKOUT_SESSION_ID}&subscription=1",
    cancel_url: input.cancelUrl,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }
  return {
    id: session.id,
    url: session.url,
    mode: (process.env.STRIPE_MODE as "test" | "live") ?? "test",
  };
}

export async function createBillingPortalSession(
  input: BillingPortalSessionInput,
): Promise<{ url: string; mode: "local_stub" | "test" | "live" }> {
  if (isStubMode()) {
    const returnUrl = new URL(input.returnUrl);
    returnUrl.searchParams.set("portal", "stub");
    return { url: returnUrl.toString(), mode: "local_stub" };
  }

  const session = await realStripe().billingPortal.sessions.create({
    customer: input.customerId,
    return_url: input.returnUrl,
  });
  return {
    url: session.url,
    mode: (process.env.STRIPE_MODE as "test" | "live") ?? "test",
  };
}

// ── Crawl monitoring (subscriptions) ────────────────────────────────────────

export type MonitorCheckoutInput = {
  domain: string; // bare lowercased hostname
  origin: string; // https://<domain>
  email: string; // collected by our CTA so we can reuse ONE Stripe Customer
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
};

/** One Stripe Customer per email (Codex-hardened): without this, every
 * subscription checkout creates a fresh Customer and the no-code billing
 * portal can only reach the newest one — older domain subscriptions would
 * become unmanageable for multi-domain subscribers. Shared by the crawl
 * monitor checkout and the dashboard subscription checkout so one email
 * always maps to one Customer. */
export async function findOrCreateCustomer(email: string): Promise<string> {
  const stripe = realStripe();
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing.data[0]) return existing.data[0].id;
  const created = await stripe.customers.create({ email });
  return created.id;
}

export async function createMonitorCheckoutSession(
  input: MonitorCheckoutInput,
): Promise<CheckoutSessionResult> {
  // Metadata goes in BOTH places: session metadata (read by our
  // checkout.session.completed handler) and subscription_data.metadata
  // (rides along on subscription lifecycle events, which do NOT inherit
  // session metadata).
  const metadata = {
    kind: "monitor",
    domain: input.domain,
    origin: input.origin,
  };

  if (isStubMode()) {
    const sessionId = `cs_stub_monitor_${crypto.randomUUID()}`;
    const stubUrl =
      `${input.successUrl}?stub=1&session_id=${encodeURIComponent(sessionId)}` +
      `&domain=${encodeURIComponent(input.domain)}&email=${encodeURIComponent(input.email)}`;
    return { id: sessionId, url: stubUrl, mode: "local_stub" };
  }

  const stripe = realStripe();
  const customerId = await findOrCreateCustomer(input.email);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: input.amountCents,
          recurring: { interval: "month" },
          product_data: { name: `Crawl monitoring — ${input.domain}` },
        },
      },
    ],
    metadata,
    subscription_data: { metadata },
    success_url: input.successUrl + "?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: input.cancelUrl,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return {
    id: session.id,
    url: session.url,
    mode: (process.env.STRIPE_MODE as "test" | "live") ?? "test",
  };
}

/** Out-of-order webhook defense: before activating a monitor, confirm the
 * subscription is actually alive right now. Stripe does not guarantee event
 * ordering — a deletion can arrive before the checkout completion. */
export async function isSubscriptionActive(subscriptionId: string): Promise<boolean> {
  if (isStubMode()) return true; // stub events are synthesized in order
  const sub = await realStripe().subscriptions.retrieve(subscriptionId);
  return sub.status === "active" || sub.status === "trialing";
}

/** Cancel a subscription immediately, crediting any unused time. Used when a
 * second Checkout completes for a user who already has a live subscription:
 * the duplicate must stop billing, not merely be ignored in our database. */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  if (isStubMode()) return;
  await realStripe().subscriptions.cancel(subscriptionId, {
    prorate: true,
    invoice_now: true,
  });
}

// Verify a Stripe webhook signature. In stub mode we accept a magic header
// `x-stub-event: 1` and trust the payload (only meaningful on localhost).
// Belt-and-suspenders: the stub branch ALSO requires NODE_ENV !== production
// even if STRIPE_MODE is somehow misconfigured. (P0 from /review 2026-05-18.)
export function verifyWebhook(
  rawBody: string,
  signature: string | null,
  stubHeader: string | null,
): Stripe.Event {
  if (isStubMode()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Refusing stub webhook in production — STRIPE_MODE must be 'test' or 'live'",
      );
    }
    if (stubHeader === "1") {
      return JSON.parse(rawBody) as Stripe.Event;
    }
    throw new Error("In stub mode, expected x-stub-event: 1 header");
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is required");
  if (!signature) throw new Error("Missing stripe-signature header");
  return realStripe().webhooks.constructEvent(rawBody, signature, secret);
}

export function isLocalStub(): boolean {
  return isStubMode();
}
