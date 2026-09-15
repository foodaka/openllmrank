# Design Brief — openllmrank Dashboard

> **Handoff document.** Give this to a design agent or designer working on the
> dashboard surfaces. It is self-contained: you do not need to read the
> engineering spec to do this work.
>
> Companion docs: [DESIGN.md](./DESIGN.md) is the system of record and
> overrides anything here that contradicts it. [SPEC-DASHBOARD.md](./SPEC-DASHBOARD.md)
> is the engineering spec. Branch: `feat/login-dashboard`.

---

## What you are designing

A logged-in dashboard for a product that, until now, delivered a single PDF-ish
HTML report by email. Customers pay $29.99 once, or $29/month to have the
report re-run on a schedule. The dashboard is where they watch their AI-search
citation rate move over time across the brands they track.

**The user:** a marketing or growth lead at a 50-500 person SaaS company. They
have $50-500/mo of discretionary budget, cannot run a CLI, and care about being
cited by ChatGPT and Perplexity the way they used to care about ranking on
Google. They are not an analyst. They open this maybe twice a month, and they
are looking for one thing: *did the work I did move the number?*

**The competitive set:** Profound, Athena HQ, Brand Radar — all $200-1000/mo,
all built like standard analytics SaaS. Our whole differentiation is that we do
not look like that.

---

## The one thing to hold onto

> **Investigative tech magazine that happens to sell you the article inside.**

When you have to choose between two options, pick the one that reinforces
"investigative magazine," not "generic SaaS dashboard." This is the single
sentence the whole design system exists to serve.

Practically, on a dashboard, that means: **the page opens with a sentence, not
a number.** A magazine tells you what happened in prose, then shows you the
evidence. A dashboard dumps metrics and makes you infer the story. We are the
former.

---

## What already exists (running code)

A working prototype is on branch `feat/login-dashboard`. Run it:

```bash
bun run db:start
supabase db reset
bun run --cwd packages/web seed:demo
bun run dev:web                       # http://localhost:3000/login
```

Sign in with `demo@openllmrank.io` / `demo-password-123`. The login form shows
these on screen in local dev.

Seeded so all three data states are reachable without faking anything:

| Brand | Runs | What it shows |
|---|---|---|
| **Linear** | 11 | Rising 18% → 41%. The full trend view. |
| **Cal.com** | 8 | Falling. The "down from" standfirst in rust red. |
| **Resend** | 1 | Single run. No trend line, no direction claim. |

Screens to look at, in order: `/dashboard` (brand list) → Linear → Cal.com →
Resend → Linear's "All 11 runs" → `/dashboard/billing`.

### Current brand page composition

```
 kicker      WEEK OF AUGUST 9                        12px moss uppercase
 standfirst  Linear is cited in 41% of your          Fraunces 40px
             tracked answers, up from 38% a
             week ago.                               "up" in sage, "down" in rust
 sub         Across 75 sampled answers from five     16px muted
             grounded providers. Next run Sept 8.
 ─────────────────────────────────────────────       hairline
 trend       inline SVG line chart, moss stroke      no chart library
 ─────────────────────────────────────────────
 WHERE YOU STAND              Share of voice 34%
             Linear         ██████████████  41%      moss fill
             Jira           █████████████   38%      terra cotta
             Asana          ████████        26%
             Monday.com     ████            13%
 ─────────────────────────────────────────────
 BY PROVIDER
             PERPLEXITY  GEMINI  OPENAI  ANTHROPIC  XAI
             51%         47%     40%     38%        30%
 ─────────────────────────────────────────────
 BIGGEST GAP
             "Which product roadmap tool integrates with GitHub?"
             — you trail the leading competitor by 35 points.
 ─────────────────────────────────────────────
 Read the full August 9 report →  ·  All 11 runs
```

---

## Non-negotiables

These come from [DESIGN.md](./DESIGN.md). Breaking one is a rejected PR, not a
taste debate.

**Type.** Fraunces for display (variable serif, `opsz` 9..144, weight 500).
DM Sans for body. Never Inter, Space Grotesk, Poppins, Montserrat, Roboto, or
system-ui as a display font. Numbers always `font-variant-numeric: tabular-nums`.

**Color.** Warm paper `#fbf8f0`, ink `#241f19`, moss `#376b5b` for the brand
and all primary action, terra cotta `#b86b2b` for competitors and emphasis,
sage `#476f53` for up, rust `#9f3a21` for down. No purple, violet, or indigo,
ever. No gradients.

**Structure.** Hairlines, not shadows. Lines, not boxes. Cards must earn their
existence — a card is only correct when the card *is* the interaction. The
current dashboard uses zero cards and should stay that way unless you have a
strong reason.

**Explicitly forbidden:** three-column feature grids with icons in circles,
KPI tiles, centered headings (we left-align), decorative blobs or wavy SVG
dividers, uniform large border-radius on everything, colored left-border
accents on cards, emoji as design elements.

**Accessibility.** 44×44px touch targets. 2px moss focus ring with 2px offset
on every interactive element. AA contrast minimum, AAA on critical text. Never
use muted grey as the only signal for anything.

**Dark mode is out of scope.** Deferred to v2 as its own design pass. Do not
token-invert.

---

## Design problems worth your attention

Ranked. The first three are where the real work is.

### 1. The standfirst is doing a lot and may not scale

It is generated from data, not written:

> "{brand} is cited in {rate}% of your tracked answers, {up|down} from
> {prev}% {elapsed}."

It reads well for a clean rise or fall. It gets weak when the number is flat,
when the change is tiny but technically directional, or when one brand rose
while another fell in the same account. And on the brand *list* page there is
no standfirst at all — just "You are tracking 3 brands," which is a label, not
a story.

**Question:** what is the editorial voice for a boring week? Right now it says
"unchanged since a week ago," which is honest but dead. Is there a better move
— surfacing the biggest per-provider swing, or the prompt that moved most, even
when the headline number sat still?

### 2. The trend chart is generic

It is a competent line chart: moss stroke, dashed gridlines, dots per run,
three date labels. It is also the least editorial thing on the page — it looks
like every other chart, which is exactly what the brand is trying not to be.

Constraints: server-rendered inline SVG, no chart library, no client JS. That
is a hard constraint (it ships zero JavaScript and keeps the page a document),
but it leaves enormous room — annotation, a marked "you shipped a change here"
point, sparkline treatments, small multiples per provider.

**Question:** what does an investigative-magazine chart look like? Think NYT
feature graphics, not Datadog.

### 3. Empty and thin states are half the product's life

A new customer sees one run for weeks. Currently:

- **0 brands:** "Track your first brand" + button
- **0 runs:** "Your first run is on its way" + 30s auto-refresh
- **1 run:** standfirst with no direction, and a note reading "Your trend line
  starts with run two. One run is a snapshot; the point of tracking is the
  direction."

These are honest and plain, but they are also the *first* impression of a paid
product, and they are currently the least designed screens. The single-run
state especially: the customer just paid, and the page tells them to come back
later.

**Question:** how do these carry weight instead of apologising?

### 4. Mobile

Verified working at 375px with no horizontal overflow, but "working" is the
bar it currently clears. The trend chart shrinks to about 100px tall and its
axis labels get very small. The provider row wraps to two lines. Roughly half
of marketing traffic is mobile.

### 5. Honest disclosure without alarm

Two places where the product tells the customer something slightly awkward and
must not feel like fine print or a warning:

- **Cadence throttle:** past two brands, scheduled runs drop from weekly to
  monthly. Currently a hairline-left-border note on the brand list and billing
  page.
- **Payment failed:** scheduled runs pause, but all existing reports stay
  readable.

Both currently use the same quiet `.note` treatment. That may be right, or it
may be too quiet for the payment one.

### 6. Surfaces that do not exist yet

Not built, and yours to shape:

- **Add-brand flow.** Should reuse the existing 4-step wizard (brand →
  competitors → prompts) with no payment step. Currently a stub.
- **Subscription upsell.** A one-shot customer needs to be offered $29/mo. The
  natural moments are the report email and the dashboard. Nothing designed yet.
- **Brand settings.** Edit prompts and competitors, change cadence, pause,
  archive.
- **Manual re-run.** A button with a quota (2/month) that has to communicate
  remaining runs without becoming a meter.
- **Expired report link.** "This link expired, sign in to read it" — the first
  thing some customers will see after 90 days.

---

## Where things live

| Concern | Path |
|---|---|
| Design system (read first) | `DESIGN.md` |
| CSS tokens | `packages/shared/src/design-tokens.css` |
| Dashboard styles | `packages/web/styles/dashboard.css` |
| Brand page | `packages/web/app/dashboard/[brandId]/page.tsx` |
| Brand list | `packages/web/app/dashboard/page.tsx` |
| Trend chart SVG | `packages/web/app/dashboard/_components/trend-chart.tsx` |
| Rate bars | `packages/web/app/dashboard/_components/rate-bars.tsx` |
| Run history | `packages/web/app/dashboard/[brandId]/runs/page.tsx` |
| Billing | `packages/web/app/dashboard/billing/page.tsx` |
| Login | `packages/web/app/login/` |
| Copy helpers (dates, percentages, direction) | `packages/web/lib/dashboard-data.ts` |
| Report renderer (the other product surface) | `packages/cli/src/core/render-html.ts` |

Token changes must land in **three** places: `design-tokens.css`,
`design-tokens.ts`, and the inlined stylesheet in `render-html.ts`. They are
duplicated deliberately, because the CLI must build standalone with no web
dependency.

---

## Rules of engagement

1. **Read `DESIGN.md` before touching anything visual.** It wins over this doc.
2. **Do not introduce a chart library.** Inline SVG, server-rendered.
3. **Do not add client-side JavaScript** to the dashboard read path without
   saying so explicitly. These pages are documents today.
4. **Do not invent data.** If a number is not in `run_metrics`, it does not
   exist. Available per run: own citation rate, share of voice, per-provider
   rates, per-competitor rates, worst-gap prompt and its score, sample count.
5. **Never claim a trend from one data point,** and never render sub-0.5%
   movement as directional. The product's credibility rests on not overstating
   what 3 samples per prompt can support.
6. **Keep the disclosures.** The cadence throttle and payment-failure notices
   are deliberate honesty, not clutter. Redesign them; do not delete them.
7. **Check 375px** on anything you touch.

---

## How to propose changes

Screenshots or a running branch beat descriptions. The prototype takes about
two minutes to boot, and every state is reachable from the seed — you can
screenshot the real thing rather than mocking it.

If you want to change the standfirst copy, edit the template in
`packages/web/app/dashboard/[brandId]/page.tsx` and the helpers in
`lib/dashboard-data.ts` (`elapsedPhrase`, `direction`, `pct`) and reload. No
build step.
