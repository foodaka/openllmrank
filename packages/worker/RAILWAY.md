# Deploying the worker to Railway

The worker (this package) runs on Railway. The Next.js webapp goes to
Vercel separately. They communicate via the shared Supabase Postgres.

## What's already set up

- `railway.toml` at repo root tells Railway how to build + run.
- Nixpacks auto-detects Bun via `bun.lock` and installs the workspace.
- Start command: `bun run packages/worker/src/index.ts`.
- `restartPolicyType=ON_FAILURE` with max 10 retries — graceful crash
  recovery without infinite restart loops.

## What you do in the Railway dashboard

### 1. Create a project + service

```bash
# From the repo root, where railway.toml lives:
railway init
# Choose "Create a new project" → name it "openllmrank-worker" (or similar)
```

This creates a Railway project linked to this directory. Don't deploy
yet — set env vars first.

### 2. Link the GitHub repo (optional but recommended)

In the Railway dashboard:
1. Open the project you just created.
2. Click your service → **Settings** → **Source**.
3. Connect to GitHub and select `foodaka/openllmrank`.
4. Set **Watch Paths** so deploys only fire on relevant changes:
   ```
   packages/worker/**
   packages/cli/**
   packages/shared/**
   railway.toml
   bun.lock
   ```
5. Set **Branch** to `main` (and optionally enable PR previews).

Without GitHub integration you can still deploy via `railway up` from
your laptop, but the auto-deploy on push to main is the conventional
production setup.

### 3. Set env vars

Open **Variables** in the service and add:

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | Hosted Supabase DIRECT connection (NOT pooler) | Project Settings → Database → "Direct connection". The worker holds a long-lived connection; the pooler isn't right for that. |
| `OPENAI_API_KEY` | `sk-...` | The only place this key lives in production (Issue 1.5 of /plan-eng-review). |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Same — never goes to Vercel. |
| `STRIPE_MODE` | `test` (or `live` when you flip) | |
| `STRIPE_SECRET_KEY` | `sk_test_...` | For refund API calls. |
| `POSTMARK_MODE` | `live` (once you have a token) | Starts as `local_stub` if you haven't signed up for Postmark yet. |
| `POSTMARK_SERVER_TOKEN` | From Postmark dashboard | Required if `POSTMARK_MODE=live`. |
| `POSTMARK_FROM` | `reports@openllmrank.com` | Verified sender. |
| `POSTMARK_FROM_NAME` | `openllmrank` | |
| `WORKER_ID` | `railway-prod-1` | Optional; defaults to `worker-<pid>`. |
| `WORKER_POLL_INTERVAL_MS` | `5000` | Default OK. |
| `WORKER_LEASE_TIMEOUT_MS` | `1800000` | 30 min. Default OK. |
| `CLI_RUN_TIMEOUT_MS` | `1200000` | 20 min. Default OK. |
| `ADMIN_ALERT_DISCORD_WEBHOOK` | (optional) | If set, alerts go here on failed runs / exhausted refunds. |

### 4. Deploy

If using GitHub integration: push to main and watch the deploy in the
dashboard. The first deploy takes 2-3 min (image build + install).

If using CLI:
```bash
railway up
```
This uploads the current working tree and runs the build. Logs stream
in your terminal until the deploy completes.

### 5. Watch logs

```bash
railway logs
```

You should see:
```
[worker] starting (id=worker-<pid>)
[worker] stripe mode: test
[worker] postmark mode: live
[worker] poll interval: 5000ms
```

…and then it polls quietly waiting for paid jobs. The first time someone
pays through the live webapp, you'll see:
```
[worker] claimed job=<uuid> brand=<uuid> (attempt 1)
[worker] job=<uuid> completed: <N> succeeded, 0 failed, $<cost>
```

## Cost expectation

Railway charges by resource use. A worker that polls every 5s and
processes the occasional ~10-minute LLM job costs roughly $5-10/month
at v1 scale (1-50 paid customers/week). Railway's free trial includes
$5 of credit to start.

## Common failures + fixes

- **"connection refused"** on first deploy → DATABASE_URL might be the
  pooler URL. Use Direct connection (port 5432, not 6543).
- **"FATAL: password authentication failed"** → DATABASE_URL has the wrong
  password. Get a fresh one from Project Settings → Database → "Reset
  database password".
- **Worker hangs at "starting"** → check DATABASE_URL is reachable from
  Railway's region. If your Supabase is in a different region, latency
  is fine but firewall could block; check Supabase Network Restrictions.
- **`bun: command not found`** → Nixpacks should auto-install Bun. If it
  doesn't, set `RAILWAY_NIXPACKS_CONFIG_FILE` to point at a custom
  `nixpacks.toml`. Shouldn't be needed; flag if it happens.
