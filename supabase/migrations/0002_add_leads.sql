-- Leads table. Captures wizard-started signups BEFORE payment so we can
-- (later) email abandons. Holds the full HostedConfig so the webhook can
-- look it up by lead_id (passed via Stripe metadata) and provision the
-- user/brand/job post-payment.
--
-- Lifecycle:
--   1. /api/checkout INSERTs row with status='started', config_jsonb, and
--      stripe_checkout_session_id (set after creating the Stripe session).
--   2. Stripe webhook checkout.session.completed reads the row, creates
--      auth.users + brands + jobs, then UPDATEs status='converted',
--      job_id, converted_at.
--   3. (Later) a cron picks rows where status='started' AND
--      wizard_started_at < now() - interval '1 hour' to send "abandoned
--      cart" emails.
--
-- RLS: service-role only. No policies (like stripe_events). Auth users
-- don't exist yet at INSERT time, so no auth.uid()-based policy would
-- make sense.

create type lead_status as enum ('started', 'converted', 'abandoned');

create table public.leads (
  id                          uuid         primary key default gen_random_uuid(),
  email                       text         not null,
  brand_name                  text         not null,
  competitor_count            integer      not null default 0,
  prompt_count                integer      not null default 0,
  config_jsonb                jsonb        not null,
  source                      text         not null default 'wizard',
  status                      lead_status  not null default 'started',
  stripe_checkout_session_id  text         unique,
  job_id                      uuid         references public.jobs(id) on delete set null,
  wizard_started_at           timestamptz  not null default now(),
  converted_at                timestamptz,

  constraint leads_email_not_empty check (char_length(email) > 0),
  constraint leads_brand_name_not_empty check (char_length(brand_name) > 0)
);

create index leads_email_status_idx        on public.leads(email, status);
create index leads_abandoned_recovery_idx  on public.leads(status, wizard_started_at)
  where status = 'started';
create index leads_session_idx              on public.leads(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

alter table public.leads enable row level security;
-- No policies = no authenticated-role access. Only service_role (which
-- bypasses RLS) can read/write. Matches the stripe_events pattern.
