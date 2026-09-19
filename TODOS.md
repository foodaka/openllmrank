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

## Crawl check follow-ups (added by /plan-eng-review, 2026-08-15)

### Open-source indexability skill for Hermes + Claude Code

**What:** Publish a skill repo wrapping `packages/crawl`'s check rules as a diagnosis playbook users install into their own agent (Hermes, Claude Code, Cursor). Their agent crawls the site locally, diagnoses, and opens the fix PR with their own credentials; Hermes's natural-language cron covers scheduled re-checks at zero infra cost to us. Report output carries a "powered by openllmrank.io" footer linking to the web check and paid report.

**Why:** Reaches the Hermes and Claude Code ecosystems the web check can't; the founder's original wish ("Hermes runs a cron for the sites") lands here.

**Pros:** ~1 CC day once the engine exists; engine already fully tested; strong X-launch material into two agent communities.

**Cons:** Install-gated reach — only agent users; weaker funnel than report URLs on our domain.

**Context:** Approach C in design doc `markhinschberger-main-design-20260815-094212.md` (approved 2026-08-15). Prompt-injection fencing rules from eng review decision 5A apply to the skill's playbook too — site-derived text is untrusted data.

**Depends on:** `packages/crawl` shipped (milestone 1 of the crawl-check build).

### Split the crawl loop into its own Railway service

**What:** Move the crawl loop out of the shared worker process into a second Railway service (entrypoint + railway config split, ~1 CC hour). Code structure already permits it: separate loop, separate `crawl_checks` table.

**Why:** Eng review decision 8A (2026-08-15) kept crawls in the shared worker with guards (own try/catch, size/time caps, memory bounds) because paid volume is low and a split is cheap later. This TODO records the escape hatch and its trigger.

**Trigger:** Any incident where a crawl crash or restart delays a paid job, OR sustained >50 crawls/day.

**Pros:** True isolation for the paid-job SLA; no shared event loop, memory, or lifecycle.

**Cons:** Second deploy target + idle cost; not justified before external demand exists.

**Depends on:** Nothing — can execute the moment the trigger fires.

---

## Agent / MCP connector follow-ups (added by /ship, 2026-09-19)

### Submit the Muse connector

**What:** Work through the checklist in `docs/muse/SUBMISSION.md`: deploy + migration 0011, Stripe profile + agentic seller terms, one test-mode and one live Shared Payment Token purchase, 512×512 icon, support mailbox, then the form at muse.ai/platform (owner-only attestations).

**Why:** `/api/mcp` only reaches Muse users once Meta approves the listing. Meta tests end to end, so the endpoint and a real payment must work first.

### Durable rate limits for `/api/mcp`

**What:** Move the per-caller limits in `lib/mcp-server.ts` from the in-memory `lib/rate-limit.ts` to a durable, shared counter, and create the fallback Checkout session only when an agent asks for it.

**Why:** Hosted agent platforms share a few egress IPs, so per-IP limits are either too tight for real users or too loose to mean much. Paid work is already gated by payment; this is about keeping the free tools fair.

### Reconcile agent payments from Stripe events

**What:** Handle `payment_intent.succeeded` with `metadata.source = "mcp"` in the Stripe webhook: if no job exists for that PaymentIntent, provision it (or refund). The unique indexes from migration 0011 make this safe to run alongside `pay_for_report`.

**Why:** `pay_for_report` refunds on every failure it can see, but a function killed between the charge and the job insert (timeout, instance recycle) sees nothing. Recovery then depends on the agent retrying with the same token inside Stripe's 24h idempotency window. The webhook should be the backstop, as it is for Checkout.

### Land competitor suggestions, then offer them to agents

**What:** Commit `8966297` ("website draft also suggests competitors") is on `feat/dashboard-website-assist` but never reached main, although PR #51's description promises it. Land it, then return suggested competitors from `discover_ai_questions` so an agent does not have to guess them.

**Why:** `analyze_brand_visibility` requires at least one competitor and today the calling agent must invent them.

### OAuth (PKCE) for signed-in agents

**What:** Let an agent act as an openllmrank account: list existing reports, trigger tracked-brand re-runs, read trends. Muse's form lists "OAuth with PKCE" as a supported auth method.

**Why:** v1 is guest purchase only. Existing $49/mo subscribers get nothing from the connector yet, and subscriptions cannot be sold with single-amount payment tokens.

## Completed

### Gemini, Perplexity, and xAI providers

Grounded provider adapters, registry metadata, pricing, error normalization, documentation, and tests shipped together.

**Completed:** v0.3.0 (2026-07-13)
