# SEO and acquisition rollout — September 23, 2026

## Baseline and scope

Source: user-supplied Search Console ZIP dated September 23. Daily rows span July 13–September 20: 4,751 impressions, one click, 0.021% CTR, impression-weighted position 88.87. Page totals use a different aggregation (4,777 impressions). The three leading articles account for 97.1% of page impressions. Do not interpret this export as ChatGPT or Perplexity analytics or infer query/page pairings from separate exports.

Latest 14 days: 946 impressions, versus 2,268 in the preceding 14 days. Aggregate position improved from 91.21 to 79.90; changing query composition can explain this without individual ranking gains.

## Changes prepared

- Self-canonical and clearer title/H1 for `/check`; distinct homepage search copy.
- Comparison rewritten from official vendor documentation checked September 23; separate product rows and honest measurement distinctions.
- Corrected 150 questions to 10 questions / 150 responses. Added methodology, limitations, and downloadable transcriptions of the public tables. These are not newly collected observations or raw evidence.
- Contextual sample-report and free-check CTAs on the main articles.
- Acquisition events and first-touch attribution carried into Stripe metadata, plus best-effort live paid-checkout analytics.

## Analytics contract

Vercel Web Analytics must be enabled for the deployed project, with a plan supporting custom events. No new analytics provider is required.

| Event | Meaning |
| --- | --- |
| acquisition_page_view | Public marketing route visit |
| product_cta_click | Click to wizard, checker, or sample report; includes page, destination and location |
| crawl_check_start / created / error | Free checker submission and API outcome |
| wizard_start | Brand step viewed, including revisits |
| wizard_step_view | Competitors, prompts, or review step viewed |
| wizard_complete | Validated review submission; retries can emit again |
| checkout_start | Checkout URL created, immediately before redirect |
| checkout_error | Session creation or network failure; excludes user input |
| payment_complete | Live, paid wizard checkout after successful webhook provisioning |

Every funnel event includes `landing` and `source`. The browser retains the first public path and a broad referral category for 30 minutes in sessionStorage; there is an in-memory fallback if storage is unavailable. No unique visitor identifier is introduced. URL parameters, raw referrers, emails, domains submitted to the checker, and user prompts are not custom properties. Known AI referrers are classified separately. Missing referrers become `direct`; referral categories cannot reliably distinguish paid from organic search or all AI visits. This is within-session attribution, not a multi-touch attribution model.

Checkout stores `acquisition_landing` and `acquisition_source` in Stripe session metadata; subscription metadata also carries them. Existing signed-in billing and monitor flows are not included in the wizard acquisition funnel. Test/stub payments are excluded from `payment_complete`.

Client events are interaction counts, not unique visitors. Use Vercel's visitor metrics where supported, and compare like-for-like cohorts; do not divide raw retry counts and call the result a unique-user conversion rate. Ad blockers, storage expiry, and external referrer suppression create gaps.

The static `/sample-report.html` file does not mount the app analytics component. Links to it from marketing pages are tracked, and existing session attribution survives a visit there, but its own page views and outbound CTA clicks are not custom events. Direct visits to the sample followed by signup are unattributed (`other`). The sample includes a signup link and a return-home link.

Revenue truth comes from signed Stripe events stored in Postgres, not success-page visits. The custom payment event is best effort: crash windows and concurrent webhook delivery can omit or duplicate telemetry. Use `seo-paid-acquisition.sql` to reconcile unique paid Checkout sessions. This reports gross initial payments, not net revenue, refunds, or recurring invoices. Inspect linked jobs/subscriptions when investigating duplicate or refunded payments.

## Verification after deployment

Local verification completed: production Next.js build, root and web TypeScript checks, web tests (43 passed / 63 database-dependent skipped), and the additional browser-storage failure test passed. Rendered canonical tags were checked for the checker, methodology, and comparison pages. Desktop and 390px mobile browser inspection confirmed content and navigation; mobile table and CTA wrapping issues were fixed. CSV exports contain 10 prompt rows and 18 publisher rows. Live analytics ingestion, actual Stripe delivery, Search Console URL Inspection, and deployment have not been verified by this local run.

1. Fetch `/check`, `/methodology`, and the comparison article. Check status 200, self-canonicals, visible copy and sitemap membership.
2. In Search Console URL Inspection, inspect `/check` and the revised articles. Compare user-declared versus Google-selected canonical; request indexing after substantive changes. A sitemap is a hint, not an indexing guarantee.
3. Check desktop and mobile layouts; run PageSpeed Insights and use available field Core Web Vitals data. No performance score has been assumed.
4. In a fresh browser tab, enter from a public page, follow a CTA and complete the wizard using test mode. Confirm non-payment custom events and correct Stripe metadata. Do not charge a real customer to test analytics.
5. On the next genuine purchase, reconcile the paid webhook and event. Verify the deployed Vercel plan records custom events.

## Four-week review

Compare equal-length 28-day windows, allowing for indexing lag. Export query-by-page data for the three main articles and `/check`, with country and device filters. Track relevant queries moving into top 50, 20 and 10; assess CTR only for similar positions and query intent. Track landing-page visits, CTA interaction, checkout starts and unique paid sessions. One baseline click cannot support a reliable uplift forecast or A/B test.

## Research distribution drafts — not sent

Use these only after the revised pages are live. The historical raw answer logs were not located in the repository. Before pitching the study as independently reproducible, recover the original artifacts and exact timestamps, or run and publish a new documented study. Do not manufacture provider-level counts from the aggregate table.

### Public post draft

We published the ten prompts and aggregate source counts behind our July AI visibility study: ten software buying questions, five grounded provider APIs, three repeats each. The article reports web sources in 149 of 150 answers. We also clarified the limits: API answers differ from consumer apps, the sample is small, and the public downloads are aggregate transcriptions rather than raw logs. Here is the methodology: https://openllmrank.io/methodology

### Practitioner outreach draft

We build openllmrank and have published the methodology and aggregate tables from a small AI software-recommendation study. Your work on [specific relevant topic] made me think you might find the prompt set useful. We explicitly separate grounded API measurements from consumer-app results and document the missing raw-data limitations. If it fits your coverage, the methods and downloads are here: https://openllmrank.io/methodology. We would welcome methodological criticism.

Choose recipients from relevant AI-search newsletters, SEO practitioners, and communities that permit research sharing. Personalize based on their actual coverage. No contact list or messages have been invented or sent.

## Sources for vendor copy

- https://www.tryprofound.com/pricing
- https://athenahq.ai/plans
- https://help.ahrefs.com/en/articles/11064852-what-is-brand-radar-and-how-to-use-it

Recheck vendor information before subsequent updates; do not roll publication dates forward without substantive changes.
