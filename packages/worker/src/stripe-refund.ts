import Stripe from "stripe";
import { env, isStripeStub } from "./env";

let _stripe: Stripe | null = null;
function client(): Stripe {
  if (_stripe) return _stripe;
  if (!env.stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY required when STRIPE_MODE is not local_stub");
  }
  _stripe = new Stripe(env.stripeSecretKey, {
    apiVersion: "2025-09-30.clover" as Stripe.LatestApiVersion,
  });
  return _stripe;
}

export type RefundResult =
  | { ok: true; refund_id: string; mode: "local_stub" | "test" | "live" }
  | { ok: false; code: string; message: string };

/**
 * Look up the payment_intent for a Stripe Checkout session. Used by the
 * refunder when the job's stripe_payment_intent_id is null — this can
 * happen for async payment methods (delayed bank transfers, ACH, BACS)
 * where Stripe doesn't populate payment_intent on the original
 * checkout.session.completed event. We retrieve the session with the
 * payment_intent expanded.
 *
 * (Fix from /review on 2026-05-18 — without this, the refunder silently
 * marked refund_status='completed' WITHOUT actually refunding.)
 */
export async function resolvePaymentIntent(
  sessionId: string,
): Promise<{ ok: true; paymentIntentId: string } | { ok: false; reason: string }> {
  if (isStripeStub()) {
    return { ok: true, paymentIntentId: `pi_stub_${sessionId}` };
  }
  try {
    const session = await client().checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });
    const pi =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!pi) {
      return {
        ok: false,
        reason:
          "session has no payment_intent (async payment method still pending or already refunded)",
      };
    }
    return { ok: true, paymentIntentId: pi };
  } catch (e) {
    return {
      ok: false,
      reason: (e as Error).message ?? "stripe.checkout.sessions.retrieve failed",
    };
  }
}

/**
 * Issue a refund for a paid checkout that failed downstream. In stub mode
 * we log and pretend success. In test/live we call the real Stripe API.
 */
export async function refundPaymentIntent(
  paymentIntentId: string,
  reason: "requested_by_customer" | "duplicate" | "fraudulent" = "requested_by_customer",
): Promise<RefundResult> {
  if (isStripeStub()) {
    console.log(`[stripe stub] refund payment_intent=${paymentIntentId} reason=${reason}`);
    return {
      ok: true,
      refund_id: `re_stub_${paymentIntentId}`,
      mode: "local_stub",
    };
  }
  try {
    const refund = await client().refunds.create({
      payment_intent: paymentIntentId,
      reason,
    });
    return {
      ok: true,
      refund_id: refund.id,
      mode: env.stripeMode as "test" | "live",
    };
  } catch (e) {
    const err = e as { code?: string; message?: string; statusCode?: number };
    return {
      ok: false,
      code: err.code ?? `STRIPE_${err.statusCode ?? "UNKNOWN"}`,
      message: err.message ?? String(e),
    };
  }
}
