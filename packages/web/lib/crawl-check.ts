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
