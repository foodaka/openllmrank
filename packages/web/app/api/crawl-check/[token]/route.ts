import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "../../../../lib/rate-limit";
// Relative import — see sibling route.ts for why not "@/lib/...".
import { readCrawlReport } from "../../../../lib/crawl-check";

// GET /api/crawl-check/[token]
//
// Polling endpoint for the report page (~3s cadence until terminal).
// Token-gated through the service client — the tables have no anon RLS.
// The payload (validated stored jsonb, sitemap list replaced by a count, the
// server-built fix prompt) comes from lib/crawl-check.ts, shared with MCP.

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ token: string }> | { token: string };
};

// Generous vs the 3s poll (one viewer ≈ 20 req/min) but a lid on UUID
// spraying and DB hammering from a single IP (review finding).
const RATE_LIMIT_REQUESTS = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function GET(req: Request, ctx: RouteContext) {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`crawl-report:${ip}`, RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { token } = await ctx.params;
  const result = await readCrawlReport(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.report);
}
