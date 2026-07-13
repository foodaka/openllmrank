import { NextResponse } from "next/server";
import { ServerClient as PostmarkClient } from "postmark";
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

async function findOrCreateAuthUser(
  supabase: ReturnType<typeof serviceClient>,
  rawEmail: string,
): Promise<{ ok: true; userId: string } | { ok: false; detail: string }> {
  // Normalize to lowercase so Alice@x.com and alice@x.com map to the same
  // auth.users row. Without this, listUsers.find compares lowercased while
  // createUser is case-sensitive, producing duplicate accounts on second
  // checkout. (P0 finding from /review on 2026-05-18.)
  const email = rawEmail.trim().toLowerCase();

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
      (u) => u.email?.toLowerCase() === email,
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

// Fire-and-log "your report is being generated" email. Best-effort —
// failures get logged but don't block the webhook response (Stripe gets
// 200 either way; if email genuinely matters, the email-retry worker
// loop covers the final report email). The order-received email is short
// enough that we render inline here rather than going through the worker
// outbox. (Wiring fix from /review on 2026-05-18 — function existed in
// the worker but was never called.)
async function sendOrderReceivedEmail(args: {
  to: string;
  brandName: string;
  competitorCount: number;
  promptCount: number;
}): Promise<void> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const postmarkMode = process.env.POSTMARK_MODE ?? "local_stub";
  if (postmarkMode === "local_stub" || !token) {
    console.log(
      `[order-received stub] to=${args.to} brand=${args.brandName} (POSTMARK_MODE=${postmarkMode})`,
    );
    return;
  }
  try {
    const brandName = escapeHtml(args.brandName);
    const client = new PostmarkClient(token);
    const fromAddr = process.env.POSTMARK_FROM ?? "reports@openllmrank.com";
    const fromName = process.env.POSTMARK_FROM_NAME ?? "openllmrank";
    await client.sendEmail({
      From: `${fromName} <${fromAddr}>`,
      To: args.to,
      Subject: `Your openllmrank report for ${singleLine(args.brandName)} is being generated`,
      HtmlBody: `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#fbf8f0;color:#241f19;padding:48px 24px;max-width:560px;margin:0 auto">
<p style="font-size:12px;letter-spacing:.11em;text-transform:uppercase;color:#376b5b;font-weight:700">Order received</p>
<h1 style="font-family:Georgia,serif;font-size:32px;line-height:1.05;margin:12px 0 24px;font-weight:500">Your report is being generated.</h1>
<p>Thanks for your order. We're now querying grounded OpenAI and Anthropic APIs with the questions you gave us about <strong>${brandName}</strong> (${args.competitorCount} competitors, ${args.promptCount} prompts).</p>
<p>Estimated time: 10-15 minutes. Your report will land in this inbox when it's ready.</p>
<p style="font-family:Georgia,serif;font-style:italic;color:#756c60;margin-top:32px">— openllmrank</p>
</body></html>`,
      MessageStream: "outbound",
      Tag: "order-received",
    });
  } catch (e) {
    // Best-effort. Don't fail the webhook over an email send.
    console.error("[order-received] postmark send failed:", (e as Error).message);
  }
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

  // Idempotency log with explicit processed_at tracking. We INSERT the row
  // with processed_at=null (so the event is logged for replay debugging).
  // Then we do the work. If the work succeeds, we UPDATE processed_at=now().
  // On retry, we only short-circuit when processed_at IS NOT NULL — meaning
  // the previous handler ran to completion. Without this, a crash between
  // event-insert and job-insert silently swallowed the event on retry and
  // the customer paid with no job created. (P0 from /review on 2026-05-18.)
  const { error: insertErr } = await supabase
    .from("stripe_events")
    .insert({
      id: event.id,
      type: event.type,
      payload_jsonb: event as unknown as Record<string, unknown>,
      processed_at: null,
    });
  if (insertErr && insertErr.code !== "23505") {
    return NextResponse.json(
      { error: "DB error", detail: insertErr.message },
      { status: 500 },
    );
  }
  // If insert conflicted (23505), this is a retry. Check whether the
  // previous attempt completed successfully (processed_at IS NOT NULL).
  // If yes → return 200 silently. If no → fall through and re-run the
  // handler so Stripe's retry actually does the work this time.
  if (insertErr) {
    const { data: existing } = await supabase
      .from("stripe_events")
      .select("processed_at")
      .eq("id", event.id)
      .single();
    if (existing?.processed_at) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    // Previous attempt didn't complete — fall through and re-run.
  }

  // Helper: mark the event processed at the end of a successful handler.
  // If the caller never reaches this, processed_at stays null and Stripe's
  // retry triggers a re-run via the fall-through above.
  const markProcessed = async () => {
    await supabase
      .from("stripe_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", event.id);
  };

  // Only checkout.session.completed produces customer data. Other events
  // (charge.*, payment_intent.*) we receive but don't act on; logging
  // them in stripe_events is enough.
  if (event.type !== "checkout.session.completed") {
    await markProcessed();
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
    await markProcessed();
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
      await markProcessed();
      return NextResponse.json({ received: true, duplicate_job: true });
    }
    return NextResponse.json(
      { error: "Could not create job", detail: jobErr?.message },
      { status: 500 },
    );
  }

  // 5. Fire the "order received" email so the customer has confirmation
  //    while the worker generates the report. Best-effort; failures log
  //    but don't block.
  void sendOrderReceivedEmail({
    to: lead.email,
    brandName: config.brand.name,
    competitorCount: config.competitors.length,
    promptCount: config.prompts.length,
  });

  // 6. Mark lead converted.
  await supabase
    .from("leads")
    .update({
      status: "converted",
      job_id: job.id,
      converted_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  // Mark the event processed. If we reach this line, every step above
  // succeeded — a retry of the same event should short-circuit.
  await markProcessed();

  return NextResponse.json({
    received: true,
    job_id: job.id,
    user_id: userId,
    brand_id: brand.id,
  });
}
