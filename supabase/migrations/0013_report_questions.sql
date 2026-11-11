-- Ask the report: questions a reader asks about one completed report, and the
-- model's answer. One row per answered question.
--
--   report_questions  the per-report daily quota ledger (the ask endpoint
--                     counts rows for the job in the last 24 hours before
--                     calling the model) and the record of what customers
--                     want to know, for product research.
--
-- Access model: NO anon/authenticated policies. The ask endpoint authorizes
-- the reader exactly like the report page (signed link, owner session, or
-- legacy grace window), then writes here with the service client.

create table public.report_questions (
  id           uuid         primary key default gen_random_uuid(),
  job_id       uuid         not null references public.jobs(id) on delete cascade,
  -- The report owner, not necessarily the reader: a signed link can be shared.
  user_id      uuid         not null references auth.users(id) on delete cascade,
  question     text         not null
    constraint report_questions_question_len check (char_length(question) between 1 and 1000),
  answer       text         not null,
  -- How the reader got in: 'token' | 'session' | 'grace'.
  access_via   text         not null,
  model        text         not null,
  tokens_in    integer      not null default 0,
  tokens_out   integer      not null default 0,
  tool_calls   integer      not null default 0,
  created_at   timestamptz  not null default now()
);

create index report_questions_job_created_idx
  on public.report_questions(job_id, created_at desc);
create index report_questions_created_idx
  on public.report_questions(created_at desc);

alter table public.report_questions enable row level security;
-- Deliberately NO policies; the service role bypasses RLS.

-- RLS bypass does not replace table privileges (see 0008).
grant all on table public.report_questions to service_role;
