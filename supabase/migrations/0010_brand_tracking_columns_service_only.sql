-- Scheduler-owned brand columns are written only by the service role.
--
-- 0001 gave signed-in users insert/update on their own brands rows (RLS:
-- auth.uid() = user_id) and 0006 added cadence, next_run_at, last_run_at,
-- and config_jsonb to that table. Sign-up is open, so without this change
-- anyone with the anon key could create an account, insert a brand with
-- cadence='weekly', next_run_at=now(), and hand the scheduler a config to
-- run at our expense. The scheduler also joins on an active subscription,
-- but the customer-visible cadence state should not be writable from the
-- browser either.
--
-- Column-level privileges instead of a trigger: they are declarative, show
-- up in \dp, and PostgREST reports a clean 42501 on violation. RLS policies
-- still apply on top for the columns that remain writable.

revoke insert, update on table public.brands from authenticated;

grant insert (user_id, name, aliases, website, category)
  on table public.brands to authenticated;

grant update (name, aliases, website, category, archived_at)
  on table public.brands to authenticated;

-- service_role keeps full access (granted in 0008) for the webhook, worker,
-- and the dashboard's brand API, which writes config_jsonb and cadence only
-- after verifying the session and subscription server-side.
