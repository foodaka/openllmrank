-- Login + dashboard epic, part 2 of 2. See SPEC-DASHBOARD.md E2.
--
-- Today GET /reports/<uuid> serves a customer's full competitive analysis to
-- anyone holding the URL: the handler uses the RLS-bypassing service client
-- and validates only that the id is a well-formed UUID. A forwarded email is
-- a permanent data leak.
--
-- Fix (D6/D10): reports resolve through four paths, in order.
--
--   1. ?t=<token> valid and unexpired      -> render, no session needed
--   2. session present and job.user_id = auth.uid()  -> render
--   3. bare UUID and report_link_expires_at > now()  -> render (legacy grace)
--   4. otherwise                            -> 401 "This link expired. Sign in."
--
-- Tokens are NOT stored. A token is
--   base64url(job_id "." exp_unix "." hmac_sha256(REPORT_LINK_SECRET, job_id.exp))
-- so verification is stateless. What we store here is only the cutoff for
-- legacy bare-UUID links, so report emails already sitting in customer
-- inboxes keep working for 90 days instead of breaking on deploy day.

alter table public.jobs
  add column report_link_expires_at timestamptz;

-- Backfill the 90-day grace for every report already delivered. New reports
-- ship with ?t= from the day E2 lands, so they never rely on this path.
update public.jobs
set report_link_expires_at = now() + interval '90 days'
where status = 'completed';

comment on column public.jobs.report_link_expires_at is
  'Legacy bare-UUID link grace period (D10). After this, /reports/<id> without a signed token requires a session.';
