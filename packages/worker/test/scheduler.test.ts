// Integration tests for the scheduler tick against local Supabase.
// Skips cleanly when localhost:54332 is unreachable.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { scheduleDueRuns, scheduleRetryAfterFailure } from "../src/scheduler";

const PG_HOST = process.env.SUPABASE_TEST_HOST ?? "127.0.0.1";
const PG_PORT = process.env.SUPABASE_TEST_PORT ?? "54332";
const PG_URL = `postgresql://postgres:postgres@${PG_HOST}:${PG_PORT}/postgres`;

async function pgReachable(url: string): Promise<boolean> {
  try {
    const probe = new SQL(url);
    await probe`select 1 from public.subscriptions limit 1`;
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const reachable = await pgReachable(PG_URL);
const describePg = reachable ? describe : describe.skip;
if (!reachable) {
  console.warn(`[scheduler.test] Skipping: cannot reach ${PG_URL} (needs migration 0006).`);
}

let sql: SQL;
const EMAIL = "scheduler-test@example.com";
let userId = "";

const config = {
  brand: { name: "SchedCo", aliases: [] },
  competitors: [{ name: "RivalCo", aliases: [] }],
  prompts: ["best scheduling tool for tests"],
  providers: [{ id: "openai", model: "gpt-4o-mini" }],
  samples_per_prompt: 3,
  concurrency_per_provider: 4,
};

async function insertBrand(args: {
  name: string;
  cadence?: "weekly" | "monthly" | "paused";
  nextRunAt?: string | null;
  archived?: boolean;
  config?: unknown;
}): Promise<string> {
  const rows = (await sql`
    insert into public.brands (user_id, name, cadence, next_run_at, archived_at, config_jsonb)
    values (${userId}, ${args.name}, ${args.cadence ?? "weekly"}::run_cadence,
            ${args.nextRunAt === undefined ? new Date(Date.now() - 60_000).toISOString() : args.nextRunAt},
            ${args.archived ? new Date().toISOString() : null},
            ${args.config === undefined ? config : args.config})
    returning id
  `) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

async function insertSubscription(status: string): Promise<string> {
  const rows = (await sql`
    insert into public.subscriptions (user_id, stripe_subscription_id, stripe_customer_id, status)
    values (${userId}, ${"sub_sched_" + crypto.randomUUID()}, 'cus_sched', ${status}::subscription_status)
    returning id
  `) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

async function jobsFor(brandId: string) {
  return (await sql`
    select id, origin, status, amount_cents, email_to, subscription_id
    from public.jobs where brand_id = ${brandId}
  `) as unknown as Array<{
    id: string; origin: string; status: string; amount_cents: number; email_to: string; subscription_id: string | null;
  }>;
}

async function brand(brandId: string) {
  const rows = (await sql`
    select cadence, next_run_at, last_run_at from public.brands where id = ${brandId}
  `) as unknown as Array<{ cadence: string; next_run_at: string | null; last_run_at: string | null }>;
  return rows[0]!;
}

beforeAll(() => {
  if (reachable) sql = new SQL(PG_URL);
});
afterAll(async () => {
  if (reachable) await sql.end();
});
beforeEach(async () => {
  if (!reachable) return;
  await sql`delete from auth.users where email = ${EMAIL}`;
  const u = (await sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            ${EMAIL}, '$2a$10$fake', now(), now(), now(), '', '', '', '', '', '', '', '')
    returning id
  `) as unknown as Array<{ id: string }>;
  userId = u[0]!.id;
});

describePg("scheduleDueRuns", () => {
  test("a due brand with an active subscription gets one scheduled job and moves forward a week", async () => {
    const subId = await insertSubscription("active");
    const brandId = await insertBrand({ name: "SchedCo" });
    const now = new Date();

    const tick = await scheduleDueRuns(sql, { weeklyMaxBrands: 2, now });
    expect(tick.scheduled.map((s) => s.brand_id)).toContain(brandId);
    expect(tick.skipped).toHaveLength(0);

    const jobs = await jobsFor(brandId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.origin).toBe("scheduled");
    expect(jobs[0]!.status).toBe("paid");
    expect(jobs[0]!.amount_cents).toBe(0);
    expect(jobs[0]!.email_to).toBe(EMAIL);
    expect(jobs[0]!.subscription_id).toBe(subId);

    const b = await brand(brandId);
    expect(b.cadence).toBe("weekly");
    const next = new Date(b.next_run_at!).getTime();
    expect(Math.abs(next - (now.getTime() + 7 * 24 * 3600 * 1000))).toBeLessThan(5000);
    expect(b.last_run_at).not.toBeNull();

    // Second tick at the same instant: nothing is due any more.
    const again = await scheduleDueRuns(sql, { weeklyMaxBrands: 2, now });
    expect(again.scheduled.map((s) => s.brand_id)).not.toContain(brandId);
    expect(await jobsFor(brandId)).toHaveLength(1);
  });

  test("no active subscription means no job, even with cadence weekly and next_run_at passed", async () => {
    await insertSubscription("canceled");
    const brandId = await insertBrand({ name: "SchedCo" });
    const tick = await scheduleDueRuns(sql, { weeklyMaxBrands: 2 });
    expect(tick.scheduled.map((s) => s.brand_id)).not.toContain(brandId);
    expect(await jobsFor(brandId)).toHaveLength(0);
  });

  test("paused, archived, and not-yet-due brands are left alone", async () => {
    await insertSubscription("active");
    const paused = await insertBrand({ name: "Paused", cadence: "paused" });
    const archived = await insertBrand({ name: "Archived", archived: true });
    const future = await insertBrand({
      name: "Future",
      nextRunAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const tick = await scheduleDueRuns(sql, { weeklyMaxBrands: 2 });
    const ids = tick.scheduled.map((s) => s.brand_id);
    expect(ids).not.toContain(paused);
    expect(ids).not.toContain(archived);
    expect(ids).not.toContain(future);
  });

  test("a brand with a job already paid or running is not scheduled twice", async () => {
    await insertSubscription("active");
    const brandId = await insertBrand({ name: "SchedCo" });
    await sql`
      insert into public.jobs (user_id, brand_id, status, origin, config_jsonb, amount_cents, email_to)
      values (${userId}, ${brandId}, 'running', 'manual', ${config}, 0, ${EMAIL})
    `;
    const tick = await scheduleDueRuns(sql, { weeklyMaxBrands: 2 });
    expect(tick.scheduled.map((s) => s.brand_id)).not.toContain(brandId);
    expect(await jobsFor(brandId)).toHaveLength(1);
  });

  test("more active brands than the weekly max drops the account to monthly (D12)", async () => {
    await insertSubscription("active");
    const a = await insertBrand({ name: "A" });
    const b = await insertBrand({ name: "B" });
    const c = await insertBrand({ name: "C" });
    const now = new Date();
    const tick = await scheduleDueRuns(sql, { weeklyMaxBrands: 2, now });
    expect(tick.scheduled).toHaveLength(3);
    for (const id of [a, b, c]) {
      const row = await brand(id);
      expect(row.cadence).toBe("monthly");
      const next = new Date(row.next_run_at!).getTime();
      expect(next - now.getTime()).toBeGreaterThan(27 * 24 * 3600 * 1000);
    }
  });

  test("invalid config is skipped, pushed a day out, and reported", async () => {
    await insertSubscription("active");
    const brandId = await insertBrand({ name: "Broken", config: null });
    const now = new Date();
    const tick = await scheduleDueRuns(sql, { weeklyMaxBrands: 2, now });
    expect(tick.scheduled.map((s) => s.brand_id)).not.toContain(brandId);
    expect(tick.skipped.map((s) => s.brand_id)).toContain(brandId);
    expect(await jobsFor(brandId)).toHaveLength(0);
    const row = await brand(brandId);
    const next = new Date(row.next_run_at!).getTime();
    expect(Math.abs(next - (now.getTime() + 24 * 3600 * 1000))).toBeLessThan(5000);
  });
});

describePg("scheduleRetryAfterFailure", () => {
  async function failedJob(brandId: string, origin = "scheduled"): Promise<string> {
    const rows = (await sql`
      insert into public.jobs (user_id, brand_id, status, origin, config_jsonb, amount_cents, email_to, failed_at, error_code)
      values (${userId}, ${brandId}, 'failed', ${origin}::job_origin, ${config}, 0, ${EMAIL}, now(), 'PROVIDER_AUTH')
      returning id
    `) as unknown as Array<{ id: string }>;
    return rows[0]!.id;
  }

  test("a failed scheduled run is retried within the hour instead of next week", async () => {
    await insertSubscription("active");
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const brandId = await insertBrand({ name: "Retry", nextRunAt: nextWeek });
    const jobId = await failedJob(brandId);
    const now = new Date();
    const { retryAt } = await scheduleRetryAfterFailure(sql, { id: jobId, brand_id: brandId, origin: "scheduled" }, now);
    expect(retryAt).not.toBeNull();
    const row = await brand(brandId);
    expect(Math.abs(new Date(row.next_run_at!).getTime() - (now.getTime() + 3600_000))).toBeLessThan(5000);
  });

  test("stops retrying after two failures in a day, and never touches one-shot jobs or paused brands", async () => {
    await insertSubscription("active");
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const brandId = await insertBrand({ name: "Flaky", nextRunAt: nextWeek });
    await failedJob(brandId);
    await failedJob(brandId);
    const third = await failedJob(brandId);
    expect((await scheduleRetryAfterFailure(sql, { id: third, brand_id: brandId, origin: "scheduled" })).retryAt).toBeNull();
    expect(new Date((await brand(brandId)).next_run_at!).getTime()).toBe(new Date(nextWeek).getTime());

    const oneShot = await insertBrand({ name: "OneShot", nextRunAt: nextWeek });
    const osJob = await failedJob(oneShot, "one_shot");
    expect((await scheduleRetryAfterFailure(sql, { id: osJob, brand_id: oneShot, origin: "one_shot" })).retryAt).toBeNull();

    const paused = await insertBrand({ name: "Paused", cadence: "paused", nextRunAt: null });
    const pJob = await failedJob(paused);
    await scheduleRetryAfterFailure(sql, { id: pJob, brand_id: paused, origin: "manual" });
    expect((await brand(paused)).next_run_at).toBeNull();
  });
});
