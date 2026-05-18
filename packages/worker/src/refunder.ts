// Refund outbox loop. Runs in the background alongside the job-claim loop.
// Polls for jobs.refund_status='pending' and tries to issue refunds.
//
// Lifecycle:
//   1. A job terminally fails (markFailed in queue.ts) → refund_status='pending'
//   2. This loop picks up the row, calls Stripe refund API
//   3. On success: refund_status='completed', send refund-notice email
//   4. On error: increment refund_attempts, leave status='pending', try again
//      next tick. After 6 attempts (~1 hour at 10-min ticks) alert admin.

import type { SQL } from "bun";
import { db } from "./db";
import { refundPaymentIntent } from "./stripe-refund";
import { sendRefundNotice } from "./emailer";
import { alert } from "./alerts";

const REFUND_POLL_INTERVAL_MS = 60_000; // 1 min in local dev; 10 min in prod is also fine
const REFUND_MAX_ATTEMPTS = 6;

type PendingRefundRow = {
  id: string;
  user_id: string;
  brand_id: string;
  email_to: string;
  amount_cents: number;
  currency: string;
  error_message: string | null;
  stripe_payment_intent_id: string | null;
  refund_attempts: number;
  brand_name: string;
};

async function fetchPendingRefunds(sql: SQL): Promise<PendingRefundRow[]> {
  return (await sql`
    select j.id, j.user_id, j.brand_id, j.email_to, j.amount_cents, j.currency,
           j.error_message, j.stripe_payment_intent_id, j.refund_attempts,
           b.name as brand_name
    from public.jobs j
    join public.brands b on b.id = j.brand_id
    where j.refund_status = 'pending'
      and j.refund_attempts < ${REFUND_MAX_ATTEMPTS}
    order by j.failed_at asc
    limit 10
  `) as unknown as PendingRefundRow[];
}

async function processOneRefund(sql: SQL, row: PendingRefundRow): Promise<void> {
  // Increment attempt counter up front so a crash mid-refund doesn't lose
  // the increment.
  await sql`
    update public.jobs
    set refund_attempts = refund_attempts + 1
    where id = ${row.id}
  `;

  if (!row.stripe_payment_intent_id) {
    // No payment_intent on file (e.g., the local_stub path didn't set one
    // via webhook). Skip the refund call; mark completed.
    await sql`
      update public.jobs
      set refund_status = 'completed', refund_last_error = null
      where id = ${row.id}
    `;
    return;
  }

  const result = await refundPaymentIntent(row.stripe_payment_intent_id);

  if (result.ok) {
    await sql`
      update public.jobs
      set refund_status = 'completed', refund_last_error = null
      where id = ${row.id}
    `;
    // Best-effort: send the refund email. If Postmark stub-writes, that's fine.
    const emailResult = await sendRefundNotice({
      jobId: row.id,
      to: row.email_to,
      brand_name: row.brand_name,
      amount_cents: row.amount_cents,
      currency: row.currency,
      error_message: row.error_message ?? "(unknown error)",
    });
    if (!emailResult.ok) {
      await alert("warn", "refund email failed to send", {
        job_id: row.id,
        code: emailResult.code,
        message: emailResult.message,
      });
    }
    return;
  }

  // Stripe API error. Store the error message for debugging, leave status
  // as pending so we try again next tick.
  await sql`
    update public.jobs
    set refund_last_error = ${result.message}
    where id = ${row.id}
  `;

  if (row.refund_attempts + 1 >= REFUND_MAX_ATTEMPTS) {
    await sql`
      update public.jobs
      set refund_status = 'failed'
      where id = ${row.id}
    `;
    await alert("error", "refund attempts exhausted — manual intervention required", {
      job_id: row.id,
      user_id: row.user_id,
      payment_intent: row.stripe_payment_intent_id,
      last_error: result.message,
    });
  }
}

export function startRefunderLoop(): { stop: () => void } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const sql = db();
      const rows = await fetchPendingRefunds(sql);
      for (const row of rows) {
        if (stopped) return;
        await processOneRefund(sql, row);
      }
    } catch (e) {
      await alert("error", "refunder loop tick failed", {
        message: (e as Error).message,
      });
    }
    if (!stopped) {
      timer = setTimeout(tick, REFUND_POLL_INTERVAL_MS);
    }
  }

  // Stagger start so we don't pile up at boot
  timer = setTimeout(tick, 5_000);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
