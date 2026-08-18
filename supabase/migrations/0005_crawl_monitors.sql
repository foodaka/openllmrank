-- Crawl monitoring: $29/mo per-domain weekly re-crawls with change alerts
-- (spec: issue #36; eng review 2026-08-17, Codex-hardened).
--
--   crawl_monitors   one row per subscription. The monitor tick (worker crawl
--                    loop) claims due monitors, adopts-or-inserts a
--                    crawl_checks row (pending_check_id), and when that check
--                    reaches a terminal state diffs + emails + reschedules.
--   crawl_checks.source
--                    'monitor' checks are claimed AHEAD of 'free' checks —
--                    priority by separation, replacing any wall-clock SLA.
--
-- Email delivery is at-least-once: state (last_check_id / next_crawl_at)
-- advances only AFTER a successful send, so a crash re-diffs the same
-- deterministic inputs. last_complete_check_id is tracked separately from
-- last_check_id because finding-diffs are only honest complete↔complete.
--
-- Access model: RLS enabled, deliberately ZERO anon policies (service-role
-- only), same posture as crawl_checks. The future dashboard claims monitors
-- by email.

alter table public.crawl_checks
  add column source text not null default 'free'
    constraint crawl_checks_source_valid check (source in ('free', 'monitor'));

-- Claim priority: monitor checks first, then oldest-first within source.
create index crawl_checks_claim_priority_idx
  on public.crawl_checks(source, created_at) where state = 'queued';

create type monitor_status as enum ('active', 'canceled');

create table public.crawl_monitors (
  id                       uuid          primary key default gen_random_uuid(),
  domain                   text          not null
    constraint crawl_monitors_domain_not_empty check (char_length(domain) > 0)
    constraint crawl_monitors_domain_lowercase check (domain = lower(domain)),
  origin                   text          not null
    constraint crawl_monitors_origin_not_empty check (char_length(origin) > 0),
  email                    text          not null
    constraint crawl_monitors_email_not_empty check (char_length(email) > 0),
  stripe_customer_id       text          not null,
  stripe_subscription_id   text          not null unique,
  status                   monitor_status not null default 'active',
  -- Crawl currently in flight for this monitor (adopt-or-insert result).
  pending_check_id         uuid          references public.crawl_checks(id),
  -- Most recent terminal check we emailed about (any state).
  last_check_id            uuid          references public.crawl_checks(id),
  -- Most recent COMPLETE check — the only valid finding-diff baseline.
  last_complete_check_id   uuid          references public.crawl_checks(id),
  next_crawl_at            timestamptz   not null default now(),
  -- Send bookkeeping for at-least-once delivery with retry.
  last_email_error         text,
  email_attempts           integer       not null default 0,
  created_at               timestamptz   not null default now(),
  canceled_at              timestamptz
);

-- The monitor tick's due query; also serves cancellation checks.
create index crawl_monitors_due_idx
  on public.crawl_monitors(next_crawl_at) where status = 'active';
-- Webhook lookups by subscription happen via the unique constraint above.

alter table public.crawl_monitors enable row level security;
-- Deliberately NO policies: anon and authenticated see nothing; the service
-- role (web tier + worker) bypasses RLS.
