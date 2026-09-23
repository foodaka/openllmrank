-- Read-only: initial gross paid Checkout sessions, deduplicated by session ID.
-- Run in the administrative SQL editor; never expose webhook payloads publicly.
-- Adjust dates to the analysis window. This is not net revenue or renewal MRR.
with sessions as (
  select distinct on (payload_jsonb #>> '{data,object,id}')
    payload_jsonb #>> '{data,object,id}' as session_id,
    coalesce(payload_jsonb #>> '{data,object,metadata,acquisition_landing}', 'unknown') as landing,
    coalesce(payload_jsonb #>> '{data,object,metadata,acquisition_source}', 'unknown') as source,
    case when payload_jsonb #>> '{data,object,mode}' = 'subscription' then 'tracking' else 'report' end as plan,
    payload_jsonb #>> '{data,object,currency}' as currency,
    (payload_jsonb #>> '{data,object,amount_total}')::numeric as amount_cents
  from public.stripe_events
  where type = 'checkout.session.completed'
    and processed_at is not null
    and payload_jsonb ->> 'livemode' = 'true'
    and payload_jsonb #>> '{data,object,payment_status}' = 'paid'
    and payload_jsonb #>> '{data,object,metadata,lead_id}' is not null
    and coalesce(payload_jsonb #>> '{data,object,metadata,kind}', '') <> 'monitor'
    and to_timestamp((payload_jsonb ->> 'created')::double precision) >= timestamptz '2026-09-23 00:00:00+00'
    and to_timestamp((payload_jsonb ->> 'created')::double precision) < timestamptz '2026-10-21 00:00:00+00'
  order by payload_jsonb #>> '{data,object,id}', processed_at
)
select landing, source, plan, currency, count(*) as paid_sessions,
       sum(amount_cents) / 100 as gross_initial_payments
from sessions
group by landing, source, plan, currency
order by paid_sessions desc;
