-- Idempotency hardening for the worker + webhook paths.
--
-- (1) runs.UNIQUE(job_id, cli_run_id)
--     Required by packages/worker/src/result-writer.ts to make INSERT
--     idempotent on stale-lease reclaim. Without this, a worker that
--     crashes after writing partial results and is reclaimed by another
--     worker creates duplicate rows in runs / calls / citations.
--
-- (2) stripe_events.processed_at
--     The webhook handler inserts stripe_events FIRST for idempotency. On
--     retry, we want "did we successfully complete the event handler?"
--     not just "did we receive this event?". Without processed_at, a
--     crash between event-insert and job-insert silently swallows the
--     event on the retry and the customer pays with no job created.

-- ---------------------------------------------------------------------------
-- (1) UNIQUE on runs(job_id, cli_run_id)
-- ---------------------------------------------------------------------------
alter table public.runs
  add constraint runs_job_id_cli_run_id_key unique (job_id, cli_run_id);

-- ---------------------------------------------------------------------------
-- (2) stripe_events.processed_at — null on insert, set when handler completes
-- ---------------------------------------------------------------------------
alter table public.stripe_events
  add column processed_at timestamptz;

create index stripe_events_unprocessed_idx
  on public.stripe_events(received_at)
  where processed_at is null;
