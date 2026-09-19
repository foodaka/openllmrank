// POST /api/mcp end to end: MCP handshake, then the agent flow (order ->
// pay with a stub Shared Payment Token -> status -> report) against local
// Supabase. Protocol tests always run; the flow skips cleanly when local
// Supabase is not reachable.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54331";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PG_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54332/postgres";

async function pgReady(): Promise<boolean> {
  try {
    const probe = new SQL(PG_URL);
    await probe`select source from public.jobs limit 1`; // needs migration 0011
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const enabled = Boolean(SERVICE_KEY && (await pgReady()));
const describePg = enabled ? describe : describe.skip;
if (!enabled) {
  console.warn("[mcp-api.test] Skipping flow: local Supabase (with migration 0011) and SUPABASE_SERVICE_ROLE_KEY are required.");
}
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.NEXT_PUBLIC_SITE_ORIGIN = "https://openllmrank.test";
process.env.STRIPE_MODE = "local_stub";
process.env.POSTMARK_MODE = "local_stub";
delete process.env.PRICE_CENTS;

const { POST, GET } = await import("../app/api/mcp/route");

const EMAIL = `mcp-test-${Date.now()}@example.com`;
let nextId = 1;
let ipCounter = 1;

async function rpc(method: string, params: unknown, ip = "203.0.113.1") {
  const res = await POST(
    new Request("https://openllmrank.test/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }),
  );
  return { status: res.status, body: (await res.json()) as any };
}

async function call(name: string, args: Record<string, unknown>, ip?: string) {
  const { body } = await rpc("tools/call", { name, arguments: args }, ip);
  const result = body.result;
  return {
    isError: Boolean(result?.isError),
    data: result?.structuredContent as any,
    text: (result?.content?.[0]?.text ?? "") as string,
  };
}

describe("MCP protocol", () => {
  test("initialize advertises tools and usage instructions", async () => {
    const { status, body } = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(status).toBe(200);
    expect(body.result.serverInfo.name).toBe("openllmrank");
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.instructions).toContain("AI assistants");
  });

  test("lists the five tools, described by user intent", async () => {
    const { body } = await rpc("tools/list", {});
    const tools = body.result.tools as { name: string; description: string }[];
    expect(tools.map((t) => t.name).sort()).toEqual([
      "analyze_brand_visibility",
      "discover_ai_questions",
      "get_report_status",
      "get_visibility_report",
      "pay_for_report",
    ]);
    const analyze = tools.find((t) => t.name === "analyze_brand_visibility")!;
    expect(analyze.description).toContain("ChatGPT");
    expect(analyze.description).not.toMatch(/\bjob\b/i);
  });

  test("GET is not allowed (stateless, no event stream)", async () => {
    expect((await GET()).status).toBe(405);
  });

  test("schema-invalid input is rejected by the SDK, naming the field", async () => {
    const { isError, text } = await call("analyze_brand_visibility", { brand: "X" });
    expect(isError).toBe(true);
    expect(text).toContain("competitors");
  });

  test("input we reject ourselves is a structured, recoverable error", async () => {
    const { isError, data } = await call("analyze_brand_visibility", {
      brand: "X",
      website: "localhost",
      competitors: ["Y"],
      email: "x@example.com",
    });
    expect(isError).toBe(true);
    expect(data.error.code).toBe("INVALID_INPUT");
    expect(data.error.recoverable).toBe(true);
  });

  test("an id without its token is denied before any lookup", async () => {
    const { isError, data } = await call("get_visibility_report", {
      report_id: "00000000-0000-4000-8000-000000000000",
      access_token: "not-a-token",
    });
    expect(isError).toBe(true);
    expect(data.error.code).toBe("ACCESS_DENIED");
  });
});

describePg("MCP agent flow", () => {
  let sql: SQL;
  let order: any;
  let paid: any;

  beforeAll(() => {
    sql = new SQL(PG_URL);
  });

  afterAll(async () => {
    const users = await sql`select id from auth.users where email = ${EMAIL}`;
    for (const u of users) {
      await sql`delete from public.leads where email = ${EMAIL}`;
      await sql`delete from public.jobs where user_id = ${u.id}`;
      await sql`delete from public.brands where user_id = ${u.id}`;
      await sql`delete from auth.users where id = ${u.id}`;
    }
    await sql`delete from public.leads where email = ${EMAIL}`;
    await sql.end();
  });

  test("analyze_brand_visibility prices an order and creates no job", async () => {
    const res = await call("analyze_brand_visibility", {
      brand: "McpTestCo",
      website: "mcptestco.com",
      competitors: ["RivalOne", "RivalTwo"],
      email: EMAIL,
      questions: ["What is the best tool for testing MCP connectors?"],
    });
    expect(res.isError).toBe(false);
    order = res.data;
    expect(order.status).toBe("awaiting_payment");
    expect(order.price).toEqual({ amount: 7900, currency: "usd" });
    expect(order.assistants).toHaveLength(5);
    expect(order.checkout_url).toContain("/checkout/success");

    const [lead] = await sql`select source, status, job_id from public.leads where id = ${order.order_id}`;
    expect(lead.source).toBe("mcp");
    expect(lead.job_id).toBeNull();

    const status = await call("get_report_status", {
      report_id: order.order_id,
      access_token: order.access_token,
    });
    expect(status.data.status).toBe("awaiting_payment");
  });

  test("a declined token charges nothing and creates no job", async () => {
    const res = await call("pay_for_report", {
      order_id: order.order_id,
      access_token: order.access_token,
      payment_token: "spt_declined",
    });
    expect(res.isError).toBe(true);
    expect(res.data.error.code).toBe("PAYMENT_DECLINED");
    const [lead] = await sql`select job_id from public.leads where id = ${order.order_id}`;
    expect(lead.job_id).toBeNull();
  });

  test("pay_for_report creates one paid, refundable job attributed to mcp", async () => {
    const args = {
      order_id: order.order_id,
      access_token: order.access_token,
      payment_token: `spt_stub_${Date.now()}`,
    };
    const res = await call("pay_for_report", args);
    expect(res.isError).toBe(false);
    paid = res.data;
    expect(paid.status).toBe("queued");
    expect(paid.already_paid).toBe(false);
    expect(paid.report_url).toStartWith(`https://openllmrank.test/reports/${paid.report_id}?t=`);

    const [job] = await sql`
      select status, origin, source, amount_cents, email_to, stripe_payment_intent_id
      from public.jobs where id = ${paid.report_id}`;
    expect(job.status).toBe("paid");
    expect(job.origin).toBe("one_shot"); // keeps the worker's auto-refund on failure
    expect(job.source).toBe("mcp");
    expect(job.amount_cents).toBe(7900);
    expect(job.email_to).toBe(EMAIL);
    expect(job.stripe_payment_intent_id).toStartWith("pi_stub_");

    // Retry: same report, no second job.
    const again = await call("pay_for_report", args);
    expect(again.data.already_paid).toBe(true);
    expect(again.data.report_id).toBe(paid.report_id);
    const [{ count }] = await sql`
      select count(*)::int as count from public.jobs where email_to = ${EMAIL}`;
    expect(count).toBe(1);
  });

  test("status resolves from either id; results wait for completion", async () => {
    const byReport = await call("get_report_status", {
      report_id: paid.report_id,
      access_token: paid.access_token,
    });
    expect(byReport.data.status).toBe("queued");
    expect(byReport.data.poll_after_seconds).toBeGreaterThan(0);

    const byOrder = await call("get_report_status", {
      report_id: order.order_id,
      access_token: order.access_token,
    });
    expect(byOrder.data.report_id).toBe(paid.report_id);

    const early = await call("get_visibility_report", {
      report_id: paid.report_id,
      access_token: paid.access_token,
    });
    expect(early.data.error.code).toBe("REPORT_NOT_READY");
    expect(early.data.error.recoverable).toBe(true);
  });

  test("the order token does not open the report, nor another report's token", async () => {
    const wrong = await call("get_visibility_report", {
      report_id: paid.report_id,
      access_token: order.access_token,
    });
    expect(wrong.data.error.code).toBe("ACCESS_DENIED");
  });

  test("order creation is rate limited per caller", async () => {
    const ip = `198.51.100.${ipCounter++}`;
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) {
      const res = await call(
        "analyze_brand_visibility",
        { brand: "X", website: "localhost", competitors: ["Y"], email: "x@example.com" },
        ip,
      );
      limited = res.data.error.code === "RATE_LIMITED";
    }
    expect(limited).toBe(true);
  });
});
