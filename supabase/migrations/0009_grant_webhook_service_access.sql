-- The Stripe webhook runs with service_role. RLS bypass alone does not grant
-- table privileges, so explicitly allow it to process paid checkout events.
grant all on table
  public.leads,
  public.stripe_events
to service_role;
