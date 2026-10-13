-- Free AI-visibility snapshot (no card). A visitor gives a website and an
-- email; we draft a few buyer questions plus competitors from the site and
-- run a small job (3 questions x 5 engines x 1 sample, roughly $0.60-1)
-- through the normal worker pipeline. The result page shows part of the
-- answer and sells $49/mo tracking for the rest.
--
--   jobs.origin = 'snapshot'   free job: amount_cents = 0, never refunded,
--                              never retried by the scheduler
--   leads.source = 'snapshot'  the email capture, one row per snapshot
--
-- Abuse limits are enforced in the web tier by counting leads rows:
-- one snapshot per email, one per domain per week, a per-IP daily cap and a
-- global daily cap (SNAPSHOT_DAILY_CAP). The columns below make those
-- counts cheap.

alter type public.job_origin add value if not exists 'snapshot';

alter table public.leads
  add column if not exists website_domain    text,
  add column if not exists requester_ip_hash text;

create index if not exists leads_source_started_idx
  on public.leads(source, wizard_started_at desc);
create index if not exists leads_snapshot_domain_idx
  on public.leads(website_domain, wizard_started_at desc)
  where source = 'snapshot';
create index if not exists leads_snapshot_ip_idx
  on public.leads(requester_ip_hash, wizard_started_at desc)
  where source = 'snapshot';
