// Wizard subscription (plan=tracking): /api/checkout creates a lead + a
// subscription Checkout, and the webhook provisions account + brand +
// subscription on completion. Skips cleanly without local Supabase.

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
    await probe`select 1 from public.subscriptions limit 1`;
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const enabled = Boolean(SERVICE_KEY && (await pgReachable()));
const describePg = enabled ? describe : describe.skip;
if (!enabled) console.warn("[wizard-tracking.test] Skipping: local Supabase and service key required.");
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.STRIPE_MODE = "local_stub";
process.env.NEXT_PUBLIC_SITE_ORIGIN ??= "http://localhost:3000";

const admin = enabled
  ? createClient(SUPABASE_URL, SERVICE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

const config = {
  brand: { name: "TrackCo", aliases: ["trackco.io"], website: "https://trackco.io", category: "uptime monitoring" },
  competitors: [{ name: "Pingdom", aliases: [] }],
  prompts: ["best uptime monitoring tool for startups"],
  providers: [{ id: "openai", model: "gpt-4o-mini" }],
  samples_per_prompt: 3,
  concurrency_per_provider: 4,
};

async function cleanup(email: string, eventIds: string[]) {
  const sql = new SQL(PG_URL);
  await sql`delete from public.stripe_events where id = any(string_to_array(${eventIds.join(",")}, ','))`;
  await sql`delete from public.leads where email = ${email}`;
  await sql`delete from auth.users where email = ${email}`;
  await sql.end();
}

describePg("wizard tracking plan", () => {
  test("checkout creates a tracking lead and a subscription session; the webhook provisions everything", async () => {
    const { POST: checkout } = await import("../app/api/checkout/route");
    const { POST: webhook } = await import("../app/api/webhook/stripe/route");
    const email = `wizard-tracking-${crypto.randomUUID()}@example.com`;
    const eventIds: string[] = [];
    try {
      const res = await checkout(
        new Request("http://localhost/api/checkout", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
          body: JSON.stringify({ config, email, plan: "tracking" }),
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { url: string; plan: string };
      expect(body.plan).toBe("tracking");
      const url = new URL(body.url);
      expect(url.searchParams.get("subscription")).toBe("1");
      expect(url.searchParams.get("plan")).toBe("tracking");
      const leadId = url.searchParams.get("lead_id")!;
      expect(leadId).toBeTruthy();

      const { data: lead } = await admin!.from("leads").select("source,status").eq("id", leadId).single();
      expect(lead).toMatchObject({ source: "wizard-tracking", status: "started" });

      const eventId = `evt_wizard_tracking_${crypto.randomUUID()}`;
      eventIds.push(eventId);
      const fire = () =>
        webhook(
          new Request("http://localhost/api/webhook/stripe", {
            method: "POST",
            headers: { "content-type": "application/json", "x-stub-event": "1" },
            body: JSON.stringify({
              id: eventId,
              type: "checkout.session.completed",
              data: {
                object: {
                  id: url.searchParams.get("session_id"),
                  mode: "subscription",
                  subscription: url.searchParams.get("subscription_id"),
                  customer: url.searchParams.get("customer_id"),
                  metadata: { lead_id: leadId, kind: "tracking" },
                },
              },
            }),
          }),
        );
      const hook = await fire();
      expect(hook.status).toBe(200);
      const hookBody = (await hook.json()) as { user_id: string; brand_id: string };
      expect(hookBody.brand_id).toBeTruthy();

      const { data: brand } = await admin!
        .from("brands")
        .select("name,cadence,next_run_at,config_jsonb,user_id")
        .eq("id", hookBody.brand_id)
        .single();
      expect(brand).toMatchObject({ name: "TrackCo", cadence: "weekly", user_id: hookBody.user_id });
      expect(brand!.next_run_at).not.toBeNull();
      expect((brand!.config_jsonb as { prompts: string[] }).prompts).toEqual(config.prompts);

      const { data: sub } = await admin!.from("subscriptions").select("status").eq("user_id", hookBody.user_id).single();
      expect(sub!.status).toBe("active");
      const { data: converted } = await admin!.from("leads").select("status").eq("id", leadId).single();
      expect(converted!.status).toBe("converted");

      // Stripe retries are idempotent: the same event does not add a brand.
      const again = await fire();
      expect(again.status).toBe(200);
      const { count } = await admin!.from("brands").select("id", { count: "exact", head: true }).eq("user_id", hookBody.user_id);
      expect(count).toBe(1);
    } finally {
      await cleanup(email, eventIds);
    }
  });
});
