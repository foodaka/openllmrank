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
                        ├── calls ──────────► OpenAI + Anthropic APIs
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
NEXT_PUBLIC_SITE_ORIGIN=https://app.openllmrank.com   # or your domain
```

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
3. **Events to send**: select `checkout.session.completed` (minimum). Also worth including `charge.dispute.created` and `payment_intent.payment_failed` for future use.
4. **Reveal signing secret** after creation. Copy `whsec_test_...`
5. Paste this into Vercel's `STRIPE_WEBHOOK_SECRET` env var (overwriting the placeholder from 1.2)
6. Click **Redeploy** in Vercel so the new env var takes effect.

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
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
# ^ Use Supabase's "Session pooler" connection string. NOT Direct connection.
# NOT Transaction pooler (port 6543).
#
# Supabase Settings → Database → Connection string → "Session pooler" tab.
#
# Why session pooler:
#   - Bun.SQL uses prepared statements by default
#   - Transaction pooler (port 6543) drops connections after each transaction
#     and doesn't support prepared statements → every query fails with
#     "Connection closed"
#   - Direct connection works on IPv6-only on the free tier; Railway
#     containers often can't reach it depending on region
#   - Session pooler supports prepared statements + holds connections
#     open for long-lived workers like ours — the right primitive

OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

STRIPE_MODE=test
STRIPE_SECRET_KEY=sk_test_...           # same as Vercel

POSTMARK_MODE=local_stub                # flip to "live" after step 3
POSTMARK_SERVER_TOKEN=                  # leave empty until step 3
POSTMARK_FROM=reports@openllmrank.com
POSTMARK_FROM_NAME=openllmrank

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

- [ ] Stripe Live mode webhook configured + signing secret in Vercel
- [ ] Vercel STRIPE_MODE=live; Railway STRIPE_MODE=live
- [ ] Postmark in live mode (you've verified DNS)
- [ ] Your sample-report.html link works in production (`https://app.openllmrank.com/sample-report.html`)
- [ ] Test card 4242 4242 4242 4242 NO LONGER WORKS in production (Stripe live mode rejects test cards) — verify with your own real card if you want, then refund yourself
- [ ] (Optional) /healthz endpoint added for monitoring
- [ ] (Optional) Sentry DSN added to both web + worker for error monitoring
- [ ] (Optional) Plausible analytics added to web

## Troubleshooting

**"Connection closed" repeated on every query (job_loop/refunder/email-retry tick failures)** — DATABASE_URL is the Transaction pooler URL (port 6543). Transaction pooler closes connections after each transaction and doesn't support prepared statements; Bun.SQL uses prepared statements by default, so every query fails. Fix: switch to **Session pooler** URL (Supabase Settings → Database → Connection string → "Session pooler" tab). Port 5432, supports prepared statements and persistent connections.

**"connection refused" on first Railway deploy** — DATABASE_URL is missing or malformed. Verify the env var is set in Railway → Variables. Common issues: extra whitespace, surrounding quotes that shouldn't be there, missing `:5432/postgres` suffix.

**Webhook signature verification fails** — `STRIPE_WEBHOOK_SECRET` in Vercel doesn't match what Stripe Dashboard shows. Re-copy from Stripe Dashboard → Developers → Webhooks → click endpoint → Signing secret.

**Vercel build fails with "Cannot find module @openllmrank/shared"** — `vercel.json` should run `bun install` from repo root via the buildCommand. Verify the file matches what's in main.

**Railway build fails with "bun not found"** — Nixpacks should auto-install Bun via the `[build.nixpacksConfig] providers = ["bun"]` setting in railway.toml. If not, add `oven-sh/setup-bun` to a Dockerfile and switch builder to DOCKERFILE.

**Worker polls but never claims a job** — likely the `DATABASE_URL` env var is missing or wrong. Worker logs will show `Missing required env var: DATABASE_URL` if not set.

**Tests fail in CI but pass locally** — known: Linux Bun handles `process.stdin` async iterator differently. We use `Bun.stdin.text()` to dodge this. If you add more stdin-using tests, follow the same pattern.
