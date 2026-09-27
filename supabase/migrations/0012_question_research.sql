-- Question research (dashboard): a topic becomes buyer questions ranked by
-- Google demand and AI-assistant demand (DataForSEO), grouped by an LLM.
--
--   question_research  one row per search a user runs for a brand. Doubles
--                      as the cache (results are brand-agnostic, so any
--                      row for the same topic + market within 7 days is
--                      reused, whoever ran it) and as the per-user daily
--                      quota ledger (only searches that spent money count).
--
-- Access model: NO anon/authenticated policies. The web tier checks brand
-- ownership through RLS on `brands`, then reads/writes here with the
-- service client (same pattern as mention_checks).

create table public.question_research (
  id             uuid           primary key default gen_random_uuid(),
  user_id        uuid           not null references auth.users(id) on delete cascade,
  brand_id       uuid           not null references public.brands(id) on delete cascade,
  topic          text           not null
    constraint question_research_topic_len check (char_length(topic) between 2 and 80),
  -- lower(trim(collapsed whitespace)): the cache key with location + language.
  topic_key      text           not null,
  location_code  integer        not null,
  language_code  text           not null,
  -- Schema in packages/web/lib/question-research.ts (schema_version inside).
  results_jsonb  jsonb          not null,
  -- 0 for cache hits; a cache hit never counts toward the daily quota.
  cost_usd       numeric(10, 5) not null default 0,
  cached         boolean        not null default false,
  created_at     timestamptz    not null default now()
);

create index question_research_cache_idx
  on public.question_research(topic_key, location_code, language_code, created_at desc)
  where cached = false;
create index question_research_user_created_idx
  on public.question_research(user_id, created_at desc);
create index question_research_brand_created_idx
  on public.question_research(brand_id, created_at desc);

alter table public.question_research enable row level security;
-- Deliberately NO policies; the service role bypasses RLS.

-- RLS bypass does not replace table privileges (see 0008).
grant all on table public.question_research to service_role;
