-- openllmrank hosted webapp schema. Mirrors the CLI's SQLite schema
-- (see packages/cli/src/core/db.ts) and adds the columns + tables a
-- multi-tenant SaaS layer needs: user_id ownership, brand grouping,
-- a paid-job queue with leases, idempotent Stripe events, and outbox
-- patterns for refund + email side-effects.
--
-- State machine for jobs:
--
--     pending (wizard inserted, awaiting Stripe webhook)
--        │ webhook: checkout.session.completed
--        ▼
--      paid (worker can claim)
--        │ worker: SELECT FOR UPDATE SKIP LOCKED
--        ▼
--    running (claimed_at set; lease expires in 30 min)
--        │ worker spawns CLI subprocess
--        ├──→ completed (email queued, all done)
--        └──→ failed    (terminal: queue refund + alert)
--
-- RLS strategy: every table owned by a tenant carries user_id (auth.users
-- FK). Policies enforce `auth.uid() = user_id` for SELECT/INSERT/UPDATE.
-- The service_role bypasses RLS (used by the worker only, never the web
-- layer except for Stripe webhook handler, which receives the user_id from
-- the Stripe metadata it set when creating the checkout session).

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- brands
-- ---------------------------------------------------------------------------
create table public.brands (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  aliases     text[]      not null default '{}',
  created_at  timestamptz not null default now(),
  constraint brands_name_not_empty check (char_length(name) > 0)
);

create index brands_user_id_idx on public.brands(user_id);

alter table public.brands enable row level security;

create policy brands_select_own
  on public.brands for select
  using (auth.uid() = user_id);

create policy brands_insert_own
  on public.brands for insert
  with check (auth.uid() = user_id);

create policy brands_update_own
  on public.brands for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy brands_delete_own
  on public.brands for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- jobs (the queue + the source of truth for a customer's paid request)
-- ---------------------------------------------------------------------------
create type job_status as enum (
  'pending',     -- wizard inserted, awaiting Stripe webhook
  'paid',        -- webhook fired, worker can claim
  'running',     -- worker claimed (lease)
  'completed',   -- run finished, email queued
  'failed'       -- terminal error, refund queued
);

create type email_status as enum (
  'not_yet',     -- run hasn't completed
  'pending',     -- run done, email send in outbox
  'sent',
  'failed'
);

create type refund_status as enum (
  'not_required',  -- job completed normally
  'pending',       -- terminal failure, refund needs to be issued
  'completed',
  'failed'
);

create table public.jobs (
  id                          uuid          primary key default gen_random_uuid(),
  user_id                     uuid          not null references auth.users(id) on delete cascade,
  brand_id                    uuid          not null references public.brands(id) on delete cascade,
  status                      job_status    not null default 'pending',
  email_status                email_status  not null default 'not_yet',
  refund_status               refund_status not null default 'not_required',
  config_jsonb                jsonb         not null,        -- the HostedConfig the worker will pass to the CLI
  stripe_checkout_session_id  text          unique,           -- idempotency key for webhook
  stripe_payment_intent_id    text,                            -- captured from webhook for refund API calls
  amount_cents                integer       not null,
  currency                    text          not null default 'usd',
  email_to                    text          not null,         -- where the final report lands
  claimed_at                  timestamptz,                     -- lease timestamp; reclaim if older than 30 min and status=running
  claimed_by                  text,                             -- worker hostname for debug
  succeeded_at                timestamptz,
  failed_at                   timestamptz,
  error_code                  text,
  error_message               text,
  cli_run_id                  text,                             -- the run_id from CLI --output-json
  succeeded_count             integer,
  failed_count                integer,
  cost_usd_total              numeric(10,4),
  attempts                    integer       not null default 0,
  email_attempts              integer       not null default 0,
  refund_attempts             integer       not null default 0,
  email_last_error            text,
  refund_last_error           text,
  created_at                  timestamptz   not null default now(),
  updated_at                  timestamptz   not null default now()
);

create index jobs_user_id_idx                on public.jobs(user_id);
create index jobs_brand_id_idx               on public.jobs(brand_id);
create index jobs_status_paid_idx            on public.jobs(status) where status = 'paid';
create index jobs_status_running_idx         on public.jobs(status, claimed_at) where status = 'running';
create index jobs_email_pending_idx          on public.jobs(email_status) where email_status = 'pending';
create index jobs_refund_pending_idx         on public.jobs(refund_status) where refund_status = 'pending';

alter table public.jobs enable row level security;

-- Customers can read their own jobs (for "your order is being processed"
-- pages later). They cannot insert, update, or delete jobs directly — the
-- web layer uses service_role on the /api routes after validating the
-- session (and the worker uses service_role).
create policy jobs_select_own
  on public.jobs for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- runs: per-run summary written by the worker after CLI completes.
-- Mirrors CLI's `runs` table; adds user_id + brand_id + job_id.
-- ---------------------------------------------------------------------------
create table public.runs (
  id           uuid        primary key default gen_random_uuid(),
  job_id       uuid        not null references public.jobs(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  brand_id     uuid        not null references public.brands(id) on delete cascade,
  cli_run_id   text        not null,
  started_at   timestamptz not null,
  finished_at  timestamptz,
  config_hash  text        not null
);

create index runs_job_id_idx     on public.runs(job_id);
create index runs_user_id_idx    on public.runs(user_id);
create index runs_brand_id_idx   on public.runs(brand_id);

alter table public.runs enable row level security;

create policy runs_select_own
  on public.runs for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- prompts: user-scoped prompt registry. prompt_id is a SHA-256 of
-- (prompt_text, model, provider, config, user_id) so two customers asking
-- the same prompt get different rows. Closes the cross-tenant join footgun.
-- ---------------------------------------------------------------------------
create table public.prompts (
  prompt_id    text        not null,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  prompt_text  text        not null,
  model        text        not null,
  provider     text        not null,
  config_blob  text        not null,
  created_at   timestamptz not null default now(),
  primary key (prompt_id, user_id)
);

create index prompts_user_id_idx on public.prompts(user_id);

alter table public.prompts enable row level security;

create policy prompts_select_own
  on public.prompts for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- calls: one row per LLM call, written by worker after CLI completes
-- ---------------------------------------------------------------------------
create table public.calls (
  id                  uuid        primary key default gen_random_uuid(),
  run_id              uuid        not null references public.runs(id) on delete cascade,
  user_id             uuid        not null references auth.users(id) on delete cascade,
  brand_id            uuid        not null references public.brands(id) on delete cascade,
  prompt_id           text        not null,
  sample_index        integer     not null,
  ts                  timestamptz not null,
  response_text       text        not null default '',
  search_results_json jsonb       not null default '[]',
  latency_ms          integer     not null default 0,
  tokens_in           integer     not null default 0,
  tokens_out          integer     not null default 0,
  cost_usd            numeric(10,6) not null default 0,
  error_code          text,
  error_message       text,
  unique (run_id, prompt_id, sample_index)
);

create index calls_run_id_idx    on public.calls(run_id);
create index calls_user_id_idx   on public.calls(user_id);
create index calls_brand_id_idx  on public.calls(brand_id);

alter table public.calls enable row level security;

create policy calls_select_own
  on public.calls for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- citations: extracted brand mentions per call
-- ---------------------------------------------------------------------------
create table public.citations (
  id            uuid    primary key default gen_random_uuid(),
  call_id       uuid    not null references public.calls(id) on delete cascade,
  run_id        uuid    not null references public.runs(id) on delete cascade,
  user_id       uuid    not null references auth.users(id) on delete cascade,
  brand_id      uuid    not null references public.brands(id) on delete cascade,
  brand         text    not null,
  matched_text  text    not null,
  kind          text    not null
);

create index citations_call_id_idx   on public.citations(call_id);
create index citations_user_id_idx   on public.citations(user_id);
create index citations_brand_id_idx  on public.citations(brand_id);
create index citations_kind_brand_idx on public.citations(brand);

alter table public.citations enable row level security;

create policy citations_select_own
  on public.citations for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- stripe_events: idempotency log for Stripe webhook events. We dedupe by
-- event.id (Stripe documents at-least-once delivery). The webhook handler
-- INSERTs into this table first; if the row already exists, it short-circuits.
-- service_role only; never exposed to authenticated users.
-- ---------------------------------------------------------------------------
create table public.stripe_events (
  id              text         primary key,    -- the Stripe event.id
  type            text         not null,
  payload_jsonb   jsonb        not null,
  received_at     timestamptz  not null default now()
);

alter table public.stripe_events enable row level security;
-- No policies = no access for any authenticated role. service_role bypasses
-- RLS, which is intentional: the webhook handler uses service_role.

-- ---------------------------------------------------------------------------
-- helper: keep updated_at fresh on jobs
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger jobs_touch_updated_at
  before update on public.jobs
  for each row execute function public.touch_updated_at();
