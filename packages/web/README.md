# @openllmrank/web

The hosted Next.js app for openllmrank. Marketing landing page, signup wizard,
Stripe checkout, and webhook handler. Talks to the same `@openllmrank/shared`
schemas the CLI uses.

## Local development

You can run the entire webapp end-to-end without a Stripe, Supabase, or
Postmark account. `local_stub` mode is the default.

### Prereqs

- [Bun](https://bun.sh) 1.3+
- Docker (for `supabase start`)
- [Supabase CLI](https://supabase.com/docs/guides/local-development) — `brew install supabase/tap/supabase`

### One-time setup

```bash
# From repo root:
bun install            # install all workspaces

# Bring up the local Postgres + auth stack (first run pulls ~1GB of images)
bun run db:start
```

This prints local Supabase URLs and keys. The defaults are already wired
into `packages/web/.env.example`; copy it to `.env.local` and you're done:

```bash
cd packages/web
cp .env.example .env.local
```

### Run the webapp

```bash
# From packages/web/ (or `bun run dev:web` from repo root):
bun run dev
```

Visit <http://localhost:3000>. Marketing page → wizard → Stripe checkout (stub) → success page.

In stub mode, the success page automatically fires a synthetic webhook to
`/api/webhook/stripe`, which flips the job row in Postgres to `status='paid'`.
That row is what the Railway worker will eventually pick up.

### Switching off local-stub later

When you have a Stripe test account:

```env
STRIPE_MODE=test
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

Then use `stripe listen --forward-to http://localhost:3000/api/webhook/stripe`
to relay real webhook events from Stripe to your local server.

When you have a Supabase project (instead of local dev):

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

And run `supabase db push` once to apply the migration to the remote project.

## Architecture

```
                                 ┌────────────────┐
   Marketing /  ────────────────▶│ /wizard/brand  │
                                 │  /competitors  │
                                 │  /prompts      │
                                 │  /review       │
                                 └───────┬────────┘
                                         │ POST /api/checkout
                                         ▼
                                 ┌────────────────┐
                                 │  Validate via  │
                                 │ HostedConfig   │
                                 │  Zod schema    │
                                 └───────┬────────┘
                                         │ insert brand + pending job
                                         │ create Stripe checkout session
                                         ▼
                                 ┌──────────────────────────┐
                                 │  Stripe Checkout         │
                                 │  (or local_stub bounce)  │
                                 └──────────┬───────────────┘
                                            │ webhook on success
                                            ▼
                                 ┌──────────────────────────┐
                                 │  POST /api/webhook/stripe│
                                 │  verify signature        │
                                 │  idempotent INSERT to    │
                                 │  stripe_events           │
                                 │  update jobs.status=paid │
                                 └──────────────────────────┘
                                            │
                                            ▼
                                     Railway worker
                                     picks up the job
                                     (not in this package)
```

## Testing

```bash
# Root regression (includes shared + CLI tests):
bun test

# RLS tests require local Supabase to be running:
bun run db:start
bun test packages/shared/test/rls.test.ts
```

## File layout

```
packages/web/
├── app/
│   ├── layout.tsx              # editorial typography + globals
│   ├── page.tsx                # marketing landing
│   ├── wizard/
│   │   ├── wizard-shell.tsx    # shared chrome (kicker + headline + Back/Next)
│   │   ├── brand/page.tsx      # step 1: brand, website, and category
│   │   ├── competitors/page.tsx
│   │   ├── prompts/page.tsx
│   │   └── review/page.tsx
│   ├── checkout/
│   │   ├── success/page.tsx    # also fires stub webhook in local_stub mode
│   │   └── cancel/page.tsx
│   └── api/
│       ├── checkout/route.ts        # POST: create Job + Stripe session
│       └── webhook/stripe/route.ts  # POST: verify + mark paid
├── lib/
│   ├── supabase-server.ts      # anonClient + serviceClient
│   ├── stripe.ts               # createCheckoutSession + verifyWebhook (stub-aware)
│   └── wizard-state.ts         # localStorage-backed wizard state
├── styles/
│   └── globals.css             # imports design tokens, editorial CSS
└── .env.example
```

## License

Private package, part of the openllmrank monorepo. The CLI it sits on top of
(`packages/cli`) is MIT-licensed and on npm.
