import { NextResponse } from "next/server";
import { z } from "zod";
import { domainInputToOrigin } from "@openllmrank/crawl";
// Relative imports — these routes are transitively type-checked from the
// root tsconfig via packages/web/test/, which has no "@/" alias.
import { checkRateLimit, getClientIp } from "../../../../lib/rate-limit";
import { createMonitorCheckoutSession } from "../../../../lib/stripe";

// POST /api/monitor/checkout  { domain, email } -> { url }
//
// Starts a $29/mo per-domain monitoring subscription. Email is collected by
// OUR form (not Stripe) so checkout can reuse one Stripe Customer per email —
// required for the no-code billing portal to reach every subscription a
// multi-domain subscriber owns (eng review, Codex-hardened).

const BodySchema = z.object({
  domain: z.string().min(1).max(300),
  email: z.string().email().max(320),
});

const MONITOR_PRICE_CENTS = 2900;

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const burst = checkRateLimit(`monitor-checkout:${ip}`, 5, 60_000);
  if (!burst.allowed) {
    return NextResponse.json({ error: "Too many requests. Slow down." }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const origin = domainInputToOrigin(parsed.data.domain);
  if (!origin) {
    return NextResponse.json(
      { error: "That doesn't look like a public website domain." },
      { status: 400 },
    );
  }
  const domain = new URL(origin).hostname;
  const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN ?? new URL(req.url).origin;

  let session;
  try {
    session = await createMonitorCheckoutSession({
      domain,
      origin,
      email: parsed.data.email.toLowerCase(),
      amountCents: Number.parseInt(process.env.MONITOR_PRICE_CENTS ?? String(MONITOR_PRICE_CENTS), 10),
      successUrl: `${siteOrigin}/monitor/success`,
      cancelUrl: `${siteOrigin}/check`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Could not create checkout session", detail: (e as Error).message },
      { status: 502 },
    );
  }

  return NextResponse.json({ url: session.url });
}
