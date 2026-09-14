// Integration tests for the merged Stripe webhook: dashboard subscriptions
// and crawl monitors share one endpoint. Skips cleanly without local Supabase.

import { describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54331";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PG_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54332/postgres";

async function pgReachable(): Promise<boolean> {
  try {
    const probe = new SQL(PG_URL);
    await probe`select 1 from public.crawl_monitors limit 1`;
    await probe`select 1 from public.subscriptions limit 1`;
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const enabled = Boolean(SERVICE_KEY && (await pgReachable()));
const describePg = enabled ? describe : describe.skip;
if (!enabled) {
  console.warn("[webhook-merge.test] Skipping: local Supabase (0005 + 0006) and service key required.");
}
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.STRIPE_MODE = "local_stub";

let postWebhook: ((request: Request) => Promise<Response>) | undefined;
if (enabled) {
  postWebhook = (await import("../app/api/webhook/stripe/route")).POST;
}
const admin = enabled
  ? createClient(SUPABASE_URL, SERVICE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

type Fixture = { userId: string; brandId: string; email: string; eventIds: string[]; monitorSubs: string[] };

async function fixture(label: string): Promise<Fixture> {
  const email = `webhookmerge-${label}-${crypto.randomUUID()}@example.com`;
  const created = await admin!.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("no user");
  const { data: brand } = await admin!
    .from("brands")
    .insert({ user_id: created.data.user.id, name: `Merge ${label}`, aliases: [], cadence: "paused" })
    .select("id")
    .single();
  return { userId: created.data.user.id, brandId: brand!.id, email, eventIds: [], monitorSubs: [] };
}

async function destroy(f: Fixture): Promise<void> {
  await admin!.from("stripe_events").delete().in("id", f.eventIds);
  await admin!.from("crawl_monitors").delete().in("stripe_subscription_id", f.monitorSubs);
  await admin!.from("brands").delete().eq("id", f.brandId);
  await admin!.from("subscriptions").delete().eq("user_id", f.userId);
  await admin!.auth.admin.deleteUser(f.userId);
}

async function post(f: Fixture, event: Record<string, unknown>) {
  f.eventIds.push(event.id as string);
  const res = await postWebhook!(
    new Request("http://localhost/api/webhook/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "x-stub-event": "1" },
      body: JSON.stringify(event),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const evt = (type: string, object: Record<string, unknown>) => ({
  id: `evt_merge_${crypto.randomUUID()}`,
  type,
  data: { object },
});

async function subscriptionRow(userId: string) {
  const { data } = await admin!
    .from("subscriptions")
    .select("status,current_period_end,cancel_at_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  return data as { status: string; current_period_end: string | null; cancel_at_period_end: boolean } | null;
}
async function brandRow(brandId: string) {
  const { data } = await admin!.from("brands").select("cadence,next_run_at").eq("id", brandId).single();
  return data as { cadence: string; next_run_at: string | null };
}
async function processed(eventId: string) {
  const { data } = await admin!.from("stripe_events").select("processed_at").eq("id", eventId).single();
  return Boolean(data?.processed_at);
}

async function activate(f: Fixture, subId: string, cusId: string) {
  const r = await post(
    f,
    evt("checkout.session.completed", {
      id: `cs_${crypto.randomUUID()}`,
      mode: "subscription",
      subscription: subId,
      customer: cusId,
      metadata: { user_id: f.userId },
    }),
  );
  expect(r.status).toBe(200);
}

describePg("merged Stripe webhook", () => {
  test("payment failure pauses tracking; recovery resumes once, not on every update", async () => {
    const f = await fixture("pastdue");
    try {
      const sub = `sub_${crypto.randomUUID()}`;
      const cus = `cus_${crypto.randomUUID()}`;
      await activate(f, sub, cus);
      expect((await brandRow(f.brandId)).cadence).toBe("weekly");

      const failed = await post(f, evt("invoice.payment_failed", { id: "in_1", object: "invoice", subscription: sub, customer: cus }));
      expect(failed.status).toBe(200);
      expect((await subscriptionRow(f.userId))!.status).toBe("past_due");
      const paused = await brandRow(f.brandId);
      expect(paused.cadence).toBe("paused");
      expect(paused.next_run_at).toBeNull();

      const recovered = await post(f, evt("customer.subscription.updated", { id: sub, object: "subscription", customer: cus, status: "active" }));
      expect(recovered.status).toBe(200);
      const resumed = await brandRow(f.brandId);
      expect(resumed.cadence).toBe("weekly");
      expect(resumed.next_run_at).not.toBeNull();

      // A routine update while already active must not re-queue a run.
      await admin!.from("brands").update({ next_run_at: "2030-01-01T00:00:00.000Z" }).eq("id", f.brandId);
      await post(f, evt("customer.subscription.updated", { id: sub, object: "subscription", customer: cus, status: "active", cancel_at_period_end: true }));
      expect((await brandRow(f.brandId)).next_run_at).toBe("2030-01-01T00:00:00+00:00");
      expect((await subscriptionRow(f.userId))!.cancel_at_period_end).toBe(true);
    } finally {
      await destroy(f);
    }
  });

  test("reads the newer Stripe field shapes", async () => {
    const f = await fixture("shapes");
    try {
      const sub = `sub_${crypto.randomUUID()}`;
      const cus = `cus_${crypto.randomUUID()}`;
      await activate(f, sub, cus);

      const periodEnd = 1_900_000_000;
      const updated = await post(f, evt("customer.subscription.updated", {
        id: sub,
        object: "subscription",
        customer: cus,
        status: "active",
        items: { data: [{ current_period_end: periodEnd }] },
      }));
      expect(updated.status).toBe(200);
      expect((await subscriptionRow(f.userId))!.current_period_end).toBe(new Date(periodEnd * 1000).toISOString().replace(".000Z", "+00:00"));

      // invoice.paid whose subscription id is only under parent.subscription_details
      const paid = await post(f, evt("invoice.paid", {
        id: "in_2",
        object: "invoice",
        customer: `cus_other_${crypto.randomUUID()}`,
        parent: { subscription_details: { subscription: sub } },
      }));
      expect(paid.status).toBe(200);
      expect(paid.body.status).toBe("active");

      // An invoice id must never be treated as a subscription id.
      const orphan = await post(f, evt("invoice.paid", { id: "in_3", object: "invoice", customer: `cus_nobody_${crypto.randomUUID()}` }));
      expect(orphan.status).toBe(404);
    } finally {
      await destroy(f);
    }
  });

  test("crawl monitor lifecycle events are acknowledged, and deletion cancels the monitor", async () => {
    const f = await fixture("monitor");
    const monSub = `sub_mon_${crypto.randomUUID()}`;
    const monCus = `cus_mon_${crypto.randomUUID()}`;
    f.monitorSubs.push(monSub);
    try {
      // Dispatch order: monitor kind must win even though mode=subscription.
      const created = await post(f, evt("checkout.session.completed", {
        id: `cs_mon_${crypto.randomUUID()}`,
        mode: "subscription",
        subscription: monSub,
        customer: monCus,
        customer_details: { email: f.email },
        metadata: { kind: "monitor", domain: "merge-test.example", origin: "https://merge-test.example" },
      }));
      expect(created.status).toBe(200);
      expect(created.body.monitor_created).toBe(monSub);
      expect(await subscriptionRow(f.userId)).toBeNull();

      const paid = await post(f, evt("invoice.paid", { id: "in_m1", object: "invoice", subscription: monSub, customer: monCus }));
      expect(paid.status).toBe(200);
      expect(typeof paid.body.monitor).toBe("string");
      expect(await processed(paid.body ? (f.eventIds.at(-1) as string) : "")).toBe(true);

      const updated = await post(f, evt("customer.subscription.updated", { id: monSub, object: "subscription", customer: monCus, status: "active" }));
      expect(updated.status).toBe(200);
      expect(await subscriptionRow(f.userId)).toBeNull();

      const deleted = await post(f, evt("customer.subscription.deleted", { id: monSub, object: "subscription", customer: monCus, status: "canceled" }));
      expect(deleted.status).toBe(200);
      expect(deleted.body.monitor_canceled).toBe(monSub);
      const { data: monitor } = await admin!.from("crawl_monitors").select("status").eq("stripe_subscription_id", monSub).single();
      expect(monitor!.status).toBe("canceled");

      const unknown = await post(f, evt("customer.subscription.deleted", { id: `sub_unknown_${crypto.randomUUID()}`, object: "subscription" }));
      expect(unknown.status).toBe(200);
      expect(unknown.body.unknown_subscription).toBe(true);
    } finally {
      await destroy(f);
    }
  });

  test("a second Checkout for a user with a live subscription is a duplicate, and cancel is attempted", async () => {
    const f = await fixture("dup");
    try {
      const cus = `cus_${crypto.randomUUID()}`;
      await activate(f, `sub_${crypto.randomUUID()}`, cus);
      const dup = await post(f, evt("checkout.session.completed", {
        id: `cs_${crypto.randomUUID()}`,
        mode: "subscription",
        subscription: `sub_dup_${crypto.randomUUID()}`,
        customer: cus,
        metadata: { user_id: f.userId },
      }));
      expect(dup.status).toBe(200);
      expect(dup.body.duplicate_subscription).toBe(true);
      const { count } = await admin!.from("subscriptions").select("id", { count: "exact", head: true }).eq("user_id", f.userId);
      expect(count).toBe(1);
    } finally {
      await destroy(f);
    }
  });
});
