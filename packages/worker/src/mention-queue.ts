// Claim/update logic for free mention checks. Own table and claim path,
// like crawl_checks, so a free check can never delay a paid job.
//
//   queued ──claim──► running ──finish──► complete | failed
//                        │
//                        └─ lease expiry (claimed_at stale) → reclaimed
//
// Rows are FROZEN after a terminal state. Cached answers live in
// mention_answers and are shared across checks of the same question.

import type { SQL } from "bun";
import type { GroundedSource } from "openllmrank/src/core/types";
import type { ProviderConfig } from "@openllmrank/shared/config";
import { MENTION_ANSWER_TTL_MS, type MentionResults } from "@openllmrank/shared/mention-check";
import { env } from "./env";

export type MentionCheckRow = {
  id: string;
  brand_name: string;
  domain: string;
  question: string;
  providers_jsonb: ProviderConfig[];
  attempts: number;
};

export type CachedAnswer = {
  response_text: string;
  search_results: GroundedSource[];
};

const MAX_MENTION_ATTEMPTS = 2;

// Fencing token for lease-guarded writes (see crawl-queue.ts for why a
// static WORKER_ID is not enough).
const CLAIM_FENCE = `${process.env.WORKER_ID ?? "worker"}#m${process.pid.toString(36)}${Math.floor(performance.now() * 1000).toString(36)}`;

export async function claimMentionCheck(sql: SQL): Promise<MentionCheckRow | null> {
  const cutoff = new Date(Date.now() - env.leaseTimeoutMs).toISOString();
  const rows = (await sql`
    update public.mention_checks
    set state = 'running',
        claimed_at = now(),
        claimed_by = ${CLAIM_FENCE},
        attempts = attempts + 1
    where id = (
      select id from public.mention_checks
      where (state = 'queued'
         or (state = 'running' and claimed_at < ${cutoff}::timestamptz))
        and attempts < ${MAX_MENTION_ATTEMPTS}
      order by created_at asc
      for update skip locked
      limit 1
    )
    returning id, brand_name, domain, question, providers_jsonb, attempts
  `) as unknown as MentionCheckRow[];

  // Poison pills: stale running rows at the attempt cap are failed for good.
  await sql`
    update public.mention_checks
    set state = 'failed',
        failure_reason = 'internal error: attempts exhausted (worker crash or wedge)',
        finished_at = now()
    where state = 'running'
      and claimed_at < ${cutoff}::timestamptz
      and attempts >= ${MAX_MENTION_ATTEMPTS}
  `;

  return rows[0] ?? null;
}

export async function findCachedAnswer(
  sql: SQL,
  provider: string,
  model: string,
  hash: string,
): Promise<CachedAnswer | null> {
  const since = new Date(Date.now() - MENTION_ANSWER_TTL_MS).toISOString();
  const rows = (await sql`
    select response_text, search_results_jsonb
    from public.mention_answers
    where provider = ${provider} and model = ${model} and question_hash = ${hash}
      and created_at > ${since}::timestamptz
    order by created_at desc
    limit 1
  `) as unknown as { response_text: string; search_results_jsonb: GroundedSource[] }[];
  const row = rows[0];
  return row ? { response_text: row.response_text, search_results: row.search_results_jsonb } : null;
}

export async function saveAnswer(
  sql: SQL,
  args: {
    provider: string;
    model: string;
    hash: string;
    question: string;
    response_text: string;
    search_results: GroundedSource[];
    cost_usd: number;
  },
): Promise<void> {
  // jsonb params go in as raw objects: Bun SQL serializes them; stringifying
  // double-encodes into a jsonb string (see crawl-queue.ts).
  await sql`
    insert into public.mention_answers
      (provider, model, question_hash, question, response_text, search_results_jsonb, cost_usd)
    values
      (${args.provider}, ${args.model}, ${args.hash}, ${args.question}, ${args.response_text},
       ${args.search_results as unknown as Record<string, unknown>[]}, ${args.cost_usd})
  `;
}

export async function finishMentionCheck(
  sql: SQL,
  id: string,
  results: MentionResults,
  costUsd: number,
): Promise<void> {
  await sql`
    update public.mention_checks
    set state = 'complete',
        results_jsonb = ${results as unknown as Record<string, unknown>},
        cost_usd = cost_usd + ${costUsd},
        finished_at = now()
    where id = ${id} and state = 'running' and claimed_by = ${CLAIM_FENCE}
  `;
}

/** Terminal failure when no assistant answered (reason is shown to the
 * visitor), or a retry release on an unexpected error before the cap. */
export async function failMentionCheck(
  sql: SQL,
  row: MentionCheckRow,
  reason: string,
  costUsd: number,
  opts: { retry: boolean },
): Promise<void> {
  if (opts.retry && row.attempts < MAX_MENTION_ATTEMPTS) {
    await sql`
      update public.mention_checks
      set state = 'queued', claimed_at = null, claimed_by = null,
          cost_usd = cost_usd + ${costUsd}
      where id = ${row.id} and state = 'running' and claimed_by = ${CLAIM_FENCE}
    `;
    return;
  }
  await sql`
    update public.mention_checks
    set state = 'failed',
        failure_reason = ${reason},
        cost_usd = cost_usd + ${costUsd},
        finished_at = now()
    where id = ${row.id} and state = 'running' and claimed_by = ${CLAIM_FENCE}
  `;
}
