import { NextResponse } from "next/server";
import { z } from "zod";
import {
  HostedConfigSchema,
  HOSTED_REPORT_PROVIDERS,
} from "@openllmrank/shared/config";
// Relative imports: this route is imported by packages/web/test, which is
// type-checked from the root tsconfig without the "@/" alias.
import { serviceClient } from "../../../lib/supabase-server";
import {
  createCheckoutSession,
  createSubscriptionSession,
  isLocalStub,
} from "../../../lib/stripe";
import { checkRateLimit, getClientIp } from "../../../lib/rate-limit";
import { reportPriceCents } from "../../../lib/report-provisioning";

// POST /api/checkout
//
// Pre-payment ONLY. Persists the wizard input as a lead, then creates a
// Stripe Checkout session that carries the lead_id in metadata. NO auth
// users, brands, or jobs are created here. All paid-customer mutations
// happen in the webhook handler on `checkout.session.completed`.
//
// Two plans share this entry point:
//   report    one-time payment; the webhook creates a brand + one job
//   tracking  $49/mo subscription; the webhook creates the account, the
//             brand with its tracking config, and the subscription, and the
//             worker scheduler runs the first report within a minute
//
// Why: wizard abandons were creating zombie auth.users + brands + jobs
// rows. The lead table captures the abandon-as-lead signal while leaving
// the paid-customer schema clean.

const BodySchema = z.object({
  config: HostedConfigSchema,
  email: z.string().email(),
  plan: z.enum(["report", "tracking"]).default("report"),
});

export const DEFAULT_SUBSCRIPTION_PRICE_CENTS = 4900;

// Per-IP rate limit: 5 checkout attempts per minute. Without this, anyone
// with curl can flood the leads table and burn Stripe API quota (real
// money in live mode). (Fix from /review on 2026-05-18.)
const RATE_LIMIT_REQUESTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const limit = checkRateLimit(ip, RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "Too many requests",
        detail: `Slow down. Try again at ${new Date(limit.resetAt).toISOString()}.`,
      },
      {
        status: 429,
        headers: {
          "Retry-After": Math.ceil((limit.resetAt - Date.now()) / 1000).toString(),
        },
      },
    );
  }

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

  const { email, plan } = parsed.data;
  // The provider lineup is a server-owned product decision. Do not trust
  // browser storage to choose which providers a paid report receives.
  const config = {
    ...parsed.data.config,
    providers: HOSTED_REPORT_PROVIDERS.map((provider) => ({ ...provider })),
  };
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
      source: plan === "tracking" ? "wizard-tracking" : "wizard",
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

  const origin =
    process.env.NEXT_PUBLIC_SITE_ORIGIN ?? new URL(req.url).origin;

  // 2. Create Stripe Checkout session with lead_id in metadata. Webhook
  //    reads metadata.lead_id to look up this lead and provision the
  //    paid-customer schema.
  let session;
  try {
    session =
      plan === "tracking"
        ? await createSubscriptionSession({
            amountCents: Number.parseInt(
              process.env.SUBSCRIPTION_PRICE_CENTS ?? String(DEFAULT_SUBSCRIPTION_PRICE_CENTS),
              10,
            ),
            currency: "usd",
            productName: process.env.SUBSCRIPTION_PRODUCT_NAME ?? "openllmrank tracking",
            leadId: lead.id,
            email,
            successUrl: `${origin}/checkout/success`,
            cancelUrl: `${origin}/checkout/cancel`,
          })
        : await createCheckoutSession({
            amountCents: reportPriceCents(),
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
    plan,
    stub: isLocalStub(),
  });
}
