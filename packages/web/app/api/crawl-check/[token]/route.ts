import { NextResponse } from "next/server";
import {
  buildFixPrompt,
  FindingSchema,
  isTerminalState,
  Phase1Schema,
  SCHEMA_VERSION,
  type CrawlResult,
  type Finding,
  type Phase1,
} from "@openllmrank/crawl";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "../../../../lib/rate-limit";
// Relative import — see sibling route.ts for why not "@/lib/...".
import { checkByToken, isSuperseded, type CrawlCheckRecord } from "../../../../lib/crawl-check";

// GET /api/crawl-check/[token]
//
// Polling endpoint for the report page (~3s cadence until terminal).
// Token-gated through the service client — the tables have no anon RLS.
// Stored jsonb is VALIDATED (not cast) at this boundary so schema drift is a
// loud 500, not a silently wrong report; the response carries schema_version
// and replaces the (up to 5,000-entry) sitemap URL list with a count.

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ token: string }> | { token: string };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FindingsSchema = z.array(FindingSchema);

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
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const check = await checkByToken(token);
  if (!check) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (check.delisted) {
    return NextResponse.json(
      { error: "This report was removed at the site owner's request." },
      { status: 410 },
    );
  }

  const terminal = isTerminalState(check.state);

  let phase1: Phase1 | null = null;
  if (check.phase1_jsonb !== null && check.phase1_jsonb !== undefined) {
    const parsed = Phase1Schema.safeParse(check.phase1_jsonb);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Stored report payload does not match its schema" },
        { status: 500 },
      );
    }
    phase1 = parsed.data;
  }

  let findings: Finding[] = [];
  if (check.findings_jsonb !== null && check.findings_jsonb !== undefined) {
    const parsed = FindingsSchema.safeParse(check.findings_jsonb);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Stored report payload does not match its schema" },
        { status: 500 },
      );
    }
    findings = parsed.data;
  }

  // The fix prompt is generated server-side so the fencing rules live in
  // exactly one place (packages/crawl).
  let fixPrompt: string | null = null;
  if (terminal && phase1 && findings.length > 0) {
    const result: CrawlResult = {
      schema_version: phase1.schema_version,
      domain: check.domain,
      state: check.state as CrawlResult["state"],
      failure_reason: check.failure_reason,
      pages_crawled: check.pages_crawled,
      pages_discovered: check.pages_discovered,
      phase1,
      findings,
    };
    fixPrompt = buildFixPrompt(result);
  }

  return NextResponse.json({
    schema_version: phase1?.schema_version ?? SCHEMA_VERSION,
    domain: check.domain,
    state: check.state,
    phase1: phase1
      ? {
          ...phase1,
          sitemap_urls: undefined,
          sitemap_url_count: phase1.sitemap_urls.length,
        }
      : null,
    findings,
    pages_crawled: check.pages_crawled,
    pages_discovered: check.pages_discovered,
    failure_reason: check.failure_reason,
    created_at: check.created_at,
    finished_at: check.finished_at,
    superseded: terminal ? await isSuperseded(check) : false,
    fix_prompt: fixPrompt,
  });
}
