-- Free crawl-check pipeline (eng review 2026-08-15, design doc
-- markhinschberger-main-design-20260815-094212.md).
--
--   crawl_checks         one row per crawl of a domain. Mutable while
--                        queued/running; FROZEN once state is terminal
--                        (complete|partial|failed) — a re-check inserts a
--                        NEW row, never updates an old one.
--   crawl_report_tokens  per-requester unguessable access tokens. Submitting
--                        a domain someone else already checked hands out a
--                        NEW token to the SAME crawl row — the other
--                        requester's URL is never revealed.
--
-- Access model: NO anon/authenticated RLS policies on either table. All
-- reads go through the web tier with the service client (same pattern as
-- /reports/[id]). RLS is enabled so the tables are inert to other roles.
--
-- Quotas are enforced in the web tier by counting rows here (durable across
-- deploys and instances, unlike the in-memory limiter):
--   submissions per requester/day  -> count crawl_report_tokens by ip hash
--   crawls per domain/day          -> count crawl_checks by domain

create type crawl_state as enum (
  'queued',
  'running',
  'complete',
  'partial',
  'failed'
);

create table public.crawl_checks (
  id                 uuid         primary key default gen_random_uuid(),
  domain             text         not null
    constraint crawl_checks_domain_not_empty check (char_length(domain) > 0)
    constraint crawl_checks_domain_lowercase check (domain = lower(domain)),
  origin             text         not null
    constraint crawl_checks_origin_not_empty check (char_length(origin) > 0),
  state              crawl_state  not null default 'queued',
  requester_ip_hash  text         not null,  -- sha256(ip + salt), never the raw IP
  -- schema_version lives inside both jsonb payloads (see packages/crawl).
  phase1_jsonb       jsonb,
  findings_jsonb     jsonb,
  pages_crawled      integer      not null default 0,
  pages_discovered   integer      not null default 0,
  failure_reason     text,
  attempts           integer      not null default 0,
  claimed_at         timestamptz,            -- lease; reclaim when stale and state='running'
  claimed_by         text,
  created_at         timestamptz  not null default now(),
  finished_at        timestamptz,
  -- Manual delisting (v1: founder-verified email request). Delisted checks
  -- stay in the table but the web tier refuses to render them.
  delisted           boolean      not null default false
);

create index crawl_checks_state_queued_idx
  on public.crawl_checks(created_at) where state = 'queued';
create index crawl_checks_state_running_idx
  on public.crawl_checks(claimed_at) where state = 'running';
-- Dedupe lookup ("newest crawl of this domain in the last 24h") and the
-- per-domain daily quota count.
create index crawl_checks_domain_created_idx
  on public.crawl_checks(domain, created_at desc);
-- Concurrency guard: the web tier's dedupe is check-then-insert across many
-- serverless instances; this closes the race at the database — at most one
-- ACTIVE (queued/running) crawl per domain. The web tier treats a unique
-- violation as "someone else just queued it" and re-runs the dedupe lookup.
create unique index crawl_checks_domain_active_uniq
  on public.crawl_checks(domain) where state in ('queued', 'running');

create table public.crawl_report_tokens (
  token              uuid         primary key default gen_random_uuid(),
  check_id           uuid         not null references public.crawl_checks(id) on delete cascade,
  requester_ip_hash  text         not null,
  created_at         timestamptz  not null default now()
);

create index crawl_report_tokens_check_idx
  on public.crawl_report_tokens(check_id);
-- Per-requester daily submission quota.
create index crawl_report_tokens_ip_created_idx
  on public.crawl_report_tokens(requester_ip_hash, created_at desc);

alter table public.crawl_checks enable row level security;
alter table public.crawl_report_tokens enable row level security;
-- Deliberately NO policies: anon and authenticated see nothing; the service
-- role (web tier + worker) bypasses RLS.
