// Server-side helpers for the free crawl check.
//
// Privacy model (eng review decision 7A):
//   crawl_checks row  = the crawl data, deduped per domain per 24h
//   crawl_report_tokens = per-REQUESTER unguessable access tokens
// Submitting a domain someone else checked mints a NEW token to the same
// crawl row; nobody ever learns another requester's URL.
//
// Quotas live in Postgres (not the in-memory limiter — Vercel runs many
// instances): submissions counted on tokens per ip-hash/day, crawl load
// counted on checks per domain/day.

import { createHash } from "node:crypto";
import {
  buildFixPrompt,
  domainInputToOrigin,
  FindingSchema,
  isTerminalState,
  Phase1Schema,
  SCHEMA_VERSION,
  type CrawlResult,
  type Finding,
  type Phase1,
} from "@openllmrank/crawl";
import { z } from "zod";
// Relative import (not "@/lib/..."): this module is transitively type-checked
// from the root tsconfig via packages/web/test/, which has no "@/" alias.
import { serviceClient } from "./supabase-server";

export const SUBMISSIONS_PER_IP_PER_DAY = 10;
export const CRAWLS_PER_DOMAIN_PER_DAY = 5;
// Same 24h today, but deliberately separate names: shortening the dedupe
// window must never silently shrink the quota day (review finding).
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Salted hash — we never store raw IPs for anonymous checks. The salt MUST
 * come from the environment in production: with the public in-repo fallback,
 * the IPv4 space is trivially brute-forceable and the "never store raw IPs"
 * promise is void (flagged independently by three reviewers). */
export function hashIp(ip: string): string {
  const salt = process.env.CRAWL_IP_SALT;
  if (!salt) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CRAWL_IP_SALT must be set in production — the IP-hash privacy guarantee depends on it.",
      );
    }
    return createHash("sha256").update(`openllmrank-crawl-dev:${ip}`).digest("hex");
  }
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export type CrawlCheckRecord = {
  id: string;
  domain: string;
  origin: string;
  state: "queued" | "running" | "complete" | "partial" | "failed";
  phase1_jsonb: unknown;
  findings_jsonb: unknown;
  pages_crawled: number;
  pages_discovered: number;
  failure_reason: string | null;
  created_at: string;
  finished_at: string | null;
  delisted: boolean;
};

function sinceIso(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

export async function submissionsToday(ipHash: string): Promise<number> {
  const { count, error } = await serviceClient()
    .from("crawl_report_tokens")
    .select("token", { count: "exact", head: true })
    .eq("requester_ip_hash", ipHash)
    .gte("created_at", sinceIso(QUOTA_WINDOW_MS));
  if (error) throw new Error(`quota query failed: ${error.message}`);
  return count ?? 0;
}

export async function domainCrawlsToday(domain: string): Promise<number> {
  const { count, error } = await serviceClient()
    .from("crawl_checks")
    .select("id", { count: "exact", head: true })
    .eq("domain", domain)
    .gte("created_at", sinceIso(QUOTA_WINDOW_MS));
  if (error) throw new Error(`quota query failed: ${error.message}`);
  return count ?? 0;
}

/** Newest non-delisted crawl of this domain inside the dedupe window.
 * In-flight crawls count ("already running"), but FAILED crawls do not —
 * a transient failure must never poison the domain for 24h with no UI
 * escape (review finding, and the user hit this live). Failed rows still
 * count toward the per-domain quota via domainCrawlsToday. */
export async function recentCheckForDomain(
  domain: string,
): Promise<CrawlCheckRecord | null> {
  const { data, error } = await serviceClient()
    .from("crawl_checks")
    .select("*")
    .eq("domain", domain)
    .eq("delisted", false)
    .neq("state", "failed")
    .gte("created_at", sinceIso(DEDUPE_WINDOW_MS))
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`dedupe query failed: ${error.message}`);
  return (data?.[0] as CrawlCheckRecord | undefined) ?? null;
}

/** Insert a queued crawl. Returns the new check id, or null when the partial
 * unique index (one ACTIVE crawl per domain) reports another instance queued
 * the same domain concurrently — the caller should re-run the dedupe lookup
 * and mint a token against the winner's row. */
export async function insertCheck(args: {
  domain: string;
  origin: string;
  ipHash: string;
}): Promise<string | null> {
  const { data, error } = await serviceClient()
    .from("crawl_checks")
    .insert({
      domain: args.domain,
      origin: args.origin,
      requester_ip_hash: args.ipHash,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return null; // unique violation — lost the race
    throw new Error(`insert check failed: ${error.message}`);
  }
  return (data as { id: string }).id;
}

export async function mintToken(checkId: string, ipHash: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("crawl_report_tokens")
    .insert({ check_id: checkId, requester_ip_hash: ipHash })
    .select("token")
    .single();
  if (error) throw new Error(`mint token failed: ${error.message}`);
  return (data as { token: string }).token;
}

export async function checkByToken(token: string): Promise<CrawlCheckRecord | null> {
  const { data, error } = await serviceClient()
    .from("crawl_report_tokens")
    .select("check_id, crawl_checks(*)")
    .eq("token", token)
    .limit(1);
  if (error) throw new Error(`token lookup failed: ${error.message}`);
  const row = data?.[0] as { crawl_checks: CrawlCheckRecord } | undefined;
  return row?.crawl_checks ?? null;
}

/** True when a NEWER terminal crawl of the same domain exists — the report
 * page renders a supersession banner so stale negative claims don't live
 * unmarked forever (Codex finding 14). */
export async function isSuperseded(check: CrawlCheckRecord): Promise<boolean> {
  const { count, error } = await serviceClient()
    .from("crawl_checks")
    .select("id", { count: "exact", head: true })
    .eq("domain", check.domain)
    .eq("delisted", false)
    .in("state", ["complete", "partial"])
    .gt("created_at", check.created_at);
  if (error) return false; // banner is best-effort, never break the report
  return (count ?? 0) > 0;
}

// ── Submit / read, shared by the /api/crawl-check routes and MCP ────────
//
// One code path for quotas, dedupe and the stored-payload validation, so an
// agent surface can never be a way around a limit the web form enforces.

export type SubmitCrawlCheckResult =
  | { ok: true; token: string; deduped: boolean }
  | { ok: false; status: 400 | 409 | 429; error: string };

/** Validate a domain, enforce the durable quotas, dedupe, queue a crawl and
 * mint the requester's own token. Does NO outbound fetching (eng review
 * decision 6A): the Railway worker does every fetch. */
export async function submitCrawlCheck(args: {
  domain: string;
  ip: string;
  force?: boolean;
}): Promise<SubmitCrawlCheckResult> {
  const origin = domainInputToOrigin(args.domain);
  if (!origin) {
    return { ok: false, status: 400, error: "That doesn't look like a public website domain." };
  }
  const domain = new URL(origin).hostname;
  const ipHash = hashIp(args.ip);

  // Independent reads run concurrently — three serial Postgres round-trips
  // were pure added latency (review finding). The residual check-then-insert
  // race is accepted for v1: worst case is a small quota overshoot, bounded
  // by the callers' burst limiters and the caps themselves.
  const [submitted, recent, crawls] = await Promise.all([
    submissionsToday(ipHash),
    args.force ? Promise.resolve(null) : recentCheckForDomain(domain),
    domainCrawlsToday(domain),
  ]);

  if (submitted >= SUBMISSIONS_PER_IP_PER_DAY) {
    return {
      ok: false,
      status: 429,
      error: `Daily limit reached (${SUBMISSIONS_PER_IP_PER_DAY} checks). Try again tomorrow.`,
    };
  }

  // Dedupe: reuse the crawl DATA, but always mint the requester their OWN
  // token — never reveal an existing report URL (decision 7A).
  if (recent) {
    return { ok: true, token: await mintToken(recent.id, ipHash), deduped: true };
  }

  if (crawls >= CRAWLS_PER_DOMAIN_PER_DAY) {
    return {
      ok: false,
      status: 429,
      error: `This domain was already checked ${CRAWLS_PER_DOMAIN_PER_DAY} times today. Try again tomorrow.`,
    };
  }

  const checkId = await insertCheck({ domain, origin, ipHash });
  if (checkId === null) {
    // Another instance queued this domain in the race window (DB-level
    // unique guard) — reuse the winner's crawl, mint our own token.
    const winner = await recentCheckForDomain(domain);
    if (winner) {
      return { ok: true, token: await mintToken(winner.id, ipHash), deduped: true };
    }
    return { ok: false, status: 409, error: "A check for this domain just started. Try again in a moment." };
  }
  return { ok: true, token: await mintToken(checkId, ipHash), deduped: false };
}

export type CrawlReportView = {
  schema_version: number;
  domain: string;
  state: CrawlCheckRecord["state"];
  phase1: (Omit<Phase1, "sitemap_urls"> & { sitemap_urls: undefined; sitemap_url_count: number }) | null;
  findings: Finding[];
  pages_crawled: number;
  pages_discovered: number;
  failure_reason: string | null;
  created_at: string;
  finished_at: string | null;
  superseded: boolean;
  fix_prompt: string | null;
};

export type ReadCrawlReportResult =
  | { ok: true; report: CrawlReportView }
  | { ok: false; status: 404 | 410 | 500; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FindingsSchema = z.array(FindingSchema);

/** The requester-facing view of a crawl. Stored jsonb is VALIDATED (not cast)
 * so schema drift is a loud 500, not a silently wrong report; the (up to
 * 5,000-entry) sitemap URL list is replaced with a count. */
export async function readCrawlReport(token: string): Promise<ReadCrawlReportResult> {
  if (!UUID_RE.test(token)) return { ok: false, status: 404, error: "Not found" };

  const check = await checkByToken(token);
  if (!check) return { ok: false, status: 404, error: "Not found" };
  if (check.delisted) {
    return { ok: false, status: 410, error: "This report was removed at the site owner's request." };
  }

  const terminal = isTerminalState(check.state);
  const drift = { ok: false, status: 500, error: "Stored report payload does not match its schema" } as const;

  let phase1: Phase1 | null = null;
  if (check.phase1_jsonb !== null && check.phase1_jsonb !== undefined) {
    const parsed = Phase1Schema.safeParse(check.phase1_jsonb);
    if (!parsed.success) return drift;
    phase1 = parsed.data;
  }

  let findings: Finding[] = [];
  if (check.findings_jsonb !== null && check.findings_jsonb !== undefined) {
    const parsed = FindingsSchema.safeParse(check.findings_jsonb);
    if (!parsed.success) return drift;
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

  return {
    ok: true,
    report: {
      schema_version: phase1?.schema_version ?? SCHEMA_VERSION,
      domain: check.domain,
      state: check.state,
      phase1: phase1
        ? { ...phase1, sitemap_urls: undefined, sitemap_url_count: phase1.sitemap_urls.length }
        : null,
      findings,
      pages_crawled: check.pages_crawled,
      pages_discovered: check.pages_discovered,
      failure_reason: check.failure_reason,
      created_at: check.created_at,
      finished_at: check.finished_at,
      superseded: terminal ? await isSuperseded(check) : false,
      fix_prompt: fixPrompt,
    },
  };
}
