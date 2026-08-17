// Claim/update logic for free crawl-check jobs. Deliberately a SEPARATE
// table and claim path from the paid `jobs` queue (eng review decision 2A):
// a queued crawl can never delay a paid claim, structurally.
//
//   queued ──claim──► running ──finish──► complete | partial | failed
//                        │
//                        └─ lease expiry (claimed_at stale) → reclaimed
//
// Rows are FROZEN after a terminal state — a re-check is a new row.

import type { SQL } from "bun";
import { env } from "./env";
import type { CrawlProgress, CrawlResult, Phase1 } from "@openllmrank/crawl";

export type CrawlCheckRow = {
  id: string;
  domain: string;
  origin: string;
  attempts: number;
};

const MAX_CRAWL_ATTEMPTS = 2;

// Fencing token for lease-guarded writes. env.workerId alone is NOT unique
// across overlapping deploys/replicas that share a static WORKER_ID — an
// expired worker could then pass the claimed_by guard and clobber the newer
// attempt's writes (Codex finding). Unique per process, stable for its life.
const CLAIM_FENCE = `${process.env.WORKER_ID ?? "worker"}#${process.pid.toString(36)}${Math.floor(performance.now() * 1000).toString(36)}`;

export async function claimCrawlCheck(sql: SQL): Promise<CrawlCheckRow | null> {
  const cutoff = new Date(Date.now() - env.leaseTimeoutMs).toISOString();
  // attempts cap lives in the claim predicate, not only in failCrawl: a crawl
  // that OOMs or wedges the process never reaches failCrawl, and without the
  // cap here the stale row would be reclaimed (attempts+1) every lease expiry
  // forever — a poison pill retried for eternity (adversarial finding 2).
  const rows = (await sql`
    update public.crawl_checks
    set state = 'running',
        claimed_at = now(),
        claimed_by = ${CLAIM_FENCE},
        attempts = attempts + 1
    where id = (
      select id from public.crawl_checks
      where (state = 'queued'
         or (state = 'running' and claimed_at < ${cutoff}::timestamptz))
        and attempts < ${MAX_CRAWL_ATTEMPTS}
      order by created_at asc
      for update skip locked
      limit 1
    )
    returning id, domain, origin, attempts
  `) as unknown as CrawlCheckRow[];

  // Poison pills: stale running rows already at the cap get terminal-failed
  // so the queue doesn't carry them as claimable-looking rows forever.
  await sql`
    update public.crawl_checks
    set state = 'failed',
        failure_reason = 'internal error: crawl attempts exhausted (worker crash or wedge)',
        finished_at = now()
    where state = 'running'
      and claimed_at < ${cutoff}::timestamptz
      and attempts >= ${MAX_CRAWL_ATTEMPTS}
  `;

  return rows[0] ?? null;
}

/** Persist phase-1 findings immediately — the report page polls for these.
 * NOTE: jsonb params are passed as raw objects — Bun SQL serializes them
 * correctly; `${JSON.stringify(x)}::jsonb` double-encodes into a jsonb
 * STRING (verified against local PG). */
// Every write below is guarded with `state = 'running' and claimed_by = us`.
// Without the guard, a worker that stalls past its lease keeps a live handle:
// after another worker reclaims (or finishes) the row, the stalled worker's
// late finish/fail would clobber the terminal snapshot — violating the
// "rows are FROZEN after a terminal state" contract. With the guard, late
// writes match zero rows and die silently, which is exactly right.

export async function writePhase1(sql: SQL, id: string, phase1: Phase1): Promise<void> {
  await sql`
    update public.crawl_checks
    set phase1_jsonb = ${phase1 as unknown as Record<string, unknown>}
    where id = ${id} and state = 'running' and claimed_by = ${CLAIM_FENCE}
  `;
}

export async function writeProgress(sql: SQL, id: string, p: CrawlProgress): Promise<void> {
  await sql`
    update public.crawl_checks
    set pages_crawled = ${p.pages_crawled},
        pages_discovered = ${p.pages_discovered}
    where id = ${id} and state = 'running' and claimed_by = ${CLAIM_FENCE}
  `;
}

export async function finishCrawl(sql: SQL, id: string, result: CrawlResult): Promise<void> {
  await sql`
    update public.crawl_checks
    set state = ${result.state}::crawl_state,
        phase1_jsonb = ${result.phase1 as unknown as Record<string, unknown>},
        findings_jsonb = ${result.findings as unknown as Record<string, unknown>[]},
        pages_crawled = ${result.pages_crawled},
        pages_discovered = ${result.pages_discovered},
        failure_reason = ${result.failure_reason},
        finished_at = now()
    where id = ${id} and state = 'running' and claimed_by = ${CLAIM_FENCE}
  `;
}

/** Terminal failure for crawls that threw unexpectedly (not a site-level
 * "failed" diagnosis — an engine error). Gives up after MAX_CRAWL_ATTEMPTS
 * by writing state='failed'; earlier attempts release the row for reclaim. */
export async function failCrawl(
  sql: SQL,
  row: CrawlCheckRow,
  message: string,
): Promise<void> {
  if (row.attempts >= MAX_CRAWL_ATTEMPTS) {
    await sql`
      update public.crawl_checks
      set state = 'failed',
          failure_reason = ${`internal error: ${message}`},
          finished_at = now()
      where id = ${row.id} and state = 'running' and claimed_by = ${CLAIM_FENCE}
    `;
  } else {
    // Back to queued for one more attempt.
    await sql`
      update public.crawl_checks
      set state = 'queued', claimed_at = null, claimed_by = null
      where id = ${row.id} and state = 'running' and claimed_by = ${CLAIM_FENCE}
    `;
  }
}
