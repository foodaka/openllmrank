-- Attribute jobs to the surface that initiated them.
--
-- jobs.origin (one_shot | scheduled | manual) says HOW a run was triggered
-- and is load-bearing for refunds and scheduler retries, so it stays as it
-- is. jobs.source says WHERE the order came from: the web wizard, or an
-- external agent talking to the MCP endpoint (/api/mcp). Free text rather
-- than an enum, matching leads.source, so a new integration is not a
-- migration.
--
--   web   wizard / dashboard / scheduler (default; every existing row)
--   mcp   an AI agent via the MCP connector (Muse, Claude, ChatGPT, ...)

alter table public.jobs
  add column if not exists source text not null default 'web';

-- Agent orders are charged with a PaymentIntent directly (Stripe Shared
-- Payment Tokens) and have no Checkout session, so stripe_checkout_session_id
-- cannot be their duplicate-delivery backstop. One PaymentIntent pays for at
-- most one job either way.
create unique index if not exists jobs_stripe_payment_intent_unique
  on public.jobs (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- One order, one job. An agent order can be paid two ways (a Shared Payment
-- Token, or the Checkout link it was also given) and a retry can arrive with
-- a fresh token, so "has this lead been paid?" must be decided by the
-- database, not by reading leads.status before charging. Whoever inserts
-- second gets 23505 and refunds their payment.
alter table public.jobs
  add column if not exists lead_id uuid references public.leads(id) on delete set null;

create unique index if not exists jobs_lead_unique
  on public.jobs (lead_id)
  where lead_id is not null;
