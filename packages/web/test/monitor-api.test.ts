// Integration tests for the monitoring purchase flow: checkout route (stub
// mode) and the webhook's monitor branches — creation, cancellation,
// retry-idempotency, and the regression guard that report purchases still
// route to the lead path. Skips cleanly without local Supabase.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SQL } from "bun";

const envPath = join(import.meta.dir, "..", ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

// Force stub mode regardless of .env.local: the developer's env may point at
// real Stripe test mode (it does on this machine — which incidentally proved
// the subscription session works against the live API), but tests must be
// deterministic and offline. isStubMode() reads process.env at call time.
process.env.STRIPE_MODE = "local_stub";

const PG_URL = `postgresql://postgres:postgres@${process.env.SUPABASE_TEST_HOST ?? "127.0.0.1"}:${process.env.SUPABASE_TEST_PORT ?? "54332"}/postgres`;

async function ready(): Promise<boolean> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const probe = new SQL(PG_URL);
    await probe`select 1 from public.crawl_monitors limit 1`;
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const reachable = await ready();
const describePg = reachable ? describe : describe.skip;
if (!reachable) {
  console.warn("[monitor-api.test] Skipping: local Supabase (with 0005) or web .env.local not available.");
}

const { POST: checkoutPost } = await import("../app/api/monitor/checkout/route");
const { POST: webhookPost } = await import("../app/api/webhook/stripe/route");

let sql: SQL;
const DOMAIN = "monitorapi-test.example";
let ipCounter = 0;

function postCheckout(body: unknown): Promise<Response> {
  return checkoutPost(
    new Request("http://localhost/api/monitor/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `198.51.100.${30 + (ipCounter++ % 200)}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

function postStubEvent(event: unknown): Promise<Response> {
  return webhookPost(
    new Request("http://localhost/api/webhook/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "x-stub-event": "1" },
      body: JSON.stringify(event),
    }),
  );
}

function monitorSessionEvent(overrides: Record<string, unknown> = {}) {
  const nonce = crypto.randomUUID();
  return {
    id: `evt_stub_${nonce}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_stub_monitor_${nonce}`,
        customer: `cus_stub_${nonce}`,
        subscription: `sub_stub_${nonce}`,
        customer_details: { email: "subscriber@monitorapi-test.example" },
        metadata: { kind: "monitor", domain: DOMAIN, origin: `https://${DOMAIN}` },
        ...overrides,
      },
    },
  };
}

beforeAll(async () => {
  if (!reachable) return;
  sql = new SQL(PG_URL);
});

afterAll(async () => {
  if (!reachable) return;
  await sql.end();
});

beforeEach(async () => {
  if (!reachable) return;
  await sql`delete from public.crawl_monitors where domain = ${DOMAIN}`;
  await sql`delete from public.stripe_events where id like 'evt_stub_%'`;
});

describePg("POST /api/monitor/checkout (stub mode)", () => {
  test("valid request returns a stub checkout URL pointing at /monitor/success", async () => {
    const res = await postCheckout({ domain: DOMAIN, email: "me@example.com" });
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toContain("/monitor/success");
    expect(url).toContain("stub=1");
    expect(url).toContain(encodeURIComponent(DOMAIN));
  });

  test("rejects bad email, bad domain, malformed JSON", async () => {
    expect((await postCheckout({ domain: DOMAIN, email: "not-an-email" })).status).toBe(400);
    expect((await postCheckout({ domain: "localhost", email: "a@b.co" })).status).toBe(400);
    const res = await checkoutPost(
      new Request("http://localhost/api/monitor/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.250" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describePg("webhook monitor branches", () => {
  test("kind=monitor session creates an active monitor due immediately", async () => {
    const res = await postStubEvent(monitorSessionEvent());
    expect(res.status).toBe(200);
    const rows = (await sql`
      select status, email, next_crawl_at <= now() as due from public.crawl_monitors where domain = ${DOMAIN}
    `) as unknown as Array<{ status: string; email: string; due: boolean }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "active",
      email: "subscriber@monitorapi-test.example",
      due: true,
    });
  });

  test("webhook retry with the same subscription is idempotent (no duplicate monitor)", async () => {
    const event = monitorSessionEvent();
    await postStubEvent(event);
    // Same session/subscription, DIFFERENT event id (Stripe re-delivery).
    const retry = JSON.parse(JSON.stringify(event)) as { id: string };
    retry.id = `evt_stub_${crypto.randomUUID()}`;
    const res = await postStubEvent(retry);
    expect(res.status).toBe(200);
    const rows = (await sql`
      select count(*)::int as n from public.crawl_monitors where domain = ${DOMAIN}
    `) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1);
  });

  test("customer.subscription.deleted cancels the monitor", async () => {
    const event = monitorSessionEvent();
    await postStubEvent(event);
    const subId = (event.data.object as { subscription: string }).subscription;
    const res = await postStubEvent({
      id: `evt_stub_${crypto.randomUUID()}`,
      type: "customer.subscription.deleted",
      data: { object: { id: subId } },
    });
    expect(res.status).toBe(200);
    const rows = (await sql`
      select status, canceled_at from public.crawl_monitors where stripe_subscription_id = ${subId}
    `) as unknown as Array<{ status: string; canceled_at: string | null }>;
    expect(rows[0]!.status).toBe("canceled");
    expect(rows[0]!.canceled_at).toBeTruthy();
  });

  test("deletion for an unknown subscription is a 200 no-op (out-of-order delivery)", async () => {
    const res = await postStubEvent({
      id: `evt_stub_${crypto.randomUUID()}`,
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_never_seen" } },
    });
    expect(res.status).toBe(200);
  });

  test("monitor session missing required fields is a 400", async () => {
    const res = await postStubEvent(monitorSessionEvent({ subscription: null }));
    expect(res.status).toBe(400);
  });

  test("REGRESSION: report-purchase sessions still route to the lead path", async () => {
    // No kind → must fall through to the lead handler. A bogus lead_id proves
    // routing reached it (404 'Lead not found'), and no monitor row appears.
    const res = await postStubEvent({
      id: `evt_stub_${crypto.randomUUID()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_stub_lead_${crypto.randomUUID()}`,
          metadata: { lead_id: "00000000-0000-4000-8000-000000000000" },
        },
      },
    });
    expect(res.status).toBe(404); // Lead not found — lead path reached
    const rows = (await sql`
      select count(*)::int as n from public.crawl_monitors where domain = ${DOMAIN}
    `) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(0);
  });
});
