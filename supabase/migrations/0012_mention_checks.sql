-- Free "Does AI mention you?" check (/ai-visibility-checker).
--
--   mention_checks   one row per request: a brand, its website and ONE buyer
--                    question, asked once to a few grounded assistants. The
--                    row id is the requester's unguessable access token
--                    (gen_random_uuid, 122 random bits). Mutable while
--                    queued/running; FROZEN once terminal.
--   mention_answers  grounded answers cached per (provider, model, question).
--                    Answers are brand-agnostic: mentions are derived per
--                    check at read time, so two brands asking the same
--                    question share one paid call.
--
-- Access model: NO anon/authenticated RLS policies (same as crawl_checks).
-- The web tier reads through the service client; the worker writes.
--
-- Spend control lives in the web tier, counted here (durable across
-- instances, unlike the in-memory limiter):
--   checks per requester/day  -> count mention_checks by ip hash
--   global spend/day          -> sum mention_checks.cost_usd + an estimate
--                                for checks not yet finished

create table public.mention_checks (
  id                 uuid         primary key default gen_random_uuid(),
  brand_name         text         not null
    constraint mention_checks_brand_len check (char_length(brand_name) between 1 and 120),
  website            text         not null
    constraint mention_checks_website_len check (char_length(website) between 1 and 2048),
  domain             text         not null
    constraint mention_checks_domain_lowercase check (domain = lower(domain)),
  question           text         not null
    constraint mention_checks_question_len check (char_length(question) between 10 and 300),
  -- [{id, model}] — a product decision fixed at submit time, never caller input.
  providers_jsonb    jsonb        not null,
  state              text         not null default 'queued'
    constraint mention_checks_state_valid check (state in ('queued', 'running', 'complete', 'failed')),
  requester_ip_hash  text         not null,  -- sha256(ip + salt), never the raw IP
  -- Written by the worker when terminal; schema in @openllmrank/shared/mention-check.
  results_jsonb      jsonb,
  -- Real provider spend for this check (0 for cache hits).
  cost_usd           numeric(10, 5) not null default 0,
  failure_reason     text,
  attempts           integer      not null default 0,
  claimed_at         timestamptz,
  claimed_by         text,
  created_at         timestamptz  not null default now(),
  finished_at        timestamptz
);

create index mention_checks_queued_idx
  on public.mention_checks(created_at) where state = 'queued';
create index mention_checks_running_idx
  on public.mention_checks(claimed_at) where state = 'running';
-- Per-requester daily quota.
create index mention_checks_ip_created_idx
  on public.mention_checks(requester_ip_hash, created_at desc);
-- Global daily spend.
create index mention_checks_created_idx
  on public.mention_checks(created_at desc);

create table public.mention_answers (
  id                   uuid         primary key default gen_random_uuid(),
  provider             text         not null,
  model                text         not null,
  -- sha256 of the normalized question (trimmed, whitespace collapsed,
  -- lowercased) plus a prompt version, so a change to how we ask retires
  -- old answers without a migration.
  question_hash        text         not null,
  question             text         not null,
  response_text        text         not null,
  search_results_jsonb jsonb        not null default '[]'::jsonb,
  cost_usd             numeric(10, 5) not null default 0,
  created_at           timestamptz  not null default now()
);

create index mention_answers_lookup_idx
  on public.mention_answers(provider, model, question_hash, created_at desc);

alter table public.mention_checks enable row level security;
alter table public.mention_answers enable row level security;
-- Deliberately NO policies: anon and authenticated see nothing; the service
-- role (web tier + worker) bypasses RLS.

-- RLS bypass does not replace table privileges (see 0008).
grant all on table public.mention_checks, public.mention_answers to service_role;
