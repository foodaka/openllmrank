import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "../../../../lib/rate-limit";
// Relative import — see sibling route.ts for why not "@/lib/...".
import { readMentionCheck } from "../../../../lib/mention-check";

// GET /api/mention-check/[token] — polled by the result page (~3s) until
// the check is complete or failed. Token-gated through the service client.

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ token: string }> | { token: string };
};

export async function GET(req: Request, ctx: RouteContext) {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`mention-read:${ip}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const { token } = await ctx.params;
  const result = await readMentionCheck(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.check);
}
