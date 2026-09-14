import { NextResponse } from "next/server";
import { z } from "zod";
import { domainInputToOrigin } from "@openllmrank/crawl";
// Relative imports (not "@/lib/..."): these routes are transitively
// type-checked from the root tsconfig via packages/web/test/, no "@/" alias.
import { checkRateLimit, getClientIp } from "../../../lib/rate-limit";
import {
  CRAWLS_PER_DOMAIN_PER_DAY,
  SUBMISSIONS_PER_IP_PER_DAY,
  domainCrawlsToday,
  hashIp,
  insertCheck,
  mintToken,
  recentCheckForDomain,
  submissionsToday,
} from "../../../lib/crawl-check";

// POST /api/crawl-check  { domain, force? } -> { token }
//
// This route does NO outbound fetching (eng review decision 6A — the Vercel
// tier never touches user-supplied hosts). It validates, enforces quotas,
// dedupes, inserts a queued crawl_checks row, and mints a report token. The
// Railway worker does every fetch.
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

  const origin = domainInputToOrigin(parsed.data.domain);
  if (!origin) {
    return NextResponse.json(
      { error: "That doesn't look like a public website domain." },
      { status: 400 },
    );
  }
  const domain = new URL(origin).hostname;
  const ipHash = hashIp(ip);

  // Independent reads run concurrently — three serial Postgres round-trips
  // were pure added latency (review finding). The residual check-then-insert
  // race is accepted for v1: worst case is a small quota overshoot, bounded
  // by the burst limiter above and the caps themselves.
  const [submitted, recent, crawls] = await Promise.all([
    submissionsToday(ipHash),
    parsed.data.force ? Promise.resolve(null) : recentCheckForDomain(domain),
    domainCrawlsToday(domain),
  ]);

  if (submitted >= SUBMISSIONS_PER_IP_PER_DAY) {
    return NextResponse.json(
      { error: `Daily limit reached (${SUBMISSIONS_PER_IP_PER_DAY} checks). Try again tomorrow.` },
      { status: 429 },
    );
  }

  // Dedupe: reuse the crawl DATA, but always mint the requester their OWN
  // token — never reveal an existing report URL (decision 7A).
  if (recent) {
    const token = await mintToken(recent.id, ipHash);
    return NextResponse.json({ token, deduped: true });
  }

  if (crawls >= CRAWLS_PER_DOMAIN_PER_DAY) {
    return NextResponse.json(
      {
        error: `This domain was already checked ${CRAWLS_PER_DOMAIN_PER_DAY} times today. Try again tomorrow.`,
      },
      { status: 429 },
    );
  }

  const checkId = await insertCheck({ domain, origin, ipHash });
  if (checkId === null) {
    // Another instance queued this domain in the race window (DB-level
    // unique guard) — reuse the winner's crawl, mint our own token.
    const winner = await recentCheckForDomain(domain);
    if (winner) {
      const token = await mintToken(winner.id, ipHash);
      return NextResponse.json({ token, deduped: true });
    }
    return NextResponse.json(
      { error: "A check for this domain just started. Try again in a moment." },
      { status: 409 },
    );
  }
  const token = await mintToken(checkId, ipHash);
  return NextResponse.json({ token, deduped: false });
}
