import { NextResponse } from "next/server";
import { z } from "zod";
import { HostedConfigSchema } from "@openllmrank/shared/config";
import { serviceClient } from "@/lib/supabase-server";
import { createCheckoutSession, isLocalStub } from "@/lib/stripe";

// POST /api/checkout — validate body, create a pending Job + Brand, then
// hand back a Stripe Checkout URL. Server re-validates with the same
// HostedConfigSchema the wizard uses (defense in depth — never trust the
// client even when it sent the right shape).
//
// In local_stub mode the returned URL is /checkout/success?session_id=...
// and the success page POSTs a synthetic event to /api/webhook/stripe so
// the full pay-to-job flow exercises end-to-end without a Stripe account.

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

  // For v1 we don't require login — buyers checkout as anonymous customers
  // and we identify them by Stripe customer_email + their job row. We need
  // a real auth.users row because brands.user_id has a FK to it.
  //
  // Try to create a Supabase auth user with the buyer's email. If the email
  // already exists (return-buyer), look them up via the admin API and
  // continue with their existing id.
  let userId: string;
  {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { source: "checkout" },
    });
    if (data?.user) {
      userId = data.user.id;
    } else {
      // listUsers paginates; for the lookup we filter by email. The admin
      // API doesn't have a direct getByEmail, but listUsers w/o filter is
      // fine at small scale (paginated 50 at a time).
      const list = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existing = list.data.users.find((u) => u.email === email);
      if (!existing) {
        return NextResponse.json(
          { error: "Could not provision account", detail: error?.message },
          { status: 500 },
        );
      }
      userId = existing.id;
    }
  }

  // Insert the brand row
  const { data: brand, error: brandErr } = await supabase
    .from("brands")
    .insert({
      user_id: userId,
      name: config.brand.name,
      aliases: config.brand.aliases,
    })
    .select("id")
    .single();
  if (brandErr || !brand) {
    return NextResponse.json(
      { error: "Could not save brand", detail: brandErr?.message },
      { status: 500 },
    );
  }

  const amountCents = Number.parseInt(process.env.PRICE_CENTS ?? "2999", 10);

  // Insert pending job
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      user_id: userId,
      brand_id: brand.id,
      status: "pending",
      config_jsonb: config,
      amount_cents: amountCents,
      currency: "usd",
      email_to: email,
    })
    .select("id")
    .single();
  if (jobErr || !job) {
    return NextResponse.json(
      { error: "Could not create job", detail: jobErr?.message },
      { status: 500 },
    );
  }

  // Resolve site origin for redirect URLs
  const origin =
    process.env.NEXT_PUBLIC_SITE_ORIGIN ??
    new URL(req.url).origin;

  const session = await createCheckoutSession({
    amountCents,
    currency: "usd",
    productName: process.env.PRODUCT_NAME ?? "openllmrank report",
    jobId: job.id,
    userId,
    email,
    successUrl: `${origin}/checkout/success`,
    cancelUrl: `${origin}/checkout/cancel`,
  });

  // Persist the Stripe session id on the job so the webhook can find it
  await supabase
    .from("jobs")
    .update({ stripe_checkout_session_id: session.id })
    .eq("id", job.id);

  return NextResponse.json({
    url: session.url,
    mode: session.mode,
    stub: isLocalStub(),
  });
}
