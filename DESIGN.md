# Design System — openllmrank

> **Read this before touching anything visual.**
> Every color, font, spacing, and aesthetic choice in this repo is defined here.
> Do not deviate without explicit user approval. In QA / design reviews, flag any
> code that doesn't match the tokens below.

## Product Context

- **What this is:** Hosted AI-search-visibility report. A one-time $29.99 product that repeatedly queries grounded provider APIs against the buyer's category prompts and ships a personalized editorial report on where their brand appears (or doesn't) vs. competitors, with evidence and prioritized actions.
- **Who it's for:** Marketing / growth leads at 50-500 person SaaS companies. They have $50-500/mo discretionary budget, can't (and shouldn't need to) run a CLI, and care about being cited by AI tools the way they used to care about SEO.
- **Space:** AI search visibility / "GEO" / brand citation tracking. Hosted peers: Profound, Athena HQ, Brand Radar ($200-1000/mo).
- **Project type:** Hybrid. (1) Marketing landing page. (2) Four-step signup wizard. (3) Stripe checkout + success / cancel pages. (4) Two transactional emails (order-received + report). The full report HTML is itself a product surface.

## The Memorable Thing

> Investigative tech magazine that happens to sell you the article inside.

Every design decision serves this. When you have to choose between two options, pick the one that reinforces "investigative magazine," not "generic SaaS dashboard."

## Aesthetic Direction

- **Direction:** Editorial / magazine
- **Decoration level:** Intentional — Georgia serif headlines + warm paper carry the design. Minimal ornament. No icons in circles. No decorative blobs.
- **Mood:** Serious, slightly tense, curious, premium-but-accessible
- **Anti-references:** Stripe Dashboard (purple gradient SaaS), Linear (everyone uses Linear's aesthetic), generic Tailwind shadcn cards
- **Reference vibes:** The New York Times investigative feature page, The Information article layout, Brand Studies long-form posts, mid-century literary magazine covers

## Typography

| Role | Font | Notes |
|------|------|-------|
| Display / hero | **Fraunces**, Georgia, "Times New Roman", serif | Fraunces is a variable serif with an `opsz` axis (9..144) — gets dramatic at hero sizes. Loaded from Google Fonts. Falls back to Georgia if Google Fonts is unreachable. Weight 500. Line-height 0.98. Letter-spacing -1% to -2%. Serif is the differentiator. Do NOT swap to a sans-serif "for consistency." |
| Body | **DM Sans**, `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif` | DM Sans is geometric, characterful, NOT Inter. Loaded from Google Fonts. Falls back to system sans. Line-height 1.48. |
| Kicker labels | Body font, 12px UPPERCASE, `letter-spacing: 0.11em`, color `--accent` | Used to introduce every section / step. The editorial signature. |
| Numbers, rates, prices | Body font, `font-variant-numeric: tabular-nums` | Always tabular. Don't let "9" and "1" have different widths in data. |
| Code | Not currently used in product surfaces. If needed, use `Berkeley Mono, "JetBrains Mono", monospace`. |

### Scale (px / rem)

| Size | px | When to use |
|------|----|-----------| 
| Display XL | 64-70px | Marketing hero (desktop) |
| Display L | 44px | Section headings, wizard step headings (desktop) |
| Display M | 32px | Marketing hero / section headings (mobile) |
| Display S | 22-28px | Subsection headings, card titles |
| Body L | 18-19px | Lede paragraphs, primary form labels |
| Body | 16-17px | Default body text |
| Body S | 14-15px | Secondary, meta, error messages |
| Kicker | 12px | Section labels (always uppercase, .11em tracking) |

## Color

- **Approach:** Restrained-balanced. One moss accent for action + identity. One terra-cotta accent for emphasis. Earth-tone neutrals.

### Tokens (single source of truth: `packages/shared/src/design-tokens.{ts,css}` and the inline stylesheet in `packages/cli/src/core/render-html.ts`)

| Token | Hex | Role |
|-------|-----|------|
| `--paper` | `#fbf8f0` | Page background. Warm off-white, NOT pure white. |
| `--ink` | `#241f19` | Body text. Deep coffee brown, NOT pure black. |
| `--muted` | `#756c60` | Secondary text, meta info, captions. |
| `--line` | `#e3d8c6` | Hairline dividers, table borders. Warm cream. |
| `--soft` | `#f2eadc` | Form-field background, sample-data panels, callout boxes. Lighter cream. |
| `--accent` | `#376b5b` | **Moss green.** Primary CTAs, links, kicker labels, focus rings, win indicators. |
| `--accent-2` | `#b86b2b` | **Terra cotta.** Emphasis, competitor highlights, secondary accents. |
| `--win` | `#476f53` | Success states. Sage green. |
| `--loss` | `#9f3a21` | Errors, refund states, validation failures. Rust red. |

### Contrast (WCAG AA / AAA)

- Moss on paper (`#376b5b` on `#fbf8f0`): **~7.5:1 (AAA)** — safe for any text including body.
- Ink on paper (`#241f19` on `#fbf8f0`): **~14:1 (AAA)** — safe for all text.
- Muted on paper (`#756c60` on `#fbf8f0`): **~4.6:1 (AA)** — safe for body text. Do NOT use for any text smaller than 14px or for primary information.
- Loss on paper (`#9f3a21` on `#fbf8f0`): **~5.8:1 (AA)** — safe for error messages.

### Dark mode

Deferred to v2. The warm-paper palette is the brand identity for v1; dark mode would require its own design system pass, not a token inversion.

## Spacing

- **Base unit:** 4px
- **Density:** Comfortable. Editorial pacing — generous whitespace, integer multiples of 4.

| Token | px |
|-------|----|
| `--space-xs` | 4 |
| `--space-sm` | 8 |
| `--space-md` | 16 |
| `--space-lg` | 28 |
| `--space-xl` | 48 |
| `--space-xxl` | 96 |

## Layout

- **Approach:** Composition-first, not component-first. Each page / step is one composition with one job, not a grid of cards.
- **Max content width:** 1120px for marketing, 720px for wizard / forms / focused content.
- **Wizard pattern:** One big question per page. Kicker top-left (`STEP N OF 4`), then large serif heading, then the field(s), then footer with Back / Next. No mid-page chrome.
- **Marketing pattern:** Editorial long-scroll. Hero → "How it works" as numbered paragraphs (not a feature grid) → inline sample report link → FAQ as serif Q&A → final CTA. No card mosaics.
- **Mobile breakpoint:** 820px. Single column below; headline → data → CTA stacking. 44px minimum touch targets.

### Radii

| Token | px | Use |
|-------|----|-----|
| `--radius-sm` | 3 | Inline pills, small chips |
| `--radius-md` | 7 | Buttons, form fields, cards (when cards are actually needed) |
| `--radius-pill` | 999 | Rate bars, status indicators |

Hairlines preferred over thick borders. No uniform bubbly radii on everything.

## Motion

- **Approach:** Minimal-functional. No scroll-driven animations, no decorative motion in v1.
- **Easing:** `ease` / `ease-in-out` for state changes.
- **Duration:** 120ms for button hover / focus transitions; 200ms for color / opacity changes.
- **Focus ring:** 2px solid `--accent` with 2px offset on every interactive element.

## Component Patterns

### Primary button

```css
background: var(--accent);
color: var(--paper);
padding: 14px 28px;
border-radius: var(--radius-md);
font-weight: 600;
font-size: 16px;
min-height: 44px;
border: none;
```

### Form field

```css
background: var(--soft);
border: 1px solid var(--line);
border-radius: var(--radius-md);
padding: 14px 16px;
font-size: 18px;
min-height: 44px;
```

Focus: 2px `--accent` outline, no offset, border becomes `--accent`.

### Kicker label

```html
<span class="kicker">SECTION NAME</span>
```
```css
font-size: 12px;
font-weight: 700;
letter-spacing: 0.11em;
text-transform: uppercase;
color: var(--accent);
```

Use a kicker above every section heading on marketing pages, above every step heading in the wizard, and at the top of every transactional email.

### Rate bar (data viz)

The rate bar from the report is reusable across the product. Track on `--soft`, fill on `--accent` (own brand) or `--accent-2` (competitors). Always show the numeric value to the right with `font-variant-numeric: tabular-nums`.

### Hairline divider

```html
<hr class="rule">
```
```css
border: 0;
border-top: 1px solid var(--line);
margin: var(--space-xl) 0;
```

Hairlines, not shadows. Lines, not boxes.

## Accessibility (v1 baseline)

- Semantic HTML5 landmarks (`<header>`, `<main>`, `<footer>`, `<nav>`) on every page.
- Wizard fields: explicit `<label>`, `aria-describedby` for help text, `aria-invalid` + `aria-describedby` for errors.
- Focus-visible ring: 2px `--accent` outline + 2px offset on all interactive elements.
- Tab order: top-to-bottom natural flow. No `tabindex` tricks.
- Touch targets: 44×44px minimum.
- Color contrast: AA at minimum on body, AAA on critical text. Never use `--muted` as the only signal.
- Form submit on Enter; Esc cancels (custom).

## What This System Refuses

These patterns are explicitly forbidden in any new code. If a contributor or AI adds one, reject the PR:

1. Purple, violet, or indigo gradients. The accent is moss green. Not negotiable.
2. The 3-column feature grid with icons in colored circles. Sections are numbered editorial paragraphs.
3. `text-align: center` on every heading and paragraph. We left-align.
4. Decorative blobs, floating circles, wavy SVG dividers, stock photos of laptops or smiling diverse teams.
5. Generic SaaS hero copy: "Welcome to...", "Unlock the power of...", "Your all-in-one solution for..."
6. Cards by default. Cards must earn their existence (when the card IS the interaction).
7. Uniform large border-radius on every element.
8. Emoji as design elements.
9. Primary display font set to `Inter`, `Space Grotesk`, `Poppins`, `Montserrat`, `Roboto`, or `system-ui`. Display is Georgia.
10. Colored left-border accents on cards.
11. Email templates that look like Mailchimp. Emails use the same Georgia + paper system as the web.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-06 | Editorial Georgia + warm-paper palette established in CLI's HTML report renderer | Felt right for an "investigative" report; differentiates from SaaS-default rendering. See the inline stylesheet in `packages/cli/src/core/render-html.ts`. |
| 2026-05-17 | System extended across the hosted webapp via `packages/shared/src/design-tokens.{ts,css}` | Single source of truth across CLI report, web pages, and emails. Locked by /plan-design-review. |
| 2026-05-17 | System sans for body in v1; web-font upgrade deferred to v1.1 | Ops simplicity for v1; Georgia carries the brand. Web-font hosting is a separable polish task. |
| 2026-05-17 | Dark mode deferred to v2 | Warm-paper is the v1 identity. Dark mode is a separate design system pass, not a token inversion. |
| 2026-05-17 | Approved marketing hero mockup (variant A) | See `~/.gstack/projects/foodaka-openllmrank/designs/marketing-hero-20260517/variant-A.png`. The reference visual for any marketing page work. |
| 2026-05-17 | Approved wizard step 1 mockup (variant A) | See `~/.gstack/projects/foodaka-openllmrank/designs/wizard-step1-20260517/variant-A.png`. The reference visual for every wizard step. |
| 2026-05-17 | Stripe Checkout branding (logo + brand color `#376b5b`) required before going live | Default Stripe purple clashes with moss; configure in the Stripe Dashboard before flipping to live mode. Captured in TODOS.md. |
| 2026-05-17 | DESIGN.md codified | This file. Future contributors and AI agents read this before touching anything visual. Created by `/design-consultation`. |
| 2026-05-17 | Web fonts adopted: Fraunces (display) + DM Sans (body) via Google Fonts | Replaces the v1-shipped Georgia-display-+-system-sans-body combo. Closes the "biggest visible weakness" identified in the self-rating (7→targeted-8.5). Falls back to Georgia / system if Google Fonts unreachable, so CLI reports work offline. Same `<link>` tag in both the Next.js layout and the CLI report HTML for consistency. |
| 2026-05-17 | `/sample-report.html` wired (Plausible report from `packages/cli/examples`) | Was a dead link; now serves a real anonymized example using Plausible as the brand. Public-safe (Plausible is the comparable, not a customer). Lives at `packages/web/public/sample-report.html`. |

## File Map

| Concern | Where it lives |
|---------|----------------|
| CSS variables (used by the web app) | `packages/shared/src/design-tokens.css` |
| TS exports (for programmatic use) | `packages/shared/src/design-tokens.ts` |
| Inline CSS in the report renderer | `packages/cli/src/core/render-html.ts` |
| Web layout styles | `packages/web/styles/globals.css` |
| Approved mockups | `~/.gstack/projects/foodaka-openllmrank/designs/` |
| Original design doc with rationale | `~/.gstack/projects/foodaka-openllmrank/markhinschberger-main-design-20260517-183514.md` |

When you change a token, change it in ALL THREE places: the CSS file, the TS file, and the inline CSS in `render-html.ts`. They are deliberately duplicated (the CLI must be standalone with no web dependency) and a future task will collapse them.
