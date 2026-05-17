import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase-server";
import { verifyWebhook } from "@/lib/stripe";

// Stripe webhook handler. Lifecycle:
//
//   request body  +  stripe-signature header
//       │
//       ▼
//   verifyWebhook (signature check; stub mode accepts x-stub-event: 1)
//       │
//       ▼
//   stripe_events INSERT ON CONFLICT DO NOTHING (idempotency by event.id)
//       │ if duplicate → return 200 OK silently
//       ▼
//   switch (event.type) {
//     case 'checkout.session.completed':
//       update jobs set status='paid', stripe_payment_intent_id=...
//         where stripe_checkout_session_id = session.id
//   }
//
// At-least-once delivery is real for Stripe webhooks — never rely on
// "this is the first time we've seen this event" without the idempotency
// log.

// IMPORTANT: webhook handlers must read the raw body before parsing JSON
// because the signature verification depends on byte-exact bytes.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  const stubHeader = req.headers.get("x-stub-event");

  let event;
  try {
    event = verifyWebhook(rawBody, signature, stubHeader);
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid signature", detail: (e as Error).message },
      { status: 401 },
    );
  }

  const supabase = serviceClient();

  // Idempotency log
  const { error: insertErr } = await supabase
    .from("stripe_events")
    .insert({
      id: event.id,
      type: event.type,
      payload_jsonb: event as unknown as Record<string, unknown>,
    });
  if (insertErr) {
    // Duplicate key = we've already processed this event. Stripe will treat
    // 200 as "yes, you got it" and stop retrying.
    if (insertErr.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    // Any other DB error: 500 so Stripe retries.
    return NextResponse.json(
      { error: "DB error", detail: insertErr.message },
      { status: 500 },
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as {
      id: string;
      payment_intent?: string | null;
      metadata?: Record<string, string> | null;
    };
    const { error: updateErr } = await supabase
      .from("jobs")
      .update({
        status: "paid",
        stripe_payment_intent_id: session.payment_intent ?? null,
      })
      .eq("stripe_checkout_session_id", session.id);
    if (updateErr) {
      return NextResponse.json(
        { error: "Could not mark job paid", detail: updateErr.message },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ received: true });
}
