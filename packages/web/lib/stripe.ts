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
      {
        quantity: 1,
        price_data: {
          currency: input.currency,
          unit_amount: input.amountCents,
          product_data: { name: input.productName },
        },
      },
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
