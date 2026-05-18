import { NextResponse } from "next/server";
import { z } from "zod";
import { HostedConfigSchema } from "@openllmrank/shared/config";
import { serviceClient } from "@/lib/supabase-server";
import { createCheckoutSession, isLocalStub } from "@/lib/stripe";

// POST /api/checkout
//
// Pre-payment ONLY. Persists the wizard input as a lead, then creates a
// Stripe Checkout session that carries the lead_id in metadata. NO auth
// users, brands, or jobs are created here. All paid-customer mutations
// happen in the webhook handler on `checkout.session.completed`.
//
// Why: wizard abandons were creating zombie auth.users + brands + jobs
// rows. The lead table captures the abandon-as-lead signal while leaving
// the paid-customer schema clean.

const BodySchema = z.object({
  config: HostedConfigSchema,
  email: z.string().email(),
});

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON" },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        detail: parsed.error.issues.map(
          (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
        ),
      },
      { status: 400 },
    );
  }

  const { config, email } = parsed.data;
  const supabase = serviceClient();

  // 1. Insert a lead row. Captures the wizard payload so we can recover
  //    abandons later, AND gives the webhook a stable key (lead_id) to
  //    look up the full config when payment confirms.
  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .insert({
      email,
      brand_name: config.brand.name,
      competitor_count: config.competitors.length,
      prompt_count: config.prompts.length,
      config_jsonb: config,
      source: "wizard",
      status: "started",
    })
    .select("id")
    .single();
  if (leadErr || !lead) {
    return NextResponse.json(
      { error: "Could not record lead", detail: leadErr?.message },
      { status: 500 },
    );
  }

  const amountCents = Number.parseInt(process.env.PRICE_CENTS ?? "2999", 10);
  const origin =
    process.env.NEXT_PUBLIC_SITE_ORIGIN ?? new URL(req.url).origin;

  // 2. Create Stripe Checkout session with lead_id in metadata. Webhook
  //    reads metadata.lead_id to look up this lead and provision the
  //    paid-customer schema.
  let session;
  try {
    session = await createCheckoutSession({
      amountCents,
      currency: "usd",
      productName: process.env.PRODUCT_NAME ?? "openllmrank report",
      leadId: lead.id,
      email,
      successUrl: `${origin}/checkout/success`,
      cancelUrl: `${origin}/checkout/cancel`,
    });
  } catch (e) {
    // Stripe API failure. Lead row stays so we can retry later.
    return NextResponse.json(
      { error: "Could not create checkout session", detail: (e as Error).message },
      { status: 502 },
    );
  }

  // 3. Record the session id on the lead. Webhook can also look up lead
  //    by stripe_checkout_session_id if metadata is lost for any reason.
  await supabase
    .from("leads")
    .update({ stripe_checkout_session_id: session.id })
    .eq("id", lead.id);

  return NextResponse.json({
    url: session.url,
    mode: session.mode,
    stub: isLocalStub(),
  });
}
