import { NextResponse } from "next/server";
// Relative imports (not "@/lib/..."): these routes are transitively
// type-checked from the root tsconfig via packages/web/test/, no "@/" alias.
import { checkRateLimit, getClientIp } from "../../../lib/rate-limit";
import { MentionCheckInput, submitMentionCheck } from "../../../lib/mention-check";

// POST /api/mention-check  { brand, website, question } -> { token }
//
// Queues a free "Does AI mention you?" check; the Railway worker asks the
// assistants. Durable quotas and the daily spend cap live in
// lib/mention-check.ts; the in-memory limiter here is a burst brake.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const burst = checkRateLimit(`mention:${ip}`, 5, 60_000);
  if (!burst.allowed) {
    return NextResponse.json({ error: "Too many requests. Slow down." }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  const parsed = MentionCheckInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  try {
    const result = await submitMentionCheck({ input: parsed.data, ip });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ token: result.token });
  } catch (e) {
    console.error("[mention-check] submit failed", (e as Error).message);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
