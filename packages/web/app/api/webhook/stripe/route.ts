import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase-server";
import { verifyWebhook } from "@/lib/stripe";
import { HostedConfigSchema, type HostedConfig } from "@openllmrank/shared/config";

// Stripe webhook handler. Post-payment provisioning lives here. Flow:
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
//       1. metadata.lead_id  →  lookup leads row
//       2. createUser (or fetch existing by email)
//       3. INSERT brand
//       4. INSERT job with status='paid' immediately
//       5. UPDATE leads SET status='converted', job_id, converted_at
//   }
//
// On error mid-flow: we've already inserted to stripe_events so a retry
// would short-circuit. v1 trade-off: paid customers in this state need
// manual intervention. v1.1 should add a `processed_at` column to
// stripe_events to support retry-the-post-event-work pattern.

export const dynamic = "force-dynamic";

async function findOrCreateAuthUser(
  supabase: ReturnType<typeof serviceClient>,
  email: string,
): Promise<{ ok: true; userId: string } | { ok: false; detail: string }> {
  // Try create first.
  const { data: created, error: createErr } =
    await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { source: "checkout" },
    });
  if (created?.user) return { ok: true, userId: created.user.id };

  // Email exists or createUser failed — page through listUsers.
  for (let page = 1; page <= 10; page++) {
    const { data: list, error: listErr } =
      await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (listErr) break;
    const match = list.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (match) return { ok: true, userId: match.id };
    if (list.users.length < 200) break; // last page
  }

  return {
    ok: false,
    detail:
      createErr?.message ??
      "createUser failed and email not found in listUsers",
  };
}

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

  // Idempotency log. Duplicate events return 200 silently so Stripe stops
  // retrying. We don't care which delivery wins, only that we process the
  // event exactly once.
  const { error: insertErr } = await supabase
    .from("stripe_events")
    .insert({
      id: event.id,
      type: event.type,
      payload_jsonb: event as unknown as Record<string, unknown>,
    });
  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    return NextResponse.json(
      { error: "DB error", detail: insertErr.message },
      { status: 500 },
    );
  }

  // Only checkout.session.completed produces customer data. Other events
  // (charge.*, payment_intent.*) we receive but don't act on; logging
  // them in stripe_events is enough.
  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true, type: event.type });
  }

  const session = event.data.object as {
    id: string;
    payment_intent?: string | null;
    customer_email?: string | null;
    metadata?: Record<string, string> | null;
  };
  const leadId = session.metadata?.lead_id;
  if (!leadId) {
    return NextResponse.json(
      { error: "Missing lead_id in session metadata" },
      { status: 400 },
    );
  }

  // 1. Look up the lead. Holds the full HostedConfig.
  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("id, email, config_jsonb, brand_name, status")
    .eq("id", leadId)
    .single();
  if (leadErr || !lead) {
    return NextResponse.json(
      { error: "Lead not found", detail: leadErr?.message ?? `lead_id=${leadId}` },
      { status: 404 },
    );
  }

  // Idempotency: if the lead is already converted, we've processed this
  // payment before (possibly via a different delivered event in this
  // session). Skip silently.
  if (lead.status === "converted") {
    return NextResponse.json({ received: true, already_converted: true });
  }

  // Re-validate config server-side (defense in depth — Stripe stores
  // whatever we put, but the data could be tampered with in theory).
  const parsedConfig = HostedConfigSchema.safeParse(lead.config_jsonb);
  if (!parsedConfig.success) {
    return NextResponse.json(
      {
        error: "Stored lead config failed validation",
        detail: parsedConfig.error.issues.map((i) => i.message),
      },
      { status: 500 },
    );
  }
  const config: HostedConfig = parsedConfig.data;

  // 2. Provision auth user (or fetch existing).
  const userResult = await findOrCreateAuthUser(supabase, lead.email);
  if (!userResult.ok) {
    return NextResponse.json(
      { error: "Could not provision account", detail: userResult.detail },
      { status: 500 },
    );
  }
  const userId = userResult.userId;

  // 3. Insert the brand.
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

  // 4. Insert the job with status='paid' immediately. Worker picks it up
  //    next. The stripe_checkout_session_id UNIQUE constraint serves as
  //    a backstop against duplicate webhook deliveries that somehow slipped
  //    past the stripe_events idempotency check.
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      user_id: userId,
      brand_id: brand.id,
      status: "paid",
      config_jsonb: config,
      amount_cents: amountCents,
      currency: "usd",
      email_to: lead.email,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent ?? null,
    })
    .select("id")
    .single();
  if (jobErr || !job) {
    // If duplicate session_id, another delivery beat us to it. Treat as success.
    if (jobErr?.code === "23505") {
      return NextResponse.json({ received: true, duplicate_job: true });
    }
    return NextResponse.json(
      { error: "Could not create job", detail: jobErr?.message },
      { status: 500 },
    );
  }

  // 5. Mark lead converted.
  await supabase
    .from("leads")
    .update({
      status: "converted",
      job_id: job.id,
      converted_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  return NextResponse.json({
    received: true,
    job_id: job.id,
    user_id: userId,
    brand_id: brand.id,
  });
}
