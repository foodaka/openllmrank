// Job queue claim logic. Postgres-as-queue with lease semantics:
//
//                              ┌───────────────────────────────────────┐
//                              │  jobs table                            │
//                              │  status:                               │
//                              │    pending  (wizard inserted)          │
//                              │    paid     (webhook flipped)          │
//                              │    running  (claimed; claimed_at set)  │
//                              │    completed                            │
//                              │    failed                               │
//                              └───────────────────────────────────────┘
//                                       │
//        claimJob()  ───────────────────┤   atomic SELECT...FOR UPDATE SKIP LOCKED
//        looks for:                     │   on rows where status='paid'
//                                       │   OR (status='running' AND claimed_at < now - 30m)
//                                       │
//                                       │   then UPDATE status='running',
//                                       │   claimed_at=now(), attempts+=1
//                                       │
//                                       ▼
//                              one Job row OR null

import type { SQL } from "bun";
import { env } from "./env";
import type { HostedConfig } from "@openllmrank/shared/config";

export type JobStatus =
  | "pending"
  | "paid"
  | "running"
  | "completed"
  | "failed";

export type EmailStatus = "not_yet" | "pending" | "sent" | "failed";
export type RefundStatus = "not_required" | "pending" | "completed" | "failed";

export type Job = {
  id: string;
  user_id: string;
  brand_id: string;
  status: JobStatus;
  email_status: EmailStatus;
  refund_status: RefundStatus;
  config_jsonb: HostedConfig;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  amount_cents: number;
  currency: string;
  email_to: string;
  attempts: number;
};

/**
 * Atomically claim ONE eligible job (either a fresh paid job or a stale
 * `running` job whose lease has expired). Returns null if no eligible
 * jobs. Uses FOR UPDATE SKIP LOCKED so multiple workers don't double-claim.
 */
export async function claimJob(sql: SQL): Promise<Job | null> {
  const leaseCutoffMs = env.leaseTimeoutMs;
  // We can't parameterize the INTERVAL directly with milliseconds, so we
  // pass an ISO timestamp instead.
  const cutoff = new Date(Date.now() - leaseCutoffMs).toISOString();

  const rows = (await sql`
    update public.jobs
    set status = 'running',
        claimed_at = now(),
        claimed_by = ${env.workerId},
        attempts = attempts + 1
    where id = (
      select id from public.jobs
      where status = 'paid'
         or (status = 'running' and claimed_at < ${cutoff}::timestamptz)
      order by created_at asc
      for update skip locked
      limit 1
    )
    returning id, user_id, brand_id, status, email_status, refund_status,
              config_jsonb, stripe_checkout_session_id, stripe_payment_intent_id,
              amount_cents, currency, email_to, attempts
  `) as unknown as Job[];

  return rows[0] ?? null;
}

/**
 * Mark a job completed. Caller should have already written runs/calls/
 * citations via result-writer. After this call, email-retry cron picks up
 * the row to send the report email.
 */
export async function markCompleted(
  sql: SQL,
  jobId: string,
  args: {
    cli_run_id: string;
    succeeded: number;
    failed: number;
    cost_usd_total: number;
  },
): Promise<void> {
  await sql`
    update public.jobs
    set status = 'completed',
        succeeded_at = now(),
        cli_run_id = ${args.cli_run_id},
        succeeded_count = ${args.succeeded},
        failed_count = ${args.failed},
        cost_usd_total = ${args.cost_usd_total},
        email_status = 'pending'
    where id = ${jobId}
  `;
}

/**
 * Mark a job failed terminally. Sets email_status='not_yet' (no report to
 * send) and refund_status='pending' so the refunder cron picks it up.
 */
export async function markFailed(
  sql: SQL,
  jobId: string,
  args: {
    error_code: string;
    error_message: string;
  },
): Promise<void> {
  await sql`
    update public.jobs
    set status = 'failed',
        failed_at = now(),
        error_code = ${args.error_code},
        error_message = ${args.error_message},
        refund_status = 'pending'
    where id = ${jobId}
  `;
}
