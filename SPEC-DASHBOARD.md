# Spec — Login + Dashboard (Epic)

> Authored by `/spec` on 2026-08-11. Branch `main`. Supersedes the v2 deferral in
> [TODOS.md](./TODOS.md) line 115 ("Live dashboard / charts / login-to-view").

---

## Context

openllmrank today is a one-shot transaction. A buyer completes a 4-step wizard, pays
$29.99, and 10-15 minutes later an email arrives with a link to a static HTML report.
That is the entire product surface. There is no account, no login page, and no way to
see run #2, because there is no way to *produce* run #2.

This epic turns that transaction into a tracked product: customers log in, watch their
AI-search citation rate move over time across multiple brands, and pay $29/mo to keep
it updating weekly.

Three facts about the current codebase make this cheaper than it looks:

1. **Accounts already exist.** `packages/web/app/api/webhook/stripe/route.ts:59` calls
   `supabase.auth.admin.createUser({ email, email_confirm: true })` on every successful
   payment. Every paying customer has an `auth.users` row today. They have no password,
   have never received an invite, and there is no login page — the rows are orphaned.
2. **RLS is already written.** `select_own` policies exist on `brands`, `jobs`, `runs`,
   `prompts`, `calls`, and `citations` (`supabase/migrations/0001_init.sql:47-242`).
   `anonClient()` in `packages/web/lib/supabase-server.ts:24` even carries the comment
   "Used for reads on behalf of a logged-in user (eventually)."
3. **The worker needs no changes to run a scheduled job.** `claimJob`
   (`packages/worker/src/queue.ts:60`) claims any row with `status='paid'`. A recurring
   run is an INSERT, not a new pipeline.

What is genuinely missing: session plumbing (`@supabase/ssr` is not a dependency of
`packages/web`), a subscription object, a scheduler, and the dashboard itself.

### Why now

The one-shot validated that the buyer exists. It did not validate that they stay. Every
customer today is a dead end: they read one report and the relationship ends. Recurring
runs are the only way the citation-rate data becomes a trend rather than a snapshot,
and a trend is the only thing email cannot deliver.

### How we know it is done

- A customer can log in, see their brands, and read a trend line built from ≥2 runs.
- A `$29/mo` subscriber's brands re-run automatically on schedule with no human action.
- A report URL leaked outside the customer's inbox stops working within 90 days.
- Break-even math is enforced in code, not in hope (see Margin, below).

---

## Decisions Locked

| # | Decision | Choice |
|---|----------|--------|
| D1 | Why log in | Recurring runs + trends |
| D2 | Auth method | Magic link + password option |
| D3 | Prototype | Seed local DB + real routes |
| D4 | Pricing | $29.99 one-shot kept, $29/mo upsell added |
| D5 | Run trigger | Auto schedule + manual re-run |
| D6 | Report links | Signed links with expiry, then login |
| D7 | Multi-brand | Full multi-brand now |
| D8 | Billing model | $29/mo flat, unlimited brands |
| D9 | Cadence | Weekly run + 2 manual/mo |
| D10 | Link expiry | 90 days, then sign in |
| D11 | Home screen | Editorial standfirst + trend |
| D12 | Margin guard | Unlimited brands, throttled schedule |

---

## Current State (verified 2026-08-11)

| Capability | Status | Evidence |
|---|---|---|
| Auth users created | ✅ exists | `webhook/stripe/route.ts:47-84` `findOrCreateAuthUser` |
| Login page | ❌ none | No route under `packages/web/app/` matches `login`/`auth` |
| Session cookies | ❌ none | `@supabase/ssr` absent from `packages/web/package.json` |
| RLS select-own policies | ✅ exists | `0001_init.sql:47,134,159,183,215,240` |
| Report access control | ❌ none | `reports/[id]/route.ts:79` uses `serviceClient()`, checks UUID shape only |
| Recurring billing | ❌ none | `lib/stripe.ts` creates one-time Checkout sessions only |
| Scheduler | ❌ none | Worker runs 3 loops: job, refunder, email (`worker/src/index.ts:1-8`) |
| Multi-brand schema | ✅ exists | `brands.user_id` FK, one-to-many (`0001_init.sql:34-43`) |
| Multi-brand UI | ❌ none | Wizard is single-brand (`app/wizard/brand/page.tsx`) |
| Per-run metrics | ❌ none | Computed on demand from `calls`+`citations` in `reports/[id]/route.ts:237` |

### The security gap, stated plainly

`GET /reports/<uuid>` serves a customer's complete competitive analysis to anyone
holding the URL. The handler uses the RLS-bypassing service client and validates only
that the id is a well-formed UUID (`reports/[id]/route.ts:66-84`). There is no
`user_id` comparison anywhere in the file. A forwarded email is a permanent data leak.
D6 and D10 close this.

### The refund landmine

`markFailed` (`packages/worker/src/queue.ts:113-131`) sets `refund_status='pending'`
unconditionally on any job failure. Today every job is a one-shot with a real
`stripe_payment_intent_id`, so that is correct. Once scheduled runs exist, a failed
subscription run queues a Stripe refund against a null payment intent. The refunder
loop will either error or, worse, refund the wrong charge. Fixed in **E8**.

---

## Margin (the number that shapes the design)

Cost per full run, derived from the pricing tables in `packages/cli/src/providers/*.ts`
at 10 prompts × 3 samples × 5 providers = 150 calls, assuming ~600 input / ~700 output
tokens per call:

| Provider | Model | $/call | 30 calls |
|---|---|---|---|
| OpenAI | `gpt-5.4-mini` | 0.0286 | $0.86 |
| Gemini | `gemini-3.5-flash` | 0.0212 | $0.64 |
| Anthropic | `claude-haiku-4-5` | 0.0141 | $0.42 |
| Perplexity | `sonar` | 0.0093 | $0.28 |
| xAI | `grok-4.3` | 0.0025 | $0.08 |
| | | | **~$2.28/run** |

Search-call fees dominate; token cost is noise. At D9 (weekly + 2 manual = 6 runs per
brand per month) against D8 ($29/mo flat, unlimited brands):

| Brands | Runs/mo | Cost | Revenue | Margin |
|---|---|---|---|---|
| 1 | 6 | $13.68 | $29 | +$15.32 |
| 2 | 12 | $27.36 | $29 | +$1.64 |
| 3 | 18 | $41.04 | $29 | **−$12.04** |
| 10 | 60 | $136.80 | $29 | **−$107.80** |

**Break-even is 2 brands.** D12 resolves this without breaking the unlimited promise:
every brand is tracked and visible at any count, but past a configurable threshold the
*scheduler cadence* downgrades for that account.

```
brands_active <= SCHEDULER_WEEKLY_MAX_BRANDS (default 2)  ->  weekly   (4 runs/brand/mo)
brands_active >  SCHEDULER_WEEKLY_MAX_BRANDS              ->  monthly  (1 run/brand/mo)
```

Worst case at the downgraded tier, 10 brands: 10 × (1 scheduled) + 2 manual = 12 runs
= $27.36 against $29. Bounded. `SCHEDULER_WEEKLY_MAX_BRANDS` is an env var, so the
threshold moves without a deploy once real usage data exists.

This must be stated in the plan description and Terms before launch. "Unlimited brands,
weekly tracking on up to 2, monthly beyond that" is honest. "Unlimited" alone is not.

---

## Proposed Change

```
                         ┌──────────────────────────────────────┐
                         │  MARKETING (unchanged)               │
                         │  /  ->  /wizard/*  ->  Stripe        │
                         └──────────────┬───────────────────────┘
                                        │ checkout.session.completed
                                        ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │  WEBHOOK  (extended)                                               │
   │  one-time  -> user + brand + job(origin=one_shot)  [as today]      │
   │  NEW: also send a set-password / magic-link invite email           │
   │  NEW: subscription events -> subscriptions table                   │
   └──────────────┬─────────────────────────────────────────────────────┘
                  │
                  ▼
   ┌─────────────────────────┐         ┌──────────────────────────────┐
   │  AUTH (new)             │         │  WORKER (one new loop)       │
   │  /login  magic + pwd    │         │  1. job loop     [unchanged] │
   │  /auth/callback         │         │  2. refunder     [E8 fix]    │
   │  middleware -> /dash/*  │         │  3. email retry  [unchanged] │
   └───────────┬─────────────┘         │  4. SCHEDULER    [new]       │
               │                       └──────────────┬───────────────┘
               ▼                                      │ INSERT jobs
   ┌─────────────────────────────────────┐            │ status='paid'
   │  DASHBOARD (new, RLS-scoped)        │◄───────────┘ origin='scheduled'
   │  /dashboard            brand list   │
   │  /dashboard/[brandId]  standfirst   │  reads run_metrics (new table)
   │            + trend SVG + latest run │
   │  /dashboard/[brandId]/runs          │
   │  /dashboard/[brandId]/settings      │
   │  /dashboard/brands/new              │
   │  /dashboard/billing                 │
   └─────────────────────────────────────┘
```

Every dashboard read goes through `@supabase/ssr` with the **anon key** so RLS enforces
tenancy. The service client stays confined to the webhook and the worker. This is the
single most important rule in the epic: if a dashboard route imports `serviceClient()`,
that is a bug.

---

## Schema Changes

### Migration `0004_subscriptions_and_tracking.sql`

```sql
-- ---------------------------------------------------------------------------
-- subscriptions: one Stripe subscription per user. Flat $29/mo, unlimited
-- brands (D8), with scheduler cadence throttled past a brand threshold (D12).
-- ---------------------------------------------------------------------------
create type subscription_status as enum (
  'incomplete',  -- checkout started, first invoice unpaid
  'active',
  'past_due',    -- payment failed, grace period; scheduler pauses
  'canceled'     -- terminal; scheduler stops, dashboard stays readable
);

create table public.subscriptions (
  id                      uuid                primary key default gen_random_uuid(),
  user_id                 uuid                not null references auth.users(id) on delete cascade,
  stripe_subscription_id  text                unique not null,
  stripe_customer_id      text                not null,
  status                  subscription_status not null default 'incomplete',
  current_period_end      timestamptz,
  cancel_at_period_end    boolean             not null default false,
  created_at              timestamptz         not null default now(),
  updated_at              timestamptz         not null default now()
);

-- At most one non-canceled subscription per user. Prevents double billing when
-- a customer opens checkout twice.
create unique index subscriptions_one_live_per_user
  on public.subscriptions(user_id)
  where status in ('incomplete', 'active', 'past_due');

create index subscriptions_status_idx on public.subscriptions(status);

alter table public.subscriptions enable row level security;

create policy subscriptions_select_own
  on public.subscriptions for select
  using (auth.uid() = user_id);
-- No insert/update/delete policies: only the Stripe webhook (service_role)
-- mutates subscriptions. The dashboard reads; Stripe is the source of truth.

create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- brands: gains its own tracking config so the scheduler can create jobs
-- without a wizard. Until now config lived only on jobs.
-- ---------------------------------------------------------------------------
create type run_cadence as enum ('weekly', 'monthly', 'paused');

alter table public.brands
  add column website          text,
  add column category         text,
  add column config_jsonb     jsonb,        -- HostedConfig; null for pre-epic brands
  add column cadence          run_cadence   not null default 'paused',
  add column next_run_at      timestamptz,
  add column last_run_at      timestamptz,
  add column archived_at      timestamptz;

-- Scheduler's hot path. Partial index keeps it small as archived brands grow.
create index brands_due_idx
  on public.brands(next_run_at)
  where cadence <> 'paused' and archived_at is null;

-- Brands are user-writable from the dashboard (add/edit/archive), and the
-- insert/update/delete policies from 0001_init.sql already allow it.

-- ---------------------------------------------------------------------------
-- jobs: needs to say where a run came from. Drives billing, refunds, quota.
-- ---------------------------------------------------------------------------
create type job_origin as enum (
  'one_shot',   -- $29.99 wizard purchase; has a payment_intent; refundable
  'scheduled',  -- created by the worker scheduler under a subscription
  'manual'      -- customer clicked Re-run; counts against monthly quota
);

alter table public.jobs
  add column origin           job_origin not null default 'one_shot',
  add column subscription_id  uuid references public.subscriptions(id) on delete set null;

-- Scheduled and manual runs are not individually charged.
alter table public.jobs alter column amount_cents set default 0;

create index jobs_origin_user_created_idx
  on public.jobs(user_id, origin, created_at desc);

-- ---------------------------------------------------------------------------
-- run_metrics: precomputed per-run summary. Without this, every dashboard
-- page load re-derives citation rates from calls + citations the way
-- reports/[id]/route.ts:237 does today. That is fine for one report; it is
-- not fine for a trend chart over 52 weekly runs.
-- ---------------------------------------------------------------------------
create table public.run_metrics (
  run_id                uuid          primary key references public.runs(id) on delete cascade,
  user_id               uuid          not null references auth.users(id) on delete cascade,
  brand_id              uuid          not null references public.brands(id) on delete cascade,
  job_id                uuid          not null references public.jobs(id) on delete cascade,
  computed_at           timestamptz   not null default now(),
  own_citation_rate     numeric(6,5)  not null,  -- 0..1 across all prompt x provider
  share_of_voice        numeric(6,5)  not null,  -- own / (own + all competitors)
  samples_total         integer       not null,
  per_provider_jsonb    jsonb         not null,  -- {"openai":0.40,"anthropic":0.13,...}
  per_competitor_jsonb  jsonb         not null,  -- [{"name":"Acme","rate":0.55},...]
  top_gap_prompt        text,                    -- prompt with worst brand-vs-best-competitor gap
  top_gap_score         numeric(6,5)
);

create index run_metrics_brand_computed_idx
  on public.run_metrics(brand_id, computed_at desc);

alter table public.run_metrics enable row level security;

create policy run_metrics_select_own
  on public.run_metrics for select
  using (auth.uid() = user_id);
```

### Migration `0005_report_tokens.sql`

```sql
-- Signed report links (D6, D10). We do NOT store tokens: a token is
-- base64url(job_id "." expires_at_unix "." hmac_sha256(secret, job_id.exp)).
-- Verification is stateless. What we DO store is the cutoff for legacy
-- bare-UUID links so already-sent emails keep working for 90 days.
alter table public.jobs
  add column report_link_expires_at timestamptz;

-- Backfill: every existing completed job gets 90 days from migration time.
update public.jobs
set report_link_expires_at = now() + interval '90 days'
where status = 'completed';
```

---

## Component Specs

### E1 — Auth foundation

**Adds:** `@supabase/ssr` to `packages/web/package.json`.

| Route | Method | Behavior |
|---|---|---|
| `/login` | GET | Email field + "Email me a link" and "Use password" toggle |
| `/login` | POST | `signInWithOtp` or `signInWithPassword` per mode |
| `/auth/callback` | GET | Exchanges `code` for a session cookie, redirects to `next` or `/dashboard` |
| `/auth/set-password` | GET/POST | For webhook-created users who have no password |
| `/auth/signout` | POST | Clears session, redirects to `/` |

`packages/web/middleware.ts` guards `/dashboard/:path*`: no session → redirect to
`/login?next=<pathname>`. Refreshes the Supabase session cookie on every matched
request (standard `@supabase/ssr` pattern).

**New:** `packages/web/lib/supabase-browser.ts` and a `userClient()` in
`supabase-server.ts` that reads cookies. `anonClient()` (`supabase-server.ts:24`) is
deleted — it has `persistSession: false` and no cookie access, so it can never carry a
user session. Leaving it invites someone to reach for it and silently get an
unauthenticated client.

**Existing-customer migration:** the Stripe webhook already creates the user. It gains
one step — send a Postmark "Set your password / sign in" email alongside the existing
order-received email. For the customers who already paid before this ships, a one-off
script sends the same invite. Magic link works for them with zero migration (D2).

**Acceptance:**
1. A user created by the webhook with no password receives an invite email and can set one.
2. Magic-link sign-in lands on `/dashboard` with a valid session cookie.
3. Password sign-in works for a user who has set one.
4. `GET /dashboard` without a session returns a 307 to `/login?next=%2Fdashboard`.
5. After `/auth/signout`, the previous session cookie no longer authorizes `/dashboard`.
6. No dashboard route imports `serviceClient` (enforced by a test that greps the route tree).

---

### E2 — Report link security

Token format, verified statelessly:

```
token = base64url( job_id + "." + exp_unix + "." + hmac_sha256(REPORT_LINK_SECRET, job_id + "." + exp_unix) )
URL   = /reports/<job_id>?t=<token>
```

`GET /reports/[id]` resolution order:

```
1. ?t= present and HMAC valid and exp > now      -> render (no session needed)
2. session present and jobs.user_id = auth.uid() -> render
3. bare UUID and jobs.report_link_expires_at > now -> render  (legacy grace, D10)
4. otherwise                                      -> 401 "This link expired. Sign in."
```

Path 3 is the 90-day grandfather for links already in customer inboxes. It expires on
its own; no cleanup job needed. Report emails start including `?t=` immediately, so new
reports never depend on path 3.

**Acceptance:**
1. A report URL with a valid unexpired token renders without a session.
2. The same URL with one character of the token changed returns 401.
3. A token whose `exp` is in the past returns 401 with the sign-in page.
4. A bare-UUID URL for a job whose `report_link_expires_at` has passed returns 401.
5. A logged-in user can open their own report with no token at all.
6. A logged-in user opening *another* user's job id returns 404 (not 401 — do not leak existence).

---

### E3 — run_metrics computation

`packages/worker/src/result-writer.ts` gains a step after `writeRunToPostgres`: compute
`computeRates` / `computeGap` (the same functions `reports/[id]/route.ts:237-241` calls)
and INSERT one `run_metrics` row.

```
own_citation_rate = sum(samples_with_citation where brand=own) / sum(samples_total)
share_of_voice    = own_cited / (own_cited + sum(competitor_cited))
per_provider      = same ratio grouped by provider
top_gap_prompt    = GapRow with max gap_score
```

Idempotency: `run_metrics.run_id` is the primary key and `runs` already has
`UNIQUE(job_id, cli_run_id)` (`0003_idempotency.sql`). Use `ON CONFLICT (run_id) DO
UPDATE` so a stale-lease reclaim recomputes rather than erroring.

**Backfill:** a script recomputes `run_metrics` for every existing completed run so
current customers see history on day one rather than an empty chart.

**Acceptance:**
1. Every completed run has exactly one `run_metrics` row.
2. `own_citation_rate` matches the value the existing report renderer shows for the same run, within 0.001.
3. Re-running the writer for the same `run_id` updates rather than duplicating.
4. Backfill produces rows for all pre-existing completed runs.
5. A run where the brand was never cited stores `0.00000`, not null.

---

### E4 — Dashboard shell + brand home (D11)

`/dashboard/[brandId]` composition, top to bottom. No cards, no KPI tiles, no icons in
circles — [DESIGN.md](./DESIGN.md) "What This System Refuses" applies in full.

```
 ┌──────────────────────────────────────────────────────────┐
 │ kicker:  WEEK OF AUGUST 11                               │  12px moss uppercase
 │                                                          │
 │ Acme is cited in 34% of buying-intent answers,          │  Fraunces 44px
 │ up from 28% three weeks ago.                             │  the standfirst
 │                                                          │
 │ ────────────────────────────────────────────────         │  hairline
 │                                                          │
 │   40% ┤                                    ╭──           │  inline SVG
 │   30% ┤                        ╭───────────╯             │  moss stroke
 │   20% ┤            ╭───────────╯                         │  no chart lib
 │   10% ┤────────────╯                                     │
 │       └────┬────┬────┬────┬────┬────┬────┬────           │
 │          Jul 7      Jul 21     Aug 4                     │
 │                                                          │
 │ ── Where you stand ──────────────────────────────        │
 │ Acme          ████████████░░░░░░░░░░░░  34%              │  rate bars, existing
 │ Competitor A  ██████████████████░░░░░░  55%              │  pattern from report
 │ Competitor B  ████████░░░░░░░░░░░░░░░░  22%              │
 │                                                          │
 │ ── By provider ──────────────────────────────────        │
 │ OpenAI 40%   Anthropic 13%   Gemini 47%  ...             │  tabular-nums
 │                                                          │
 │ Read the full August 11 report  ->                       │  link to /reports/<id>
 └──────────────────────────────────────────────────────────┘
```

The standfirst is generated, not hand-written. Template, filled from `run_metrics`:

```
"{brand} is cited in {rate}% of your tracked answers, {direction} from {prev_rate}%
 {elapsed} ago."
```

Where `direction` ∈ {up, down, unchanged}. With one run only: `"{brand} is cited in
{rate}% of your tracked answers. Your next run lands {date}."` No fabricated trend from
a single data point.

Charts are **server-rendered inline SVG**. No chart library. Two reasons: DESIGN.md
rejects the generic dashboard aesthetic, and the rate-bar pattern already exists in
`packages/cli/src/core/render-html.ts`.

**Empty states, all three of them:**

| State | Screen |
|---|---|
| No brands yet | "Track your first brand" + link to `/dashboard/brands/new` |
| Brand added, no run finished | "Your first run is queued. Reports take 10-15 minutes." with a 30s refresh |
| One run only | Standfirst without trend claim; trend section replaced by "Your trend line starts with run two." |

**Acceptance:**
1. A brand with ≥2 completed runs renders a trend line with one point per run.
2. A brand with exactly 1 run renders no trend line and no direction word in the standfirst.
3. A brand with 0 completed runs renders the queued state with a refresh meta tag.
4. An account with 0 brands renders the add-brand state.
5. Requesting a `brandId` belonging to another user returns 404.
6. The page renders correctly at 375px with no horizontal scroll.
7. No `<canvas>`, no chart library in the bundle.

---

### E5 — Multi-brand management (D7)

| Route | Purpose |
|---|---|
| `/dashboard` | Brand list: name, latest rate, direction, next run date. Single brand redirects to its page. |
| `/dashboard/brands/new` | Reuses the wizard steps (brand → competitors → prompts) writing to `brands.config_jsonb`, no payment |
| `/dashboard/[brandId]/settings` | Edit prompts / competitors / aliases, change cadence, pause, archive |

Adding a brand requires an active subscription. Without one, the route shows the upgrade
prompt instead of the form. One-shot customers see their purchased brand read-only with
"Subscribe to keep tracking Acme weekly."

Archive rather than delete: `brands.archived_at`. Historic `run_metrics` stay readable,
and the scheduler's partial index skips archived rows. Hard delete stays out of scope.

**Acceptance:**
1. A user with 3 brands sees exactly 3 rows, ordered by most recent run.
2. A user with 1 brand hitting `/dashboard` is redirected to `/dashboard/<id>`.
3. Adding a brand without an active subscription shows the upgrade prompt, creates nothing.
4. Editing prompts updates `brands.config_jsonb` and applies to the *next* run, not past runs.
5. Archiving a brand removes it from the list, keeps its runs readable by direct URL, and stops scheduling.
6. `HostedConfigSchema` caps (10 prompts, 3 samples, 5 providers) are enforced server-side on brand edit, same as `/api/checkout` does today.

---

### E6 — Subscriptions

`packages/web/lib/stripe.ts` gains `createSubscriptionSession()` alongside the existing
one-time `createCheckoutSession()`. Must keep working under `STRIPE_MODE=local_stub`,
matching the existing local-dev contract.

Webhook events to handle in `app/api/webhook/stripe/route.ts`, all through the existing
`stripe_events` idempotency + `processed_at` pattern (`route.ts:149-194`):

| Event | Action |
|---|---|
| `checkout.session.completed` (mode=subscription) | INSERT `subscriptions`, set brands to `weekly`, set `next_run_at = now()` |
| `customer.subscription.updated` | Sync `status`, `current_period_end`, `cancel_at_period_end` |
| `customer.subscription.deleted` | `status='canceled'`, set all user's brands to `cadence='paused'` |
| `invoice.payment_failed` | `status='past_due'`; scheduler pauses but dashboard stays readable |
| `invoice.paid` | `status='active'`, resume cadence |

`/dashboard/billing` shows plan, next charge date, brand count, current cadence (with
the D12 throttle stated explicitly when it applies), and a Stripe Billing Portal link.
Do not build cancel/update UI — use the portal.

**Acceptance:**
1. Completing subscription checkout creates one `subscriptions` row with `status='active'`.
2. Opening checkout twice does not create a second live subscription (unique index holds).
3. `invoice.payment_failed` sets `past_due` and the scheduler creates no new jobs for that user.
4. `invoice.paid` after a failure resumes scheduling on the next tick.
5. Cancellation pauses all the user's brands but leaves every past report readable.
6. Every subscription event is idempotent under duplicate Stripe delivery.
7. Full flow runs end-to-end under `STRIPE_MODE=local_stub` with no Stripe account.

---

### E7 — Scheduler loop + quota (D5, D9, D12)

Fourth loop in `packages/worker/src/index.ts`, alongside the existing three. Ticks every
5 minutes.

```
                    every 5 min
                         │
                         ▼
   ┌──────────────────────────────────────────────────────┐
   │ SELECT b.* FROM brands b                             │
   │ JOIN subscriptions s ON s.user_id = b.user_id        │
   │ WHERE s.status = 'active'                            │
   │   AND b.cadence <> 'paused'                          │
   │   AND b.archived_at IS NULL                          │
   │   AND b.next_run_at <= now()                         │
   │ FOR UPDATE SKIP LOCKED                               │
   └──────────────────────┬───────────────────────────────┘
                          │  per user: count active brands
                          ▼
        brands <= SCHEDULER_WEEKLY_MAX_BRANDS ? weekly : monthly   (D12)
                          │
                          ▼
   ┌──────────────────────────────────────────────────────┐
   │ INSERT jobs (status='paid', origin='scheduled',      │
   │              amount_cents=0, subscription_id=...)    │
   │ UPDATE brands SET next_run_at = now() + interval,    │
   │                   last_run_at = now()                │
   └──────────────────────────────────────────────────────┘
                          │
                          ▼
              existing job loop claims it. No worker changes.
```

`FOR UPDATE SKIP LOCKED` mirrors `claimJob` so two workers never double-schedule.
`next_run_at` advances in the same transaction as the INSERT — that is the idempotency
guarantee. Jitter of ±6h spreads load so 200 brands do not all fire at midnight.

**Manual re-run** (`POST /api/runs`, session-authed): counts
`jobs WHERE user_id=? AND origin='manual' AND created_at >= subscription period start`.
At ≥2, returns 429 with the reset date. Below 2, inserts a job with `origin='manual'`,
`status='paid'`. Also rejects if the brand already has a `paid` or `running` job — no
double-queueing.

**Acceptance:**
1. A brand with `next_run_at` in the past and an active subscription gets exactly one job per tick.
2. Two workers running concurrently produce exactly one job for that brand, not two.
3. A brand under a `past_due` or `canceled` subscription is never scheduled.
4. A user with 3 brands (threshold 2) gets monthly cadence on all of them, and the dashboard says so.
5. A user with 2 brands gets weekly.
6. The third manual re-run in a billing period returns 429 with the reset date.
7. A manual re-run for a brand with a `running` job returns 409.
8. `next_run_at` advances even when job insert and update happen under contention.
9. Jitter keeps two brands created in the same second from scheduling in the same minute.

---

### E8 — Refund path correctness (independent, can start now)

`markFailed` (`packages/worker/src/queue.ts:113`) currently sets
`refund_status='pending'` for every failure. Change: set `'pending'` only when
`origin='one_shot'`. For `scheduled` and `manual`, set `'not_required'` and fire an
`alert('warn', ...)` instead — a failed subscription run is an ops problem, not a
billing one.

The `ZERO_SUCCESS` guard (`worker/src/index.ts:88-110`) needs the same treatment: a
scheduled run with zero successes should alert and leave the previous run as the latest
good data, not attempt a refund.

**This is a real bug the moment E7 ships, and it can be fixed and tested before any
other work lands.**

**Acceptance:**
1. A failed `one_shot` job still sets `refund_status='pending'` exactly as today.
2. A failed `scheduled` job sets `refund_status='not_required'` and emits a warn alert.
3. A `ZERO_SUCCESS` scheduled run does not enqueue a refund.
4. The refunder loop never selects a job with a null `stripe_payment_intent_id`.
5. The dashboard shows a failed scheduled run as "Run failed, we are looking into it" without implying a refund.

---

## Dependency Graph

```
  E8 Refund fix ──────────────────────────────── (independent, start now)

  E1 Auth ──┬──> E2 Report links
            │
            ├──> E4 Dashboard home ──> E5 Multi-brand
            │         ▲
            │         │
  E3 Metrics ─────────┘
            │
            └──> E6 Subscriptions ──> E7 Scheduler
```

**Sequencing rationale.** E8 is independent and cheap, so it goes first and removes a
bug that E7 would otherwise activate in production. E1 gates everything user-facing —
without a session there is no dashboard and no way to test tenancy. E3 is independent of
auth and can run in parallel with E1; E4 needs both because a dashboard with no metrics
is an empty page. E6 before E7 because the scheduler's first query joins
`subscriptions`. E5 after E4 because multi-brand is a list wrapped around a page that
must exist first.

Everything after E1 is parallelizable if more than one person is working.

---

## Effort

| Item | Human | CC + gstack |
|---|---|---|
| E8 Refund fix | 0.5 day | 10 min |
| E1 Auth foundation | 3 days | 45 min |
| E2 Report links | 2 days | 30 min |
| E3 run_metrics + backfill | 2 days | 30 min |
| E4 Dashboard home + SVG | 4 days | 1.5 hr |
| E5 Multi-brand | 3 days | 1 hr |
| E6 Subscriptions | 4 days | 1 hr |
| E7 Scheduler + quota | 3 days | 45 min |
| Tests across all | 3 days | 45 min |
| **Total** | **~24 days** | **~7 hr** |

---

## Testing Plan

| Layer | What | Count |
|---|---|---|
| Unit | Token sign/verify, expiry, tamper (E2) | +8 |
| Unit | `run_metrics` math vs report renderer (E3) | +6 |
| Unit | Cadence throttle at threshold boundary (E7) | +5 |
| Unit | Manual quota counting across period boundary (E7) | +4 |
| Unit | `markFailed` branches by origin (E8) | +4 |
| Integration | RLS: user A cannot read user B's brand/run/metrics | +6 |
| Integration | Subscription webhook events, each idempotent (E6) | +7 |
| Integration | Scheduler concurrency: 2 workers, 1 job (E7) | +3 |
| Integration | Auth: session, expiry, middleware redirect (E1) | +5 |
| E2E | Signup → pay → set password → login → dashboard → subscribe → scheduled run appears | +1 |
| E2E | Legacy bare-UUID link before and after 90-day cutoff | +1 |
| **Total** | | **+50** |

RLS tests extend the existing `packages/shared/test/rls.test.ts` pattern, which already
skips cleanly when Postgres is unreachable.

---

## Rollback Plan

| Component | Undo |
|---|---|
| E1-E5, E7 | Revert the PR. Migrations are additive (new tables, new nullable columns); no data loss on revert. `brands.cadence` defaults to `paused`, so a reverted scheduler creates nothing. |
| E2 | `REPORT_LINK_ENFORCE=false` env flag restores the current open-link behavior instantly without a deploy. |
| E6 | Cancel subscriptions in the Stripe dashboard. `subscriptions` rows are read-only to the app; no customer data depends on them. |
| E7 | Set `SCHEDULER_ENABLED=false`. The loop no-ops; in-flight jobs finish normally. |
| E8 | Revert; the behavior returns to unconditional refund queueing. |

Every migration in this epic is additive. No column is dropped, no type is narrowed,
no row is deleted. `0005`'s backfill only sets a column that did not exist before.

---

## Files Reference

| File | Change |
|---|---|
| `supabase/migrations/0004_subscriptions_and_tracking.sql` | New: subscriptions, brand tracking, job origin, run_metrics |
| `supabase/migrations/0005_report_tokens.sql` | New: report link expiry + backfill |
| `packages/web/package.json` | Add `@supabase/ssr` |
| `packages/web/middleware.ts` | New: session refresh + `/dashboard/*` guard |
| `packages/web/lib/supabase-server.ts:24` | Delete `anonClient()`, add cookie-based `userClient()` |
| `packages/web/lib/supabase-browser.ts` | New: browser client |
| `packages/web/lib/report-token.ts` | New: HMAC sign/verify |
| `packages/web/app/login/page.tsx` | New: magic link + password |
| `packages/web/app/auth/callback/route.ts` | New: code exchange |
| `packages/web/app/auth/set-password/page.tsx` | New: for webhook-created users |
| `packages/web/app/dashboard/**` | New: 6 routes (see E4, E5, E6) |
| `packages/web/app/api/runs/route.ts` | New: manual re-run with quota |
| `packages/web/app/reports/[id]/route.ts:69-137` | Rewrite access control (4-path resolution) |
| `packages/web/app/api/webhook/stripe/route.ts:199` | Add 5 subscription event branches + invite email |
| `packages/web/lib/stripe.ts` | Add `createSubscriptionSession`, portal link |
| `packages/worker/src/index.ts:1-8` | Add scheduler loop, update header diagram |
| `packages/worker/src/scheduler.ts` | New: due-brand claim, cadence throttle, job insert |
| `packages/worker/src/queue.ts:113` | `markFailed` branches on `origin` |
| `packages/worker/src/result-writer.ts:71` | Compute + upsert `run_metrics` |
| `packages/shared/src/config.ts` | Add `BrandTrackingSchema`, cadence types |
| `scripts/backfill-run-metrics.ts` | New: one-off backfill |
| `scripts/invite-existing-customers.ts` | New: one-off password-setup invite |
| `DESIGN.md` | Add dashboard patterns: trend chart, standfirst, empty states |
| `TODOS.md:115` | Remove the v2 deferral; this epic supersedes it |

---

## Out of Scope

- **Dark mode.** DESIGN.md defers it to v2; a dashboard does not change that.
- **Team accounts / seats.** One `auth.users` row owns brands. Multi-user orgs are a separate epic.
- **White-label / agency tier.** TODOS.md defers it; unlimited brands is not the same as reselling.
- **Alerting on citation-rate drops.** Obvious next feature, but it needs a trend baseline that only exists after this ships.
- **Editing prompts retroactively.** Prompt edits apply to future runs. Rewriting history would invalidate the trend.
- **Hard-deleting brands.** Archive only.
- **Per-tenant worker rate limiting.** TODOS.md deferred it; the D12 cadence throttle bounds load enough for this scale.
- **Pricing iteration past $29/mo.** Revisit after 20+ subscribers, same rule as the one-shot.

---

## Working Prototype (built 2026-08-11)

A running slice of E1, E3, E4, and E5 exists in the repo against the local
Supabase stack. It is real: real routes, real Postgres rows, real RLS.

```bash
bun run db:start                        # local Supabase, ports 54331-54339
supabase db reset                       # applies 0001-0005
bun run --cwd packages/web seed:demo    # 3 brands, 20 runs, active subscription
bun run --cwd packages/web verify:rls   # proves cross-tenant isolation
bun run dev:web                         # http://localhost:3000/login
```

Sign in with `demo@openllmrank.io` / `demo-password-123` (password mode).

**Seeded to exercise all three dashboard states at once:**

| Brand | Runs | Story | State exercised |
|---|---|---|---|
| Linear | 11 | 18% → 41% | Full trend view, "up from" standfirst |
| Cal.com | 8 | 31% → 28% with a dip | "down from" standfirst |
| Resend | 1 | 22% | Single-run state, no trend claim |

Three brands also exceeds `SCHEDULER_WEEKLY_MAX_BRANDS=2`, so the D12 cadence
throttle is visible: every brand sits at monthly, and the UI says why.

**What is real in the prototype:** magic-link + password sign-in, session
cookies via `@supabase/ssr`, middleware guarding `/dashboard/*`, every read
through `userClient()` under RLS, the generated standfirst, the inline-SVG
trend chart, rate bars, per-provider breakdown, run history with origin
badges, brand list, cadence-throttle disclosure, and the subscription gate on
add-brand.

**What is stubbed:** Stripe subscription checkout and the Billing Portal link
(buttons render disabled), the add-brand wizard body, and the manual re-run
button. E2 (signed report links), E6 (subscriptions), E7 (scheduler), and E8
(refund fix) are specified but not built.

**Known prototype gap:** the seed writes `jobs`, `runs`, and `run_metrics` but
not `calls` / `citations` (that is ~150 rows of raw provider output per run ×
20 runs). `/reports/<id>` therefore renders its shell with empty data rather
than a populated report. The dashboard reads only `run_metrics`, so it is
unaffected.

`verify:rls` output, which is the claim that matters most:

```
As demo@openllmrank.io (anon key + session, RLS active):
  PASS  sees own brands — 3 brands
  PASS  sees own run_metrics — 20 rows
  PASS  sees own subscription — active
  PASS  sees own jobs — 20 jobs
  PASS  job origins seeded — one_shot, scheduled, manual

As a second user (cross-tenant isolation):
  PASS  sees no other-user brands — 0 rows
  PASS  sees no other-user metrics — 0 rows
  PASS  sees no other-user subscription — 0 rows
  PASS  direct-by-id read of another tenant's brand returns nothing — 0 rows
```

Two bugs the prototype caught that a static mockup would not have:
`.rate-fill` rendered as an inline box so every bar was empty, and the
"biggest gap" copy read "you trail by 0 points" for a brand that was actually
leading.

---

## Open Risk

**Weekly cadence at $29/mo has a 53% gross margin at one brand, before Stripe fees,
Railway, and Supabase.** The D12 throttle bounds the downside, but the upside is thin.
Two things worth measuring in the first 30 days: actual `cost_usd_total` per run (the
column already exists on `jobs`), and how many subscribers add a second brand. If real
per-run cost lands above ~$3, weekly at $29 stops working and cadence or price has to
move. The env-var threshold is designed so that adjustment is a config change.
