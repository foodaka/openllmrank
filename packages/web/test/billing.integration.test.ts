import { describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createClient } from "@supabase/supabase-js";
import { createSubscriptionSession } from "../lib/stripe";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54331";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PG_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54332/postgres";

async function pgReachable(): Promise<boolean> {
  try {
    const probe = new SQL(PG_URL);
    await probe`select 1`;
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const enabled = Boolean(ANON_KEY && SERVICE_KEY && (await pgReachable()));
const describePg = enabled ? describe : describe.skip;
const testPg = enabled ? test : test.skip;

if (!enabled) {
  console.warn(
    "[billing.integration.test] Skipping: local Supabase and auth keys are required.",
  );
}

process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY ??= SERVICE_KEY;
process.env.STRIPE_MODE = "local_stub";
process.env.NEXT_PUBLIC_SITE_ORIGIN ??= "http://localhost:3000";

let postWebhook: ((request: Request) => Promise<Response>) | undefined;
if (enabled) {
  const route = await import(
    new URL("../app/api/webhook/stripe/route.ts", import.meta.url).href
  );
  postWebhook = route.POST;
}

const admin = enabled
  ? createClient(SUPABASE_URL, SERVICE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

type Fixture = {
  userId: string;
  brandId: string;
  email: string;
  eventIds: string[];
};

async function createFixture(label: string): Promise<Fixture> {
  const email = `billing26-${label}-${crypto.randomUUID()}@example.com`;
  const created = await admin!.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error("fixture user was not created");
  }

  const { data: brand, error: brandError } = await admin!.from("brands").insert({
    user_id: created.data.user.id,
    name: `Billing ${label}`,
    aliases: [],
    cadence: "paused",
  }).select("id").single();
  if (brandError || !brand) {
    await admin!.auth.admin.deleteUser(created.data.user.id);
    throw brandError ?? new Error("fixture brand was not created");
  }

  return {
    userId: created.data.user.id,
    brandId: brand.id,
    email,
    eventIds: [],
  };
}

async function destroyFixture(fixture: Fixture): Promise<void> {
  await admin!.from("stripe_events").delete().in("id", fixture.eventIds);
  await admin!.from("jobs").delete().eq("user_id", fixture.userId);
  await admin!.from("brands").delete().eq("id", fixture.brandId);
  await admin!.from("subscriptions").delete().eq("user_id", fixture.userId);
  await admin!.auth.admin.deleteUser(fixture.userId);
}

async function postEvent(
  fixture: Fixture,
  event: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const eventId = event.id as string;
  if (!fixture.eventIds.includes(eventId)) fixture.eventIds.push(eventId);
  const response = await postWebhook!(new Request("http://localhost/api/webhook/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-stub-event": "1",
    },
    body: JSON.stringify(event),
  }));
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

function checkoutEvent(args: {
  eventId: string;
  sessionId: string;
  subscriptionId: string;
  customerId: string;
  userId: string;
}): Record<string, unknown> {
  return {
    id: args.eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: args.sessionId,
        mode: "subscription",
        subscription: args.subscriptionId,
        customer: args.customerId,
        metadata: { user_id: args.userId },
      },
    },
  };
}

function lifecycleEvent(args: {
  eventId: string;
  type:
    | "customer.subscription.updated"
    | "customer.subscription.deleted"
    | "invoice.payment_failed"
    | "invoice.paid";
  subscriptionId: string;
  customerId: string;
  status?: string;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
}): Record<string, unknown> {
  const object: Record<string, unknown> = {
    id:
      args.type.startsWith("invoice")
        ? `in_${args.eventId}`
        : args.subscriptionId,
    subscription: args.subscriptionId,
    customer: args.customerId,
  };
  if (args.status) object.status = args.status;
  if (args.currentPeriodEnd !== undefined) {
    object.current_period_end = args.currentPeriodEnd;
  }
  if (args.cancelAtPeriodEnd !== undefined) {
    object.cancel_at_period_end = args.cancelAtPeriodEnd;
  }
  return {
    id: args.eventId,
    type: args.type,
    data: { object },
  };
}

describePg("subscription billing integration", () => {
  testPg("completing checkout is active, local, and double-billing safe", async () => {
    const fixture = await createFixture("checkout");
    try {
      const session = await createSubscriptionSession({
        amountCents: 2900,
        currency: "usd",
        productName: "openllmrank tracking",
        userId: fixture.userId,
        email: fixture.email,
        successUrl: "http://localhost:3000/checkout/success",
        cancelUrl: "http://localhost:3000/dashboard/billing",
      });
      const sessionUrl = new URL(session.url);
      const subscriptionId = sessionUrl.searchParams.get("subscription_id")!;
      const customerId = sessionUrl.searchParams.get("customer_id")!;
      const event = checkoutEvent({
        eventId: `evt_billing26_checkout_${crypto.randomUUID()}`,
        sessionId: session.id,
        subscriptionId,
        customerId,
        userId: fixture.userId,
      });

      const first = await postEvent(fixture, event);
      expect(first.status).toBe(200);

      const { data: subscription, error: subscriptionError } = await admin!
        .from("subscriptions")
        .select("id,status,stripe_subscription_id,stripe_customer_id")
        .eq("user_id", fixture.userId)
        .single();
      expect(subscriptionError).toBeNull();
      expect(subscription?.status).toBe("active");
      expect(subscription?.stripe_subscription_id).toBe(subscriptionId);
      expect(subscription?.stripe_customer_id).toBe(customerId);

      const { data: brand } = await admin!
        .from("brands")
        .select("cadence,next_run_at")
        .eq("id", fixture.brandId)
        .single();
      expect(brand?.cadence).toBe("weekly");
      expect(brand?.next_run_at).not.toBeNull();

      const duplicate = await postEvent(fixture, event);
      expect(duplicate.status).toBe(200);
      expect(duplicate.body.duplicate).toBe(true);

      const secondCheckout = await postEvent(
        fixture,
        checkoutEvent({
          eventId: `evt_billing26_second_${crypto.randomUUID()}`,
          sessionId: `cs_stub_subscription_second_${crypto.randomUUID()}`,
          subscriptionId: `sub_stub_second_${crypto.randomUUID()}`,
          customerId: `cus_stub_second_${crypto.randomUUID()}`,
          userId: fixture.userId,
        }),
      );
      expect(secondCheckout.status).toBe(200);
      expect(secondCheckout.body.duplicate_subscription).toBe(true);

      const { data: rows } = await admin!
        .from("subscriptions")
        .select("id")
        .eq("user_id", fixture.userId);
      expect(rows).toHaveLength(1);
    } finally {
      await destroyFixture(fixture);
    }
  });

  testPg("subscription lifecycle events sync status and cadence idempotently", async () => {
    const fixture = await createFixture("lifecycle");
    const subscriptionId = `sub_billing26_${crypto.randomUUID()}`;
    const customerId = `cus_billing26_${crypto.randomUUID()}`;
    try {
      const { error } = await admin!.from("subscriptions").insert({
        user_id: fixture.userId,
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: customerId,
        status: "active",
      });
      expect(error).toBeNull();

      const periodEnd = Math.floor(
        new Date("2027-02-03T00:00:00.000Z").getTime() / 1000,
      );
      const updated = lifecycleEvent({
        eventId: `evt_billing26_updated_${crypto.randomUUID()}`,
        type: "customer.subscription.updated",
        subscriptionId,
        customerId,
        status: "past_due",
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
      });
      expect((await postEvent(fixture, updated)).status).toBe(200);
      expect((await postEvent(fixture, updated)).body.duplicate).toBe(true);

      const { data: pastDue } = await admin!
        .from("subscriptions")
        .select("status,current_period_end,cancel_at_period_end")
        .eq("user_id", fixture.userId)
        .single();
      expect(pastDue?.status).toBe("past_due");
      expect(pastDue?.current_period_end).toBe("2027-02-03T00:00:00+00:00");
      expect(pastDue?.cancel_at_period_end).toBe(true);

      const failed = await postEvent(
        fixture,
        lifecycleEvent({
          eventId: `evt_billing26_failed_${crypto.randomUUID()}`,
          type: "invoice.payment_failed",
          subscriptionId,
          customerId,
        }),
      );
      expect(failed.status).toBe(200);

      const paid = await postEvent(
        fixture,
        lifecycleEvent({
          eventId: `evt_billing26_paid_${crypto.randomUUID()}`,
          type: "invoice.paid",
          subscriptionId,
          customerId,
        }),
      );
      expect(paid.status).toBe(200);
      const { data: resumedBrand } = await admin!
        .from("brands")
        .select("cadence,next_run_at")
        .eq("id", fixture.brandId)
        .single();
      expect(resumedBrand?.cadence).toBe("weekly");
      expect(resumedBrand?.next_run_at).not.toBeNull();

      const deletedEvent = lifecycleEvent({
        eventId: `evt_billing26_deleted_${crypto.randomUUID()}`,
        type: "customer.subscription.deleted",
        subscriptionId,
        customerId,
      });
      const deleted = await postEvent(
        fixture,
        deletedEvent,
      );
      expect(deleted.status).toBe(200);
      expect((await postEvent(fixture, deletedEvent)).body.duplicate).toBe(true);

      const { data: canceled } = await admin!
        .from("subscriptions")
        .select("status")
        .eq("user_id", fixture.userId)
        .single();
      expect(canceled?.status).toBe("canceled");
      const { data: pausedBrand } = await admin!
        .from("brands")
        .select("id,cadence,next_run_at")
        .eq("id", fixture.brandId)
        .single();
      expect(pausedBrand?.id).toBe(fixture.brandId);
      expect(pausedBrand?.cadence).toBe("paused");
      expect(pausedBrand?.next_run_at).toBeNull();
    } finally {
      await destroyFixture(fixture);
    }
  });

  testPg("an early lifecycle event stays retryable until Checkout exists", async () => {
    const fixture = await createFixture("retry");
    const subscriptionId = `sub_billing26_retry_${crypto.randomUUID()}`;
    const customerId = `cus_billing26_retry_${crypto.randomUUID()}`;
    const event = lifecycleEvent({
      eventId: `evt_billing26_retry_${crypto.randomUUID()}`,
      type: "invoice.paid",
      subscriptionId,
      customerId,
    });
    try {
      const first = await postEvent(fixture, event);
      expect(first.status).toBe(404);

      const { data: logged } = await admin!
        .from("stripe_events")
        .select("processed_at")
        .eq("id", event.id)
        .single();
      expect(logged?.processed_at).toBeNull();

      const { error } = await admin!.from("subscriptions").insert({
        user_id: fixture.userId,
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: customerId,
        status: "past_due",
      });
      expect(error).toBeNull();

      const retry = await postEvent(fixture, event);
      expect(retry.status).toBe(200);
      const { data: resumed } = await admin!
        .from("subscriptions")
        .select("status")
        .eq("user_id", fixture.userId)
        .single();
      expect(resumed?.status).toBe("active");
    } finally {
      await destroyFixture(fixture);
    }
  });
});
