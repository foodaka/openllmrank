-- The worker, Stripe webhook, and local dashboard seed use service_role.
-- RLS bypass does not replace table privileges, so grant the role access to
-- the tables introduced or extended by the dashboard migration.
grant all on table
  public.subscriptions,
  public.brands,
  public.jobs,
  public.runs,
  public.run_metrics
to service_role;

-- RLS policies control which rows an authenticated user can see, but the
-- role still needs table-level SELECT privileges for PostgREST queries.
grant select on table
  public.subscriptions,
  public.brands,
  public.jobs,
  public.runs,
  public.run_metrics
to authenticated;
