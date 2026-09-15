# Production deployment — first-time walkthrough

This walks you from a fresh main branch to a live URL accepting Stripe
sandbox payments end-to-end. **Real money is not at risk** until you flip
`STRIPE_MODE=live` (see "Going live" at the bottom).

Two services live in two different places:

```
                   ┌──────────────────────┐
                   │  Browser             │
                   │  https://your-domain │
                   └──────────┬───────────┘
                              │
                              ▼
   ┌────────────────────────────────────────┐
   │  Vercel (Next.js webapp)               │
   │  packages/web — marketing, wizard,     │
   │  /api/checkout, /api/webhook/stripe    │
   └────────────────────┬───────────────────┘
                        │
                        ├── reads/writes ──► Supabase Postgres (hosted)
                        │                    leads, brands, jobs, etc.
                        │
                        └── webhook reaches ───► /api/webhook/stripe
                                                 (Stripe Dashboard config)
                              ▲
                              │
                   ┌──────────┴──────────┐
                   │  Stripe Checkout    │
                   └─────────────────────┘

   ┌────────────────────────────────────────┐
   │  Railway (Bun worker)                  │
   │  packages/worker — polls jobs,         │
   │  subprocesses the CLI, sends emails    │
   └────────────────────┬───────────────────┘
                        │
                        ├── reads/writes ──► Supabase Postgres (same project)
                        ├── calls ──────────► configured grounded provider APIs
                        └── sends emails ───► Postmark
```

## Pre-checks

- [ ] PR #2 (or successor) merged to main
- [ ] CI is green on main (the `test` workflow)
- [ ] You have these accounts: GitHub, Supabase, Stripe, Vercel, Railway, Postmark, domain registrar

## Step 1 — Vercel (Next.js webapp)

### 1.1 Connect repo

In https://vercel.com/dashboard:

1. **Add New → Project** → import `foodaka/openllmrank`
2. **Root Directory**: leave as monorepo root (Vercel auto-detects `vercel.json` which handles the rest)
3. **Framework Preset**: Next.js (auto-detected)
4. Don't deploy yet — set env vars first.

### 1.2 Env vars (Settings → Environment Variables)

Set these for **Production** environment:

```
NEXT_PUBLIC_SUPABASE_URL=https://yarcmnipzvpiroegeygx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from Supabase Settings → API → anon public key>
SUPABASE_SERVICE_ROLE_KEY=<from Supabase Settings → API → service_role secret>

STRIPE_MODE=test
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_test_...   # set after step 1.4 below
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

PRICE_CENTS=2999
PRODUCT_NAME=openllmrank AI-search visibility report
NEXT_PUBLIC_SITE_ORIGIN=https://openllmrank.io        # REQUIRED: magic-link, invite, and Stripe return URLs

# Dashboard + subscriptions (login-dashboard epic)
SUBSCRIPTION_PRICE_CENTS=2900
SUBSCRIPTION_PRODUCT_NAME=openllmrank tracking
MANUAL_RERUNS_PER_MONTH=2
REPORT_LINK_SECRET=<openssl rand -hex 32>             # REQUIRED; identical on Railway

# Account invite + order-received emails are sent from the web app too
POSTMARK_MODE=live
POSTMARK_SERVER_TOKEN=<same as Railway>
POSTMARK_FROM=reports@openllmrank.io
POSTMARK_FROM_NAME=openllmrank
```

### 1.2a Hosted Supabase auth (Authentication → URL Configuration)

Magic links, password-setup invites, and the `/auth/callback` exchange all
depend on the hosted project's redirect allow-list. Local dev is covered by
`supabase/config.toml`; production is configured in the dashboard:

- **Site URL**: `https://openllmrank.io`
- **Redirect URLs**: add `https://openllmrank.io/**` (covers `/auth/callback?next=…` and `/auth/set-password`). Supabase treats the list as exact-match-or-glob; without the `/**` entry `emailRedirectTo` is silently ignored and every magic link lands on the homepage with no error.
- **Email OTP expiry**: 3600 seconds, to match the "expires in an hour" copy in the invite email.
- **Enable sign-ups**: leave on. Checkout provisions accounts through the admin API; the login page only signs in.
- Apply migrations `0006`–`0010` (`supabase db push`) before the first deploy of this version. `0010` revokes browser writes to the scheduler-owned brand columns.

### 1.3 First deploy

Click **Deploy**. You get a temporary URL like
`openllmrank-foodaka.vercel.app`. Visit it; the marketing page should
render. **Don't try checkout yet** — Stripe webhook isn't wired.

### 1.4 Domain + DNS

1. Buy `openllmrank.com` (or your domain) from a registrar
2. Vercel project → **Settings → Domains** → add `openllmrank.com` and `app.openllmrank.com`
3. Vercel shows you the DNS records to add at your registrar:
   - For apex (`openllmrank.com`): `A 76.76.21.21` (or whatever Vercel shows)
   - For `app.openllmrank.com`: `CNAME cname.vercel-dns.com`
4. Add the records at your registrar. DNS propagation: 5-60 min.
5. SSL provisions automatically once DNS resolves.

### 1.5 Stripe webhook config

In https://dashboard.stripe.com/test/webhooks (must be TEST mode toggle on, top-right):

1. **Add endpoint**
2. **Endpoint URL**: `https://app.openllmrank.com/api/webhook/stripe`
3. **Events to send**: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Also worth including `charge.dispute.created` and `payment_intent.payment_failed` for future use. The endpoint's API version is whatever the Dashboard assigns; the handler reads both the pre- and post-Basil field shapes (`current_period_end` at the top level or under `items.data[0]`, invoice subscription at `subscription` or `parent.subscription_details.subscription`).
4. **Reveal signing secret** after creation. Copy `whsec_test_...`
5. Paste this into Vercel's `STRIPE_WEBHOOK_SECRET` env var (overwriting the placeholder from 1.2)
6. Click **Redeploy** in Vercel so the new env var takes effect.

### 1.5a One-shot Stripe setup script

`packages/web/scripts/stripe-setup.sh` does 1.5 and 1.6 idempotently for the
account behind `STRIPE_API_KEY`: creates the two openllmrank Products with
their default Prices ($29/mo tracking, $29.99 report), subscribes the
`/api/webhook/stripe` endpoint to every event the handler acts on (creating
it if missing), and configures the Customer Portal. It prints the
`SUBSCRIPTION_PRICE_ID` / `REPORT_PRICE_ID` values to set on Vercel.

```bash
# live, using the key already on Railway (never echoed):
STRIPE_API_KEY=$(cd packages/worker && railway variables --json | python3 -c "import json,sys; print(json.load(sys.stdin)['STRIPE_SECRET_KEY'])") \
  SITE=https://openllmrank.io packages/web/scripts/stripe-setup.sh
```

### 1.6 Stripe Customer Portal

`/dashboard/billing` → "Manage billing in Stripe" opens a Billing Portal
session. Stripe refuses to create one until the portal is configured once:
**Settings → Billing → Customer portal** → enable, allow customers to cancel
and update payment methods, save. Do this in both test and live mode.

## Step 2 — Railway (Bun worker)

### 2.1 Create project + link repo

From repo root:
```bash
railway init
# Choose: Create new project, name: openllmrank-worker
```

Then in https://railway.app dashboard:
1. Open the project
2. Click your service → **Settings → Source**
3. **Connect Repo**: `foodaka/openllmrank`, branch `main`
4. **Watch Paths**:
   ```
   packages/worker/**
   packages/cli/**
   packages/shared/**
   railway.toml
   bun.lock
   ```
5. **Start Command**: leave empty — `railway.toml` provides it

### 2.2 Env vars (Variables tab)

```
DATABASE_URL=postgresql://postgres:<password>@aws-...pooler.supabase.com:5432/postgres
# ^ Use Supabase's "Direct connection" string, NOT the pooler URL.
# Supabase Settings → Database → "Direct connection"

OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
PERPLEXITY_API_KEY=pplx-...
XAI_API_KEY=xai-...

STRIPE_MODE=test
STRIPE_SECRET_KEY=sk_test_...           # same as Vercel

POSTMARK_MODE=local_stub                # flip to "live" after step 3
POSTMARK_SERVER_TOKEN=                  # leave empty until step 3
POSTMARK_FROM=reports@openllmrank.io
POSTMARK_FROM_NAME=openllmrank
POSTMARK_REPLY_TO=help@openllmrank.io   # optional, monitored reply inbox

REPORT_BASE_URL=https://openllmrank.io
REPORT_LINK_SECRET=<same value as Vercel>  # signs /reports/<id>?t= links in emails

# Scheduler (subscription runs)
SCHEDULER_POLL_MS=60000
SCHEDULER_WEEKLY_MAX_BRANDS=2           # D12 margin guard; accounts above this run monthly

WORKER_ID=railway-prod-1
WORKER_POLL_INTERVAL_MS=5000
WORKER_LEASE_TIMEOUT_MS=1800000
CLI_RUN_TIMEOUT_MS=1200000

ADMIN_ALERT_DISCORD_WEBHOOK=            # optional; failures alert here
```

### 2.3 First deploy

```bash
railway up
```

Or trigger via the dashboard. Watch logs with:
```bash
railway logs
```

Expected output:
```
[worker] starting (id=railway-prod-1)
[worker] stripe mode: test
[worker] postmark mode: local_stub
[worker] poll interval: 5000ms
```

The worker now polls Supabase every 5s waiting for paid jobs.

## Step 3 — Postmark (transactional email)

### 3.1 Sign up + verify sender domain

In https://account.postmarkapp.com:
1. Create server (e.g., "openllmrank-prod")
2. **Sender Signatures → Add Domain**: `openllmrank.com`
3. Postmark shows DNS records — add them at your registrar:
   - `DKIM`: `TXT` record with their key
   - `Return-Path`: `CNAME` record
4. Wait for verification (usually <30 min)
5. **API Tokens → Server API Token**: copy

### 3.2 Wire into Railway

In Railway dashboard:
1. **Variables** → update:
   ```
   POSTMARK_MODE=live
   POSTMARK_SERVER_TOKEN=<paste>
   REPORT_BASE_URL=https://app.openllmrank.com
   ```
2. Railway auto-redeploys on env change.

### 3.3 Also update Vercel

The webhook handler in `packages/web/app/api/webhook/stripe/route.ts`
also sends the order-received email. So set in Vercel too:

```
POSTMARK_MODE=live
POSTMARK_SERVER_TOKEN=<same token>
POSTMARK_FROM=reports@openllmrank.com
POSTMARK_FROM_NAME=openllmrank
```

Redeploy from Vercel after env change.

## Step 4 — Smoke test the live URL

1. Visit `https://app.openllmrank.com`
2. Click **Get my report — $29.99**
3. Fill the wizard: real brand name, 1-2 competitors, 1-3 prompts, your real email
4. Click **Pay & generate report** — redirected to `checkout.stripe.com` (test mode)
5. Pay with test card `4242 4242 4242 4242`, any future expiry, any CVC
6. Redirected to `/checkout/success`
7. **Check Stripe Dashboard → Developers → Webhooks** → see the event delivered with HTTP 200
8. **Check your email** — you should receive the order-received email within ~10s
9. **Check Railway logs** — within 5s, the worker claims the job and starts running. Log lines like `[worker] claimed job=...`
10. After 8-15 min, **check your email again** — the actual report email arrives
11. **Inspect Supabase tables**: 1 row in `auth.users`, 1 in `brands`, 1 in `leads` (status=converted), 1 in `jobs` (status=completed)

If anything errors:
- Stripe Dashboard → Webhooks → click the failed event → see error from our endpoint
- Vercel → project → **Logs** → filter by the request id
- Railway → service → **Logs** → look for the job_id

## Going live (real money)

When ready to take real payments:

### Stripe side

1. Stripe Dashboard, toggle from Test mode → Live mode (top-right toggle)
2. **Developers → API keys** — copy `sk_live_...` and `pk_live_...`
3. **Developers → Webhooks** → **Add endpoint** for live mode (same URL `https://app.openllmrank.com/api/webhook/stripe`, same events). Copy the new `whsec_live_...`
4. Stripe Dashboard → **Settings → Branding** — upload logo, set color `#376b5b`, configure checkout customization (per TODOS.md v1 MUST item)

### Vercel side

Update env vars (production environment):
```
STRIPE_MODE=live
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```
Redeploy.

### Railway side

Update env vars:
```
STRIPE_MODE=live
STRIPE_SECRET_KEY=sk_live_...
```
Railway auto-redeploys.

### Final pre-launch checklist

- [ ] Stripe Live mode webhook configured + signing secret in Vercel, subscribed to the five events in 1.5
- [ ] Stripe Customer Portal enabled in live mode (1.6)
- [ ] `REPORT_LINK_SECRET` set and identical on Vercel and Railway
- [ ] `NEXT_PUBLIC_SITE_ORIGIN=https://openllmrank.io` on Vercel; Supabase Site URL + Redirect URLs set (1.2a)
- [ ] Migrations 0006–0010 applied to the hosted database
- [ ] Sign in with a real account, add a brand, confirm the worker log shows `[scheduler] queued job=…` within a minute
- [ ] Vercel STRIPE_MODE=live; Railway STRIPE_MODE=live
- [ ] Postmark in live mode (you've verified DNS)
- [ ] Your sample-report.html link works in production (`https://app.openllmrank.com/sample-report.html`)
- [ ] Test card 4242 4242 4242 4242 NO LONGER WORKS in production (Stripe live mode rejects test cards) — verify with your own real card if you want, then refund yourself
- [ ] (Optional) /healthz endpoint added for monitoring
- [ ] (Optional) Sentry DSN added to both web + worker for error monitoring
- [ ] (Optional) Plausible analytics added to web

## Troubleshooting

**"connection refused" on first Railway deploy** — DATABASE_URL is the pooler URL. Use Direct connection (port 5432, not 6543).

**Webhook signature verification fails** — `STRIPE_WEBHOOK_SECRET` in Vercel doesn't match what Stripe Dashboard shows. Re-copy from Stripe Dashboard → Developers → Webhooks → click endpoint → Signing secret.

**Vercel build fails with "Cannot find module @openllmrank/shared"** — `vercel.json` should run `bun install` from repo root via the buildCommand. Verify the file matches what's in main.

**Railway build fails with "bun not found"** — Nixpacks should auto-install Bun via the `[build.nixpacksConfig] providers = ["bun"]` setting in railway.toml. If not, add `oven-sh/setup-bun` to a Dockerfile and switch builder to DOCKERFILE.

**Worker polls but never claims a job** — likely the `DATABASE_URL` env var is missing or wrong. Worker logs will show `Missing required env var: DATABASE_URL` if not set.

**Tests fail in CI but pass locally** — known: Linux Bun handles `process.stdin` async iterator differently. We use `Bun.stdin.text()` to dodge this. If you add more stdin-using tests, follow the same pattern.
