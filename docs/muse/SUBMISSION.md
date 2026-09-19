# Muse Connector Platform: submission packet

Status: **not submitted.** Prepared 2026-09-19. Submit at <https://muse.ai/platform> ("Submit a connector") once the [checklist](#before-submitting) is green. Only the account owner can submit: the form needs a signed-in Muse account and three personal attestations.

## What Muse actually requires (researched 2026-09-19)

Meta has published **no connector developer documentation**: no protocol spec, SDK, manifest format, error format, or discovery guidance. `muse.ai/platform` is a marketing page plus a sign-in-gated form, and `/docs`, `/developers`, `/llms.txt` on muse.ai all return the app shell. What follows comes from the form itself, as documented by developers who submitted during launch week, and from Stripe's first-party docs.

- **Format:** a hosted web form. No manifest, no repo PR.
- **Connection type:** `Existing MCP` (a hosted HTTPS MCP endpoint) or `Raw API` (URL + optional OpenAPI). We use **Existing MCP**.
- **Auth methods (optional multi-select):** API keys, OAuth with PKCE, Other. We need none: see "Access requirements" below.
- **Payments:** each submission declares whether it accepts payments. Muse partners with Stripe (Link wallet). Stripe's seller flow is Shared Payment Tokens; we implement it (`pay_for_report`).
- **Review:** functional, security and legal checks plus end-to-end testing. No published SLA. Approval is not guaranteed and featuring is editorial.
- **Discovery:** with no manifest, Muse decides when to call us from the MCP tool names, tool descriptions and server instructions (`packages/web/lib/mcp-server.ts`) and from the form's example prompts. Both are written around what the user asks, not how we run reports.
- Muse is US-only and 18+ at the time of writing, per other submitters' notes.

Sources:
[muse.ai/platform](https://muse.ai/platform) ·
[Meta Help: connectors](https://www.meta.com/help/artificial-intelligence/1687253048996149/) ·
[Stripe: agentic commerce for services](https://docs.stripe.com/agentic-commerce/for-sellers/services) ·
[Stripe: Shared Payment Tokens](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens) ·
third-party form notes: [KaiCalls](https://github.com/KaiCalls/kaicalls-mcp/pull/5), [tickadoo](https://github.com/tickadoo/tickadoo-mcp/tree/main/connectors/muse)

## Form values

### Step 1: Overview

| Field | Rule | Value |
|---|---|---|
| Connector name | ≤ 80 chars | `openllmrank` |
| Company or developer | ≤ 120 chars | `openllmrank` |
| Product website | URL | `https://openllmrank.io` |
| Example prompts | one per line | see below |
| Connector icon | 512×512 PNG/SVG, ≤ 256 KiB | **TODO: does not exist yet** (see checklist) |
| Payments | accepts / does not | **Accepts payments** |
| Your name | | *owner* |
| Work email | company email | *owner, an @openllmrank.io address* |
| Support email or URL | | `https://openllmrank.io` (contact form) or a support@ address if one is set up |
| Privacy policy | URL | `https://openllmrank.io/privacy` |
| Terms of service | URL | `https://openllmrank.io/terms` |
| Anything else? | free text | see below |

**Example prompts**

```text
How visible is my company across AI assistants?
Does ChatGPT recommend us when people ask about our category?
Compare Aave's AI visibility against Compound and Morpho.
Which competitors do Claude, Gemini and Perplexity recommend instead of us, and why?
What questions are customers asking AI where my competitors show up but I don't?
What do people ask ChatGPT about products like mine?
Run an AI visibility report for my company.
```

**Anything else?**

```text
openllmrank shows a business how often AI assistants recommend it versus its competitors. We ask real buyer questions to ChatGPT, Claude, Gemini, Perplexity and Grok (each several times, with web search on), record every answer, and measure who gets cited and which sources the AI relied on.

With the connector, a Muse user can ask "how visible is my company in AI?" or "compare us against X and Y". Muse can discover the questions buyers ask AI in that market (free), set up the analysis, show the user the price and the exact questions, take payment through the user's Link wallet, and about 10-15 minutes later explain the results: citation rate, share of voice, results per assistant, which questions are won or lost, and the competitor pages the AI cited. The full report is also emailed and linked.

Pricing: one analysis is USD 79, paid once per report. Nothing is charged until the user approves. Payment is a Stripe Shared Payment Token charged by openllmrank as merchant of record. If an analysis fails, the payment is refunded automatically.

Technical: stateless MCP over streamable HTTP, 5 tools, all annotated. Long-running work is polled, never held open. Open source (MIT CLI + this server): https://github.com/foodaka/openllmrank
```

### Step 2: Technical specs

| Field | Value |
|---|---|
| Connection type | **Existing MCP** |
| Hosted MCP endpoint | `https://openllmrank.io/api/mcp` |
| API or MCP documentation | `https://github.com/foodaka/openllmrank/blob/main/docs/AGENT_API.md` |
| Authentication methods | leave all unchecked (or `Other`: "per-order access tokens issued by the connector") |

**Access requirements**

```text
Public. No openllmrank account, API key or OAuth is required. Any Muse user can use the connector.

discover_ai_questions and analyze_brand_visibility are free. analyze_brand_visibility returns a priced order (USD 79) and charges nothing. pay_for_report charges a Stripe Shared Payment Token for exactly that amount and starts the analysis. Each order and report is protected by an access token the connector issues; an id without its token returns ACCESS_DENIED.

The user's email address is required to deliver the report and receipt. No other personal data is requested. Card data never touches openllmrank: it stays inside Stripe.

Rate limits apply per caller. Analyses take about 10-15 minutes and are polled with get_report_status.
```

### Step 3: Review (owner only)

1. *I confirm I'm authorized to submit this connector and its brand assets.*
2. *I understand that submission doesn't guarantee approval and promotion is based on usage and editorial discretion.*
3. *I agree to the Muse Connector Terms.* (`muse.ai/platform/terms` only renders when signed in: read it at submit time.)

## Before submitting

- [ ] **Deploy.** Merge, apply migration `0011_job_source.sql` to production, confirm `POST https://openllmrank.io/api/mcp` answers `initialize`. `REPORT_LINK_SECRET` must be set in production (it already is for report emails): it signs the connector's access tokens, and without it every order call returns `INTERNAL`.
- [ ] **Stripe.** Create the [Stripe profile](https://docs.stripe.com/get-started/account/profile) in the Dashboard (Shared Payment Tokens are granted to a profile) and accept the agentic commerce seller terms. SPTs are a Stripe preview feature.
- [ ] **Test-mode payment.** With `STRIPE_MODE=test`, mint a token with the test helper (command in `docs/AGENT_API.md`) and run order → pay → status. Confirm the PaymentIntent in the Dashboard carries `metadata.lead_id` and `source=mcp`.
- [ ] **Live payment.** Issue a real token from your own Link wallet with `npx @stripe/link-cli spend-request create --credential-type shared_payment_token --amount 7900 ...` and buy one report end to end. Refund it afterwards if you like.
- [ ] **Try it as a Muse custom connector** from your own Muse account (point it at the MCP endpoint) before review, so Meta's end-to-end test passes first time.
- [ ] **Icon.** 512×512 PNG or SVG, ≤ 256 KiB, following `DESIGN.md` (warm paper, moss green, Georgia). The repo has no logo asset today.
- [ ] **Support contact.** The form wants an email or URL. A `support@openllmrank.io` mailbox reads better to reviewers than a contact form.
- [ ] **Reviewer test path.** Meta tests end to end. Decide whether to give reviewers a 100%-off route (for example a reviewer-only payment token arrangement agreed by email) or let them pay and refund. The notes field can say "test access on request".
- [ ] Do not advertise a Muse listing anywhere until Meta approves it.

## Capability mapping

| User intent | Tool | openllmrank machinery reused |
|---|---|---|
| "What do customers ask AI about products like mine?" | `discover_ai_questions` | `suggestFromWebsite` (wizard's AI website draft) |
| "How visible are we in AI?" / "Compare us against X and Y" | `analyze_brand_visibility` | `HostedConfigSchema`, `leads`, Stripe Checkout fallback |
| user approves the price | `pay_for_report` | Stripe PaymentIntent + `provisionPaidReport` (shared with the webhook) |
| "Is it done yet?" | `get_report_status` | `jobs.status` |
| "What did it find? Why do they recommend my competitor?" | `get_visibility_report` | `run_metrics`, `computeRates`, `computeGap`, grounded sources |

Deliberately not built: a separate compare tool (every report compares), user-selectable AI providers (a server-owned product decision), model-written recommendations (the hosted product has none to reuse, and we do not fabricate analysis), subscriptions (a payment token authorizes one amount), OAuth (v2, for reading a user's existing dashboard reports).
