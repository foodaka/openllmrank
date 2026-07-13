# TODOS

Tracked work outside the current sprint. Items marked **v1 MUST** are required for the hosted-webapp v1 launch; items marked **v2** are explicit deferrals.

---

## v1 MUST (added by /plan-design-review, 2026-05-17)

### Run /design-consultation BEFORE web build

**What:** Run `/design-consultation` to produce a formal `DESIGN.md` in repo root, plus font preview pages and color preview pages, seeded from the editorial system already shipping in `src/core/render-html.ts` line 84.

**Why:** Today the entire editorial design system (paper, ink, moss, terra cotta, Georgia, kicker style) exists only as inline CSS in render-html.ts. Once `packages/web` and `packages/worker` are added, contributors will invent new colors and typography unless the system is codified. /plan-design-review extracted the tokens for this review; /design-consultation produces the proper artifact.

**Pros:** Single source of truth for any future surface; future agents stay on-brand without supervision; matches the user's "I value ASCII diagrams highly" / explicit-over-clever preferences.

**Cons:** ~20 minutes of additional planning work before web build starts.

**Context:** Pass 5 of /plan-design-review (2026-05-17) extracted the tokens and recommended formalizing in DESIGN.md.

**Depends on:** Nothing — can run immediately.

### Generate mobile mockups (when OpenAI image API quota resets)

**What:** Generate mobile (375px) mockups for marketing hero, wizard step 1, and order-received email. Place in `~/.gstack/projects/foodaka-openllmrank/designs/<screen>-mobile-<date>/`.

**Why:** /plan-design-review on 2026-05-17 produced desktop mockups but hit OpenAI image API quota (429) while generating mobile. Issue 6.1 specifies the stacking order in text; mobile mockups make it concrete. >50% of marketing traffic is mobile.

**Pros:** Engineer builds from picture, not interpretation; closes the responsive gap with visual evidence.

**Cons:** Requires OpenAI image API quota to reset; ~10 min of generation time.

**Context:** Desktop mockups at `~/.gstack/projects/foodaka-openllmrank/designs/marketing-hero-20260517/variant-A.png` and `wizard-step1-20260517/variant-A.png` are the visual anchors. Mobile follows Issue 6.1 spec.

**Depends on:** OpenAI image API quota refresh.

### v1 launch-day checklist: Stripe Checkout branding

**What:** Before flipping Stripe to live mode, configure Stripe Checkout branding in the Dashboard:
- Upload `openllmrank` wordmark on transparent background as logo
- Set brand color to `#376b5b` (moss)
- Upload product icon (small moss circle on cream)
- Customize button text to match site voice

**Why:** Issue 7.1 of /plan-design-review locked the decision; default Stripe purple clashes with the editorial moss-green system. Customers click Pay → land on a discontinuous purple checkout → trust dip at the most critical moment of the funnel.

**Pros:** Zero code; preserves brand continuity through the payment screen.

**Cons:** Easy to forget between dev and prod; needs explicit checklist placement.

**Context:** 5 min in Stripe Dashboard. Do BEFORE setting STRIPE_SECRET_KEY in Railway production env vars.

**Depends on:** Stripe account setup.

---

## v1 MUST (added by /plan-eng-review, 2026-05-17)

### 1. Email outbox retry (parallel to refund outbox)

**What:** Add `email_status` column to `jobs` table; worker sets pending before calling Postmark, sent on success, leaves pending on error. Reuse refunder cron's polling loop to retry pending emails every 10 min; admin alert (Discord) after 6 attempts / 1hr.

**Why:** Failure-mode audit found Postmark outage = report generated, customer paid, no email. Customer waits, files chargeback. Same blast radius as a missed refund, but currently unhandled.

**Pros:** Closes the only critical gap from the failure-mode audit. Reuses refunder plumbing. ~20 LOC.

**Cons:** Adds one more polling loop; one more `*_status` column on `jobs`.

**Context:** The refunder pattern is the canonical "external API outage doesn't leak failure to user" pattern. Email is the actual product delivery — losing it is worse than losing a refund.

**Depends on:** Issue 1.7 refunder cron landing first (provides the polling-loop template).

### 2. Server-side wizard config cap validation

**What:** The shared Zod `ConfigSchema` in `packages/shared/src/config.ts` must enforce `prompts.max(10)`, `samples_per_prompt.max(3)`, `providers.max(2)`. Wizard form uses the same schema (client UX) AND `/api/checkout` re-validates server-side. Reject oversized configs with 400.

**Why:** Without server-side validation, anyone who knows curl can POST a config with 1,000 prompts. Stripe charges $29.99; worker accepts the job; OpenAI API bill is $25+. Unit economics blown by a 30-second script.

**Pros:** Standard web security; single source of truth for the cap (one Zod schema in shared package); UX and server enforcement stay synchronized.

**Cons:** None — basic hygiene.

**Context:** The whole reason we're charging $29.99 is the 60-call cap protects margin. The cap must be enforceable at every layer, not just the React form.

**Depends on:** Issue 1.1 monorepo + `packages/shared` landing.

### 3. ASCII state diagrams in the two non-obvious new files

**What:** Add ASCII diagrams to:
- `packages/worker/src/index.ts` — job state machine: `pending → claimed → running → completed | failed → (if failed) refunding → refunded`
- `packages/web/app/api/webhook/stripe/route.ts` — webhook lifecycle: verify signature → type dispatch → idempotent insert → 200

**Why:** User preference: "I value ASCII art diagrams highly." These two files have the highest confusion-per-line in the new code; future-you (or contributors) will need them.

**Pros:** Onboarding cost for new contributors drops; debugging stale-job issues becomes obvious.

**Cons:** Maintenance discipline: must update the diagram whenever the state machine changes. Reviewer checks on every PR.

**Context:** Stripe webhook flows confuse everyone the first time. The worker's state machine has 5 states + 3 error paths; a 12-line diagram captures it more clearly than 200 lines of prose.

**Depends on:** Worker and webhook code being written.

---

## v1.1 / v2 (explicitly deferred from /plan-eng-review)

### Recurring subscription tier

**What:** "Subscribe for $29/mo to get this weekly" CTA in the report email. Stripe subscription, scheduler, jitter, fairness — all the stuff cut from v1.

**Why deferred:** v1 validates whether the buyer exists. Subscription only makes sense AFTER 20+ one-time customers signal repeat intent (via the email CTA click rate).

**Trigger to start:** ≥20% of report-email recipients click the CTA in the first 30 days post-launch.

### Live dashboard / charts / login-to-view

**What:** Logged-in view of run history, citation trends, competitor leaderboards.

**Why deferred:** Email is enough for v1. Dashboard is a v2 retention feature, not a v1 conversion feature.

**Trigger to start:** Recurring tier launched AND ≥5 active subscribers.

### Multi-brand per user

**What:** Wizard step lets one user track multiple brands.

**Why deferred:** Schema is built (FK `brands.user_id` already implies one-to-many). Wizard UI is single-brand. Unlock when first customer asks for it.

### White-label / agency tier

**What:** Multi-tenant within a customer (agency has 20 clients).

**Why deferred:** Different buyer (agency owner, not in-house marketer). Validate the in-house marketer buyer FIRST before splitting target.

### Schema-per-tenant Postgres isolation

**What:** Replace RLS with per-tenant schemas.

**Why deferred:** Only matters if/when an enterprise customer demands stricter isolation. v3+.

### Per-tenant rate limiting in worker

**What:** Token-bucket rate limits to prevent one heavy customer from starving others.

**Why deferred:** Collapsed by the one-shot-per-signup pivot in Issue 1.4. Customers don't share a queue at signup rate.

### Multiple OpenAI org keys

**What:** Rotate across 2-3 OpenAI accounts for higher aggregate rate limit.

**Why deferred:** Not needed at v1 scale. Operational + ToS concerns.

### Pricing iteration past $29.99

**What:** Increase to $49 / $79 / $149 once demand validated; introduce tiers.

**Why deferred:** $29.99 is the validation price. Iterate ONLY after 20+ paid one-time customers.

### Concierge as ongoing offering

**What:** "Pay $499, we hand-craft your report."

**Why deferred:** Concierge is week 0 validation, not a long-term offering. Time cost outweighs revenue past 5 customers.

---

## Completed

### Gemini, Perplexity, and xAI providers

Grounded provider adapters, registry metadata, pricing, error normalization, documentation, and tests shipped together.

**Completed:** v0.3.0 (2026-07-13)
