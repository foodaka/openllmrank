import { NextResponse } from "next/server";
import { z } from "zod";
// Relative imports (not "@/lib/..."): these routes are transitively
// type-checked from the root tsconfig via packages/web/test/, no "@/" alias.
import { checkRateLimit, getClientIp } from "../../../lib/rate-limit";
import { submitCrawlCheck } from "../../../lib/crawl-check";

// POST /api/crawl-check  { domain, force? } -> { token }
//
// This route does NO outbound fetching (eng review decision 6A — the Vercel
// tier never touches user-supplied hosts). Validation, quotas, dedupe and the
// insert live in lib/crawl-check.ts (shared with the MCP tool); the Railway
// worker does every fetch.
//
// Two quota layers, deliberately:
//   in-memory limiter  — cheap per-instance burst brake (existing pattern)
//   Postgres counts    — durable truth across instances/deploys

const BodySchema = z.object({
  domain: z.string().min(1).max(300),
  force: z.boolean().optional(),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const burst = checkRateLimit(`crawl:${ip}`, 10, 60_000);
  if (!burst.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Slow down." },
      { status: 429 },
    );
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

  const result = await submitCrawlCheck({ ...parsed.data, ip });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ token: result.token, deduped: result.deduped });
}
