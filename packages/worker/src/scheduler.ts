// Scheduler loop (E7). Turns per-brand tracking config into paid jobs.
//
//   brands.next_run_at <= now()                ┐
//   brands.cadence <> 'paused'                 │  one transaction,
//   brands.archived_at is null                 ├─ FOR UPDATE SKIP LOCKED,
//   owner has subscriptions.status = 'active'  │  so two workers never
//   no job for the brand in paid/running       ┘  schedule the same brand
//         │
//         ▼
//   insert jobs (origin='scheduled', amount_cents=0, config from the brand)
//   recompute the owner's cadence (D12) and push next_run_at forward
//
// The subscription join is the load-bearing check. brands.cadence is
// customer-visible state that a signed-in user could in principle write;
// only a live subscription row (written by the Stripe webhook with the
// service role) entitles an account to scheduled runs.

import type { SQL } from "bun";
import { HostedConfigSchema } from "@openllmrank/shared/config";
import { effectiveCadence, nextRunAfter } from "@openllmrank/shared/cadence";
import { env } from "./env";
import { db } from "./db";
import { alert } from "./alerts";

type DueBrandRow = {
  id: string;
  user_id: string;
  name: string;
  config_jsonb: unknown;
  subscription_id: string;
  email: string | null;
};

export type ScheduleResult = {
  scheduled: { brand_id: string; job_id: string; cadence: "weekly" | "monthly" }[];
  skipped: { brand_id: string; reason: string }[];
};

export type ScheduleOptions = {
  /** Brands above this count drop the account from weekly to monthly (D12). */
  weeklyMaxBrands: number;
  /** Injectable clock for tests. */
  now?: Date;
  /** Max brands to schedule per tick. */
  limit?: number;
};

function parseConfig(value: unknown) {
  if (typeof value === "string") {
    try {
      return HostedConfigSchema.safeParse(JSON.parse(value));
    } catch {
      return HostedConfigSchema.safeParse(value);
    }
  }
  return HostedConfigSchema.safeParse(value);
}

/**
 * One scheduler tick. Pure with respect to process state: everything it
 * needs comes from `sql` and `opts`, so tests can drive it directly.
 */
export async function scheduleDueRuns(
  sql: SQL,
  opts: ScheduleOptions,
): Promise<ScheduleResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const limit = opts.limit ?? 25;
  const result: ScheduleResult = { scheduled: [], skipped: [] };

  await sql.begin(async (tx) => {
    const due = (await tx`
      select b.id, b.user_id, b.name, b.config_jsonb, s.id as subscription_id, u.email
      from public.brands b
      join public.subscriptions s
        on s.user_id = b.user_id and s.status = 'active'
      join auth.users u on u.id = b.user_id
      where b.next_run_at is not null
        and b.next_run_at <= ${nowIso}::timestamptz
        and b.cadence <> 'paused'
        and b.archived_at is null
        and not exists (
          select 1 from public.jobs j
          where j.brand_id = b.id and j.status in ('paid', 'running')
        )
      order by b.next_run_at asc
      for update of b skip locked
      limit ${limit}
    `) as unknown as DueBrandRow[];

    for (const brand of due) {
      const parsed = parseConfig(brand.config_jsonb);
      if (!parsed.success || !brand.email) {
        // Never spin on a broken brand: push it a day out and surface it.
        const retryAt = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
        await tx`
          update public.brands set next_run_at = ${retryAt}::timestamptz where id = ${brand.id}
        `;
        result.skipped.push({
          brand_id: brand.id,
          reason: !brand.email
            ? "owner has no email address"
            : `invalid config_jsonb: ${parsed.success ? "" : parsed.error.issues[0]?.message ?? "unknown"}`,
        });
        continue;
      }

      const counted = (await tx`
        select count(*)::int as n from public.brands
        where user_id = ${brand.user_id} and archived_at is null
      `) as unknown as Array<{ n: number }>;
      const cadence = effectiveCadence(counted[0]?.n ?? 1, opts.weeklyMaxBrands);

      const inserted = (await tx`
        insert into public.jobs
          (user_id, brand_id, status, origin, subscription_id, config_jsonb,
           amount_cents, currency, email_to)
        values
          (${brand.user_id}, ${brand.id}, 'paid', 'scheduled', ${brand.subscription_id},
           ${parsed.data}, 0, 'usd', ${brand.email})
        returning id
      `) as unknown as Array<{ id: string }>;
      const jobId = inserted[0]!.id;

      // D12 applies to the whole account, so every active brand carries the
      // same cadence and the dashboard copy stays truthful.
      await tx`
        update public.brands set cadence = ${cadence}::run_cadence
        where user_id = ${brand.user_id} and archived_at is null and cadence <> 'paused'
      `;
      await tx`
        update public.brands
        set next_run_at = ${nextRunAfter(now, cadence).toISOString()}::timestamptz,
            last_run_at = ${nowIso}::timestamptz
        where id = ${brand.id}
      `;

      result.scheduled.push({ brand_id: brand.id, job_id: jobId, cadence });
    }
  });

  return result;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type SchedulerLoopHandle = { stop: () => Promise<void> };

export function startSchedulerLoop(): SchedulerLoopHandle {
  let stopped = false;

  const loopDone = (async () => {
    while (!stopped) {
      try {
        const tick = await scheduleDueRuns(db(), {
          weeklyMaxBrands: env.schedulerWeeklyMaxBrands,
        });
        for (const s of tick.scheduled) {
          console.log(
            `[scheduler] queued job=${s.job_id} brand=${s.brand_id} cadence=${s.cadence}`,
          );
        }
        for (const s of tick.skipped) {
          await alert("warn", "scheduler skipped a due brand", {
            brand_id: s.brand_id,
            reason: s.reason,
          });
        }
      } catch (e) {
        await alert("error", "scheduler tick failed", {
          message: (e as Error).message,
        });
      }
      await sleep(env.schedulerPollMs);
    }
  })();

  return {
    stop: async () => {
      stopped = true;
      await loopDone;
    },
  };
}

/**
 * A scheduled or manual run that failed on our side (provider outage, quota,
 * result-writer) should not leave the customer waiting a week. Pull the
 * brand's next run forward to an hour from now, at most twice in 24 hours so
 * a persistent failure cannot burn money hourly. One-shot jobs are refunded
 * instead and never come through here.
 */
export async function scheduleRetryAfterFailure(
  sql: SQL,
  job: { id: string; brand_id: string; origin: string },
  now: Date = new Date(),
): Promise<{ retryAt: string | null }> {
  if (job.origin === "one_shot") return { retryAt: null };
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const failures = (await sql`
    select count(*)::int as n from public.jobs
    where brand_id = ${job.brand_id}
      and status = 'failed'
      and origin <> 'one_shot'
      and failed_at >= ${dayAgo}::timestamptz
      and id <> ${job.id}
  `) as unknown as Array<{ n: number }>;
  if ((failures[0]?.n ?? 0) >= 2) return { retryAt: null };

  const retryAt = new Date(now.getTime() + 3600 * 1000).toISOString();
  await sql`
    update public.brands
    set next_run_at = least(coalesce(next_run_at, ${retryAt}::timestamptz), ${retryAt}::timestamptz)
    where id = ${job.brand_id}
      and archived_at is null
      and cadence <> 'paused'
  `;
  return { retryAt };
}
