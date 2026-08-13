-- Login + dashboard epic, part 1 of 2. See SPEC-DASHBOARD.md.
--
-- Turns the one-shot report product into a tracked one. Four changes:
--
--   1. subscriptions  — one Stripe subscription per user ($29/mo flat, D8)
--   2. brands.*       — per-brand tracking config so the scheduler can create
--                       jobs without a wizard
--   3. jobs.origin    — where a run came from; drives billing, refunds, quota
--   4. run_metrics    — precomputed per-run summary powering the trend chart
--
-- Cadence throttle (D12): break-even is 2 brands at $29/mo, so past a
-- configurable brand count the scheduler drops weekly to monthly rather
-- than capping brands. Enforced in the worker, not in SQL.
--
-- Every change here is additive. No column dropped, no type narrowed.

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------
create type subscription_status as enum (
  'incomplete',  -- checkout started, first invoice unpaid
  'active',
  'past_due',    -- payment failed; scheduler pauses, dashboard stays readable
  'canceled'     -- terminal; scheduler stops, history stays readable
);

create table public.subscriptions (
  id                      uuid                primary key default gen_random_uuid(),
  user_id                 uuid                not null references auth.users(id) on delete cascade,
  stripe_subscription_id  text                unique not null,
  stripe_customer_id      text                not null,
  status                  subscription_status not null default 'incomplete',
  current_period_end      timestamptz,
  cancel_at_period_end    boolean             not null default false,
  created_at              timestamptz         not null default now(),
  updated_at              timestamptz         not null default now()
);

-- At most one live subscription per user. Stops double billing when a
-- customer opens Stripe Checkout twice in two tabs.
create unique index subscriptions_one_live_per_user
  on public.subscriptions(user_id)
  where status in ('incomplete', 'active', 'past_due');

create index subscriptions_status_idx on public.subscriptions(status);

alter table public.subscriptions enable row level security;

create policy subscriptions_select_own
  on public.subscriptions for select
  using (auth.uid() = user_id);
-- No insert/update/delete policies on purpose: only the Stripe webhook
-- (service_role) mutates subscriptions. Stripe is the source of truth; the
-- dashboard only reads.

create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- brands: gains its own tracking config. Until now, config lived only on
-- jobs, which meant a run could not exist without a wizard submission.
-- ---------------------------------------------------------------------------
create type run_cadence as enum ('weekly', 'monthly', 'paused');

alter table public.brands
  add column website      text,
  add column category     text,
  add column config_jsonb jsonb,        -- HostedConfig; null for pre-epic brands
  add column cadence      run_cadence not null default 'paused',
  add column next_run_at  timestamptz,
  add column last_run_at  timestamptz,
  add column archived_at  timestamptz;

-- The scheduler's hot path. Partial index stays small as archived brands grow.
create index brands_due_idx
  on public.brands(next_run_at)
  where cadence <> 'paused' and archived_at is null;

-- ---------------------------------------------------------------------------
-- jobs: a run needs to say where it came from.
--
--   one_shot   $29.99 wizard purchase; has a payment_intent; refundable
--   scheduled  created by the worker scheduler under a subscription
--   manual     customer clicked Re-run; counts against the monthly quota
--
-- This distinction is load-bearing for the refund path: markFailed() must
-- NOT queue a Stripe refund for a scheduled run, which has no payment
-- intent of its own. See SPEC-DASHBOARD.md E8.
-- ---------------------------------------------------------------------------
create type job_origin as enum ('one_shot', 'scheduled', 'manual');

alter table public.jobs
  add column origin          job_origin not null default 'one_shot',
  add column subscription_id uuid references public.subscriptions(id) on delete set null;

-- Scheduled and manual runs are not charged individually.
alter table public.jobs alter column amount_cents set default 0;

create index jobs_origin_user_created_idx
  on public.jobs(user_id, origin, created_at desc);

-- ---------------------------------------------------------------------------
-- run_metrics: one precomputed summary row per run.
--
-- Without this, every dashboard page load re-derives citation rates from
-- calls + citations the way reports/[id]/route.ts does today. That is fine
-- for rendering one report on demand. It is not fine for a trend chart
-- spanning 52 weekly runs, which would mean 52 full recomputations per view.
--
-- Written by the worker's result-writer immediately after a run lands.
-- ---------------------------------------------------------------------------
create table public.run_metrics (
  run_id                uuid          primary key references public.runs(id) on delete cascade,
  user_id               uuid          not null references auth.users(id) on delete cascade,
  brand_id              uuid          not null references public.brands(id) on delete cascade,
  job_id                uuid          not null references public.jobs(id) on delete cascade,
  computed_at           timestamptz   not null default now(),
  own_citation_rate     numeric(6,5)  not null,  -- 0..1 across all prompt x provider
  share_of_voice        numeric(6,5)  not null,  -- own / (own + all competitors)
  samples_total         integer       not null,
  per_provider_jsonb    jsonb         not null default '{}',  -- {"openai":0.40,...}
  per_competitor_jsonb  jsonb         not null default '[]',  -- [{"name":..,"rate":..}]
  top_gap_prompt        text,
  top_gap_score         numeric(6,5)
);

create index run_metrics_brand_computed_idx
  on public.run_metrics(brand_id, computed_at desc);

alter table public.run_metrics enable row level security;

create policy run_metrics_select_own
  on public.run_metrics for select
  using (auth.uid() = user_id);
