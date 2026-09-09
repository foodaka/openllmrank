-- The hosted report renderer uses service_role after report access has been
-- authorized. RLS bypass does not replace table privileges, so grant the
-- renderer access to the raw evidence tables it reads.
grant all on table
  public.prompts,
  public.calls,
  public.citations
to service_role;
