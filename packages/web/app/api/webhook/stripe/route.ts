import { NextResponse } from "next/server";
import { ServerClient as PostmarkClient } from "postmark";
// Relative imports: this route is transitively type-checked from the root
// tsconfig via packages/web/test/, which has no "@/" alias.
import { serviceClient } from "../../../../lib/supabase-server";
import {
  cancelSubscription,
  isSubscriptionActive,
  verifyWebhook,
} from "../../../../lib/stripe";
import { sendAccountInviteEmail } from "../../../../lib/account-invite";
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
//     case 'checkout.session.completed' (metadata.kind=monitor): crawl monitor
//     case 'checkout.session.completed' (mode=subscription): dashboard tracking
//     case 'checkout.session.completed' (payment): provision brand + job
//     case subscription lifecycle events: sync billing + cadence state for
//          dashboard subscriptions; deactivate crawl monitors on deletion
//   }
//
// Two subscription products share this endpoint. Dashboard tracking rows
// live in public.subscriptions; crawl monitors live in public.crawl_monitors.
// Lifecycle events are matched against both before anything returns 404.
//
// Events are inserted with processed_at=null before work starts. A failed
// handler therefore remains retryable, while a completed event short-circuits
// duplicate Stripe delivery.

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
): Promise<
  | { ok: true; userId: string; created: boolean }
  | { ok: false; detail: string }
> {
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
  if (created?.user) {
    return { ok: true, userId: created.user.id, created: true };
  }

  // Email exists or createUser failed — page through listUsers.
  for (let page = 1; page <= 10; page++) {
    const { data: list, error: listErr } =
      await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (listErr) break;
    const match = list.users.find(
      (u) => u.email?.toLowerCase() === email,
    );
    if (match) return { ok: true, userId: match.id, created: false };
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
    const fromAddr = process.env.POSTMARK_FROM ?? "reports@openllmrank.io";
    const fromName = process.env.POSTMARK_FROM_NAME ?? "openllmrank";
    await client.sendEmail({
      From: `${fromName} <${fromAddr}>`,
      To: args.to,
      Subject: `Your openllmrank report for ${singleLine(args.brandName)} is being generated`,
      HtmlBody: `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#fbf8f0;color:#241f19;padding:48px 24px;max-width:560px;margin:0 auto">
<p style="font-size:12px;letter-spacing:.11em;text-transform:uppercase;color:#376b5b;font-weight:700">Order received</p>
<h1 style="font-family:Georgia,serif;font-size:32px;line-height:1.05;margin:12px 0 24px;font-weight:500">Your report is being generated.</h1>
<p>Thanks for your order. We're now querying five grounded AI providers with the questions you gave us about <strong>${brandName}</strong> (${args.competitorCount} competitors, ${args.promptCount} prompts).</p>
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

type SubscriptionStatus = "incomplete" | "active" | "past_due" | "canceled";

// Fields we read off customer.subscription.* and invoice.* objects. Stripe
// moved two of them between API versions and the webhook endpoint's pinned
// version is set in the Dashboard, not by our client, so both shapes are read:
//   subscription.current_period_end  ->  subscription.items.data[0].current_period_end
//   invoice.subscription              ->  invoice.parent.subscription_details.subscription
type SubscriptionWebhookObject = {
  id?: unknown;
  object?: unknown;
  customer?: unknown;
  subscription?: unknown;
  status?: unknown;
  current_period_end?: unknown;
  cancel_at_period_end?: unknown;
  items?: { data?: { current_period_end?: unknown }[] | null } | null;
  parent?: { subscription_details?: { subscription?: unknown } | null } | null;
  metadata?: Record<string, string> | null;
};

function stripeId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }
  return null;
}

/** The subscription id an event refers to. Invoice objects carry it in a
 * nested field (and their own id is an invoice id, never a subscription id);
 * subscription objects are the subscription. */
function subscriptionIdOf(object: SubscriptionWebhookObject): string | null {
  const nested =
    stripeId(object.subscription) ??
    stripeId(object.parent?.subscription_details?.subscription);
  if (nested) return nested;
  if (object.object === "invoice") return null;
  return stripeId(object.id);
}

function currentPeriodEndOf(object: SubscriptionWebhookObject): unknown {
  if ("current_period_end" in object) return object.current_period_end;
  const item = object.items?.data?.[0];
  if (item && "current_period_end" in item) return item.current_period_end;
  return undefined;
}

function stripeDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string" && value.length > 0) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

function subscriptionStatus(value: unknown): SubscriptionStatus | null {
  switch (value) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "incomplete":
      return "incomplete";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return null;
  }
}

async function findSubscriptionForEvent(
  supabase: ReturnType<typeof serviceClient>,
  subscriptionId: string | null,
  customerId: string | null,
) {
  const columns = "id,user_id,status,stripe_subscription_id,stripe_customer_id";
  if (subscriptionId) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select(columns)
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    if (error) throw new Error(`subscription lookup: ${error.message}`);
    if (data) return data;
    // A known subscription id that is not ours must not fall through to the
    // customer match: a re-subscribe after cancel would otherwise smear the
    // new subscription's status onto the old row.
    return null;
  }

  if (!customerId) return null;
  const { data, error } = await supabase
    .from("subscriptions")
    .select(columns)
    .eq("stripe_customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`customer subscription lookup: ${error.message}`);
  return data;
}

/** Crawl monitors are billed through the same Stripe account. Their invoice
 * and update events carry no state we store (Stripe owns their billing), but
 * they must be acknowledged, not 404ed, or Stripe retries them for 72 hours
 * and counts the endpoint as failing. */
async function findMonitorForEvent(
  supabase: ReturnType<typeof serviceClient>,
  subscriptionId: string | null,
  customerId: string | null,
): Promise<{ id: string } | null> {
  if (subscriptionId) {
    const { data, error } = await supabase
      .from("crawl_monitors")
      .select("id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    if (error) throw new Error(`monitor lookup: ${error.message}`);
    if (data) return data;
  }
  if (!customerId) return null;
  const { data, error } = await supabase
    .from("crawl_monitors")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`monitor customer lookup: ${error.message}`);
  return data;
}

async function setBrandCadence(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  cadence: "weekly" | "paused",
): Promise<void> {
  const values =
    cadence === "paused"
      ? { cadence, next_run_at: null }
      : { cadence, next_run_at: new Date().toISOString() };
  let query = supabase.from("brands").update(values).eq("user_id", userId);
  if (cadence === "weekly") query = query.is("archived_at", null);
  const { error } = await query;
  if (error) throw new Error(`brand cadence update: ${error.message}`);
}

async function syncSubscription(
  supabase: ReturnType<typeof serviceClient>,
  object: SubscriptionWebhookObject,
  forcedStatus?: SubscriptionStatus,
) {
  const subscriptionId = subscriptionIdOf(object);
  const customerId = stripeId(object.customer);
  const existing = await findSubscriptionForEvent(
    supabase,
    subscriptionId,
    customerId,
  );
  if (!existing) return null;

  const status = forcedStatus ?? subscriptionStatus(object.status);
  if (!status) return { existing, status: null };

  const update: Record<string, unknown> = { status };
  if (customerId) update.stripe_customer_id = customerId;
  const currentPeriodEnd = stripeDate(currentPeriodEndOf(object));
  if (currentPeriodEnd !== undefined) {
    update.current_period_end = currentPeriodEnd;
  }
  if (typeof object.cancel_at_period_end === "boolean") {
    update.cancel_at_period_end = object.cancel_at_period_end;
  }

  const { error } = await supabase
    .from("subscriptions")
    .update(update)
    .eq("id", existing.id);
  if (error) throw new Error(`subscription update: ${error.message}`);

  // Cadence follows billing state. past_due pauses the scheduler (the
  // dashboard stays readable); canceled is terminal. A recovery back to
  // active resumes tracking only on a real transition, so a routine
  // subscription.updated (e.g. cancel_at_period_end toggled) never queues
  // an unplanned run.
  const previous = existing.status as SubscriptionStatus;
  if (status === "canceled" || status === "past_due") {
    if (previous !== status) {
      await setBrandCadence(supabase, existing.user_id, "paused");
    }
  } else if (status === "active" && previous !== "active") {
    await setBrandCadence(supabase, existing.user_id, "weekly");
  }

  return { existing, status };
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

  // Subscription lifecycle events arrive after Checkout and are matched by
  // Stripe's subscription/customer IDs against both subscription products.
  // Unknown Stripe events are still logged and acknowledged; only events we
  // understand can mutate state.
  if (event.type !== "checkout.session.completed") {
    const object = event.data.object as SubscriptionWebhookObject;
    let result: Awaited<ReturnType<typeof syncSubscription>> | undefined;
    let monitorCanceled = false;

    switch (event.type) {
      case "customer.subscription.updated":
        result = await syncSubscription(supabase, object);
        break;
      case "customer.subscription.deleted": {
        // Crawl monitors: cancellation deactivates the monitor. Deletions for
        // unknown ids are fine (out-of-order delivery — the activation path
        // re-checks live status via isSubscriptionActive).
        const subscriptionId = stripeId(object.id);
        if (subscriptionId) {
          const { data: canceled, error: cancelErr } = await supabase
            .from("crawl_monitors")
            .update({ status: "canceled", canceled_at: new Date().toISOString() })
            .eq("stripe_subscription_id", subscriptionId)
            .select("id");
          if (cancelErr) {
            return NextResponse.json(
              { error: "DB error canceling monitor", detail: cancelErr.message },
              { status: 500 },
            );
          }
          monitorCanceled = (canceled?.length ?? 0) > 0;
        }
        result = await syncSubscription(supabase, object, "canceled");
        break;
      }
      case "invoice.payment_failed":
        result = await syncSubscription(supabase, object, "past_due");
        break;
      case "invoice.paid":
        result = await syncSubscription(supabase, object, "active");
        break;
      default:
        await markProcessed();
        return NextResponse.json({ received: true, type: event.type });
    }

    if (!result && !monitorCanceled) {
      const monitor = await findMonitorForEvent(
        supabase,
        subscriptionIdOf(object),
        stripeId(object.customer),
      );
      if (monitor) {
        await markProcessed();
        return NextResponse.json({ received: true, type: event.type, monitor: monitor.id });
      }
      if (event.type === "customer.subscription.deleted") {
        // Nothing to cancel on our side. Acknowledge rather than retry.
        await markProcessed();
        return NextResponse.json({ received: true, type: event.type, unknown_subscription: true });
      }
      // A lifecycle event can race the Checkout event. Returning non-2xx
      // leaves processed_at null so Stripe retries instead of losing it.
      return NextResponse.json(
        { error: "Subscription not found", type: event.type },
        { status: 404 },
      );
    }

    await markProcessed();
    return NextResponse.json({
      received: true,
      type: event.type,
      status: result?.status ?? null,
      ...(monitorCanceled ? { monitor_canceled: stripeId(object.id) } : {}),
    });
  }

  const session = event.data.object as {
    id: string;
    mode?: string;
    payment_intent?: string | null;
    customer?: unknown;
    subscription?: unknown;
    customer_email?: string | null;
    customer_details?: { email?: string | null } | null;
    metadata?: Record<string, string> | null;
  };

  // ── Crawl monitor subscriptions BEFORE either report path: monitor
  // sessions carry kind=monitor, mode=subscription, and no lead_id or
  // user_id, so they must be claimed first.
  if (session.metadata?.kind === "monitor") {
    const domain = session.metadata.domain;
    const origin = session.metadata.origin;
    const email = (session.customer_details?.email ?? session.customer_email ?? "").toLowerCase();
    const customerId = stripeId(session.customer);
    const subscriptionId = stripeId(session.subscription);
    if (!domain || !origin || !email || !customerId || !subscriptionId) {
      return NextResponse.json(
        { error: "Monitor session missing required fields" },
        { status: 400 },
      );
    }
    // Out-of-order defense: only activate if the subscription is alive NOW.
    const alive = await isSubscriptionActive(subscriptionId);
    if (!alive) {
      await markProcessed();
      return NextResponse.json({ received: true, monitor_skipped: "subscription not active" });
    }
    const { error: monErr } = await supabase.from("crawl_monitors").insert({
      domain,
      origin,
      email,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
    });
    // 23505 on stripe_subscription_id = webhook retry after a crash-window —
    // the monitor already exists; treat as success.
    if (monErr && monErr.code !== "23505") {
      return NextResponse.json(
        { error: "DB error creating monitor", detail: monErr.message },
        { status: 500 },
      );
    }
    await markProcessed();
    return NextResponse.json({ received: true, monitor_created: subscriptionId });
  }

  if (session.mode === "subscription") {
    const userId = session.metadata?.user_id;
    const subscriptionId = stripeId(session.subscription);
    const customerId = stripeId(session.customer);
    if (!userId || !subscriptionId || !customerId) {
      return NextResponse.json(
        { error: "Subscription checkout is missing user, subscription, or customer metadata" },
        { status: 400 },
      );
    }

    const { data: sameSubscription, error: sameSubscriptionError } = await supabase
      .from("subscriptions")
      .select("id,user_id,stripe_subscription_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    if (sameSubscriptionError) {
      return NextResponse.json(
        { error: "Could not check subscription", detail: sameSubscriptionError.message },
        { status: 500 },
      );
    }
    if (sameSubscription && sameSubscription.user_id !== userId) {
      return NextResponse.json(
        { error: "Subscription belongs to a different account" },
        { status: 409 },
      );
    }

    const { data: liveSubscription, error: liveSubscriptionError } = await supabase
      .from("subscriptions")
      .select("id,user_id,stripe_subscription_id")
      .eq("user_id", userId)
      .in("status", ["incomplete", "active", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (liveSubscriptionError) {
      return NextResponse.json(
        { error: "Could not check live subscription", detail: liveSubscriptionError.message },
        { status: 500 },
      );
    }

    // Two separate completed Checkout sessions may race each other. Keep the
    // first live subscription and cancel the second in Stripe so the customer
    // is not billed twice; the partial unique index enforces one live row in
    // Postgres. If the cancel call fails, the event stays unprocessed so
    // Stripe retries it rather than leaving a stray paid subscription.
    if (
      liveSubscription &&
      liveSubscription.stripe_subscription_id !== subscriptionId
    ) {
      await cancelSubscription(subscriptionId);
      await markProcessed();
      return NextResponse.json({
        received: true,
        duplicate_subscription: true,
        subscription_id: liveSubscription.stripe_subscription_id,
      });
    }

    let subscriptionRowId = sameSubscription?.id ?? null;
    if (sameSubscription) {
      const { error } = await supabase
        .from("subscriptions")
        .update({
          status: "active",
          stripe_customer_id: customerId,
        })
        .eq("id", sameSubscription.id);
      if (error) {
        return NextResponse.json(
          { error: "Could not activate subscription", detail: error.message },
          { status: 500 },
        );
      }
    } else {
      const { data: inserted, error } = await supabase
        .from("subscriptions")
        .insert({
          user_id: userId,
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: customerId,
          status: "active",
          cancel_at_period_end: false,
        })
        .select("id")
        .single();
      if (error || !inserted) {
        if (error?.code === "23505") {
          // Lost the race against a concurrent delivery of a different
          // Checkout for the same user. Cancel this one so only one bills.
          await cancelSubscription(subscriptionId);
          await markProcessed();
          return NextResponse.json({
            received: true,
            duplicate_subscription: true,
          });
        }
        return NextResponse.json(
          { error: "Could not create subscription", detail: error?.message },
          { status: 500 },
        );
      }
      subscriptionRowId = inserted.id;
    }

    try {
      await setBrandCadence(supabase, userId, "weekly");
    } catch (e) {
      return NextResponse.json(
        { error: "Could not start brand tracking", detail: (e as Error).message },
        { status: 500 },
      );
    }

    await markProcessed();
    return NextResponse.json({
      received: true,
      subscription_id: subscriptionRowId,
      user_id: userId,
    });
  }

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

  // Newly provisioned users have no password. Send the setup link alongside
  // the order receipt; existing users can continue using magic-link login.
  if (userResult.created) {
    await sendAccountInviteEmail({
      supabase,
      to: lead.email,
      brandName: config.brand.name,
    });
  }

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
