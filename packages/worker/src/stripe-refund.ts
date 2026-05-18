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
