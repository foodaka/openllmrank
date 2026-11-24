// Head-to-head comparison pages: /vs/[slug] and the /alternatives hub.
//
// Rules for every entry (enforced in test/compare.test.ts):
//   - At least 5 facts about the competitor, each tied to an official vendor
//     URL. No third-party claims, no numbers from memory.
//   - At least 3 situations where the competitor is the better pick. A
//     comparison page that only ever recommends us converts nobody and gives
//     AI engines nothing quotable.
//   - `checked` is the day the vendor pages were read. Re-read them before
//     bumping it; never roll the date forward without re-checking.
//
// Our own facts come from OUR_PRODUCT below, which reads the hosted caps from
// @openllmrank/shared so the numbers cannot drift from what the product does.

import { HOSTED_CAPS } from "@openllmrank/shared";

export interface CompareFact {
  text: string;
  source: string; // official vendor URL
}

export interface CompareRow {
  label: string;
  them: string;
  us: string;
}

export interface Competitor {
  slug: string;
  name: string;
  domain: string;
  pricingUrl: string;
  checked: string; // ISO YYYY-MM-DD
  /** <= 60 chars before " — openllmrank" is appended. */
  title: string;
  description: string;
  /** One-paragraph answer that leads the page: who should pick which. */
  verdict: string;
  /** One line for the hub table. */
  summary: { entryPrice: string; engines: string; cadence: string };
  rows: CompareRow[];
  facts: CompareFact[];
  pickThemIf: string[];
  pickUsIf: string[];
  faq: { q: string; a: string }[];
}

const PROVIDERS = "OpenAI (ChatGPT), Anthropic (Claude), Google Gemini, Perplexity, xAI (Grok)";
const ANSWERS_PER_RUN =
  HOSTED_CAPS.max_prompts * HOSTED_CAPS.max_samples_per_prompt * HOSTED_CAPS.max_providers;

export const OUR_PRODUCT = {
  name: "openllmrank",
  trackingPrice: "$49/month",
  reportPrice: "$79 one-time",
  maxPrompts: HOSTED_CAPS.max_prompts,
  samples: HOSTED_CAPS.max_samples_per_prompt,
  providers: HOSTED_CAPS.max_providers,
  answersPerRun: ANSWERS_PER_RUN,
  engines: PROVIDERS,
  cadence: "Weekly; monthly past three brands",
  surface: "Grounded provider APIs with web search, not consumer app interfaces",
  free: "Free AI visibility snapshot and free AI crawler check, no card",
  openSource: "MIT-licensed CLI on npm; run it yourself with your own API keys",
} as const;

export const competitors: Competitor[] = [
  {
    slug: "profound",
    name: "Profound",
    domain: "tryprofound.com",
    pricingUrl: "https://www.tryprofound.com/pricing",
    checked: "2026-11-23",
    title: "Profound Alternative: Profound vs openllmrank (2026)",
    description:
      "Profound now sells only custom-priced Enterprise plans with daily tracking across up to 10 answer engines. openllmrank is $49/month with a public price, five grounded APIs, and an open-source CLI. Sourced comparison.",
    verdict:
      "Profound is an enterprise platform: daily tracking across up to 10 answer engines, Google AI Overviews and AI Mode, content agents, SSO, and custom pricing behind a demo. openllmrank is the small-team option: a public $49/month price, weekly runs across five grounded provider APIs, and an open-source CLI you can audit. If you need Google AI surfaces or hundreds of daily prompts, pick Profound. If you need a repeatable benchmark this week without a sales call, pick openllmrank.",
    summary: { entryPrice: "Custom (Enterprise only)", engines: "Up to 10, incl. Google AI Overviews and AI Mode", cadence: "Daily" },
    rows: [
      { label: "Price", them: "Enterprise only, \"Custom\" pricing via demo", us: `${OUR_PRODUCT.trackingPrice} tracking, or ${OUR_PRODUCT.reportPrice} report` },
      { label: "Engines", them: "Up to 10: ChatGPT, Perplexity, Google AI Mode, Gemini, DeepSeek, Claude, Google AI Overviews, Exa Search, Muse Spark, Qwen", us: PROVIDERS },
      { label: "Prompts", them: "Custom allowance", us: `Up to ${HOSTED_CAPS.max_prompts} buying questions, ${HOSTED_CAPS.max_samples_per_prompt} samples each per engine (${ANSWERS_PER_RUN} answers per run)` },
      { label: "Refresh", them: "Daily", us: OUR_PRODUCT.cadence },
      { label: "What gets queried", them: "Not stated on the pricing page", us: OUR_PRODUCT.surface },
      { label: "Exports and API", them: "CSV, JSON, API", us: "Emailed HTML report, dashboard, MCP endpoint for AI agents" },
      { label: "Free option", them: "Not stated; \"Get a Demo\"", us: OUR_PRODUCT.free },
      { label: "Open source", them: "Not stated", us: OUR_PRODUCT.openSource },
    ],
    facts: [
      { text: "The pricing page lists one plan, Enterprise, priced \"Custom\", with \"Get a Demo\" as the call to action.", source: "https://www.tryprofound.com/pricing" },
      { text: "Profound's FAQ says the Starter and Growth plans were retired in September 2026 and that their $399 and $499 prices are no longer available for new subscriptions.", source: "https://www.tryprofound.com/pricing" },
      { text: "Enterprise tracks up to 10 answer engines: ChatGPT, Perplexity, Google AI Mode, Gemini, DeepSeek, Claude, Google AI Overviews, Exa Search, Muse Spark, and Qwen.", source: "https://www.tryprofound.com/pricing" },
      { text: "Prompts run daily, with unlimited seats and unlimited projects.", source: "https://www.tryprofound.com/pricing" },
      { text: "Data exports as CSV and JSON, with API access and all-time history.", source: "https://www.tryprofound.com/pricing" },
      { text: "Enterprise includes SSO, a dedicated Slack channel, and a 24-hour support SLA.", source: "https://www.tryprofound.com/pricing" },
      { text: "Beyond tracking, Profound sells agents that write pages and generate social posts and images.", source: "https://www.tryprofound.com" },
    ],
    pickThemIf: [
      "You need Google AI Overviews or AI Mode measured. openllmrank does not cover Google's search surfaces.",
      "You track hundreds of prompts and need them refreshed daily, with CSV, JSON, and API exports into your own warehouse.",
      "You need procurement features: SSO, a dedicated Slack channel, a support SLA, and unlimited seats.",
      "You want content generation and agent analytics in the same tool as tracking.",
    ],
    pickUsIf: [
      "You want a public price and to start today, not after a demo.",
      "Five engines, including Claude and Grok, cover the AI answers your buyers read.",
      "You want to see exactly how the number is produced: the method is published and the CLI is open source.",
      "You are a small team and a weekly benchmark with competitor evidence is enough to decide what to fix.",
    ],
    faq: [
      { q: "How much does Profound cost?", a: "As of November 23, 2026, Profound's pricing page lists only an Enterprise plan with custom pricing. Its FAQ says the former Starter ($399) and Growth ($499) plans are no longer available to new subscribers." },
      { q: "Is openllmrank a cheaper Profound alternative?", a: "openllmrank costs $49/month for weekly tracking or $79 for a single report. It covers fewer engines (five grounded APIs) and does not measure Google AI Overviews, so it is a lighter tool rather than a like-for-like replacement." },
      { q: "Does openllmrank measure the same answers as Profound?", a: "Not necessarily. openllmrank queries providers' grounded APIs with web search. Profound's pricing page does not say how it collects answers. API answers can differ from what a logged-in user sees in a consumer app." },
    ],
  },
  {
    slug: "peec-ai",
    name: "Peec AI",
    domain: "peec.ai",
    pricingUrl: "https://peec.ai/pricing",
    checked: "2026-11-23",
    title: "Peec AI Alternative: Peec AI vs openllmrank (2026)",
    description:
      "Peec AI starts at $95/month for 50 daily prompts on 3 models. openllmrank is $49/month for weekly runs across five grounded APIs, including Claude and Grok, with an open-source CLI. Sourced comparison.",
    verdict:
      "Peec AI is built for volume: 50 to 350 prompts refreshed daily, Google AI Overviews and AI Mode, country targeting, and unlimited users, from $95/month. openllmrank runs fewer questions weekly, but its $49 plan includes Claude and Grok, which Peec lists as Enterprise models. Pick Peec for daily prompt volume and Google surfaces. Pick openllmrank for a lower-cost benchmark across five model providers.",
    summary: { entryPrice: "$95/month (Starter)", engines: "3 active models per plan; more on Enterprise", cadence: "Daily" },
    rows: [
      { label: "Entry price", them: "$95/month Starter; 15% off annual", us: `${OUR_PRODUCT.trackingPrice}, or ${OUR_PRODUCT.reportPrice} report` },
      { label: "Prompts on entry plan", them: "50 prompts, daily (4,500 AI answers/month)", us: `Up to ${HOSTED_CAPS.max_prompts} questions, weekly (${ANSWERS_PER_RUN} answers per run)` },
      { label: "Engines", them: "3 active models on Starter, Pro, Advanced (from ChatGPT, Perplexity, AI Overview, AI Mode, Gemini, Naver, ERNIE, Bing AI Mode); extra models $30+/month", us: PROVIDERS },
      { label: "Claude and Grok", them: "Listed as Enterprise \"API\" models", us: "Included on every plan" },
      { label: "What gets queried", them: "Not stated on the pricing page", us: OUR_PRODUCT.surface },
      { label: "Exports and API", them: "CSV on all plans; API from Pro ($245/month); MCP on all plans", us: "Emailed HTML report, dashboard, MCP endpoint for AI agents" },
      { label: "Free option", them: "Free trial (length not stated)", us: OUR_PRODUCT.free },
      { label: "Open source", them: "Not stated", us: OUR_PRODUCT.openSource },
    ],
    facts: [
      { text: "Starter costs $95/month for 50 prompts, 3 models, 1 project, 1 country, and 4,500 monthly AI answers, refreshed daily.", source: "https://peec.ai/pricing" },
      { text: "Pro costs $245/month for 150 prompts, 2 projects, 3 countries, and API access.", source: "https://peec.ai/pricing" },
      { text: "Advanced costs $495/month for 350 prompts, 5 projects, and a Looker Studio integration.", source: "https://peec.ai/pricing" },
      { text: "Self-serve plans track 3 active models chosen from ChatGPT, Perplexity, AI Overview, AI Mode, Gemini, Naver AI Briefing, ERNIE, and Bing AI Mode. Extra models cost $30, $70, or $140/month depending on plan.", source: "https://peec.ai/pricing" },
      { text: "Enterprise lists up to 26 models, including Claude Sonnet, Grok, DeepSeek, and Meta models labelled \"API\".", source: "https://peec.ai/pricing" },
      { text: "Every plan includes unlimited users, CSV export, and MCP access. Annual billing is 15% off.", source: "https://peec.ai/pricing" },
    ],
    pickThemIf: [
      "You need dozens or hundreds of prompts refreshed every day.",
      "You need Google AI Overviews, AI Mode, Bing AI Mode, Naver, or ERNIE, or tracking by country.",
      "You want an API and a Looker Studio connector to pipe results into your own reporting.",
    ],
    pickUsIf: [
      "You want Claude and Grok in the benchmark without an Enterprise contract.",
      "Ten core buying questions, run weekly, answer your question, and $49/month fits the budget better than $95.",
      "You want a one-off $79 report before committing to a subscription.",
      "You want the method and the code open: run the same analysis with the MIT-licensed CLI.",
    ],
    faq: [
      { q: "How much does Peec AI cost?", a: "As of November 23, 2026, Peec AI lists Starter at $95/month (50 prompts), Pro at $245/month (150 prompts), Advanced at $495/month (350 prompts), and custom Enterprise pricing, with 15% off annual billing." },
      { q: "Does Peec AI track Claude?", a: "Peec AI's pricing page lists Claude Sonnet among the Enterprise \"API\" models, not on the Starter, Pro, or Advanced plans. openllmrank includes Claude on every plan." },
      { q: "Is openllmrank a cheaper Peec AI alternative?", a: "openllmrank costs less ($49/month) but runs fewer questions weekly, not daily, and does not measure Google AI Overviews. It suits teams that want a lower-cost benchmark across five model providers." },
    ],
  },
  {
    slug: "otterly",
    name: "Otterly.AI",
    domain: "otterly.ai",
    pricingUrl: "https://otterly.ai/pricing",
    checked: "2026-11-23",
    title: "Otterly.AI Alternative: Otterly vs openllmrank (2026)",
    description:
      "Otterly.AI starts at €29/month for 16 daily prompts and adds GEO audits and content tools. openllmrank is $49/month for weekly runs across five grounded APIs with an open-source CLI. Sourced comparison.",
    verdict:
      "Otterly.AI is the low-cost monitoring suite: €29/month to start, daily checks, Google AI Overviews and Copilot coverage, plus GEO audits and content briefs. openllmrank does one job: a repeatable benchmark across five grounded provider APIs, with competitor evidence and an open-source CLI. Pick Otterly for a cheaper entry point and Google surfaces. Pick openllmrank for Claude and Grok in every run and a method you can inspect.",
    summary: { entryPrice: "€29/month (Lite)", engines: "4 of 7 per plan card, incl. AI Overviews and Copilot", cadence: "Daily (weekly option on Premium)" },
    rows: [
      { label: "Entry price", them: "€29/month Lite; 15% off annual", us: `${OUR_PRODUCT.trackingPrice}, or ${OUR_PRODUCT.reportPrice} report` },
      { label: "Prompts on entry plan", them: "16 prompts (2,000 credits), daily", us: `Up to ${HOSTED_CAPS.max_prompts} questions, weekly (${ANSWERS_PER_RUN} answers per run)` },
      { label: "Engines", them: "ChatGPT, Google AI Overviews, Perplexity, Microsoft Copilot, Google AI Mode, Gemini, Claude; plan cards say \"4 of 7 AI engines\"", us: PROVIDERS },
      { label: "Claude", them: "Each Claude answer costs 3 credits", us: "Included at no extra cost" },
      { label: "What gets queried", them: "Not stated", us: OUR_PRODUCT.surface },
      { label: "Exports and API", them: "Reports and export on all plans; API and MCP from Standard (€189/month)", us: "Emailed HTML report, dashboard, MCP endpoint for AI agents" },
      { label: "Free option", them: "7-day free trial, no credit card", us: OUR_PRODUCT.free },
      { label: "Open source", them: "Not stated", us: OUR_PRODUCT.openSource },
    ],
    facts: [
      { text: "Lite costs €29/month for 16 prompts (2,000 credits), daily tracking, 1 workspace, and 3 recommendations per week.", source: "https://otterly.ai/pricing" },
      { text: "Standard costs €189/month for 120 prompts, unlimited workspaces, and 2,000 API and 2,000 MCP requests per month.", source: "https://otterly.ai/pricing" },
      { text: "Premium costs €489/month for 403 prompts, with daily or weekly tracking.", source: "https://otterly.ai/pricing" },
      { text: "Otterly lists 7 engines: ChatGPT, Google AI Overviews, Perplexity, Microsoft Copilot, Google AI Mode, Google Gemini, and Claude. Plan cards say \"4 of 7 AI engines\".", source: "https://otterly.ai/pricing" },
      { text: "One credit is one prompt checked once on one engine; each Claude answer counts as 3 credits.", source: "https://otterly.ai/pricing" },
      { text: "Every plan includes unlimited seats, brands, and competitors, and a GEO audit with crawlability and content checks.", source: "https://otterly.ai/pricing" },
      { text: "Otterly offers a 7-day free trial with no credit card required.", source: "https://otterly.ai" },
    ],
    pickThemIf: [
      "You want the lowest entry price and daily checks: €29/month.",
      "You need Google AI Overviews, AI Mode, or Microsoft Copilot measured.",
      "You want GEO audits, content briefs, and recommendations in the same tool.",
    ],
    pickUsIf: [
      "You want Claude and Grok in every run without spending extra credits.",
      "You want five model providers sampled three times per question, so one odd answer does not move the number.",
      "You want a single $79 report instead of a subscription.",
      "You want an open method and an MIT-licensed CLI you can run on your own keys.",
    ],
    faq: [
      { q: "How much does Otterly.AI cost?", a: "As of November 23, 2026, Otterly's pricing page lists Lite at €29/month (16 prompts), Standard at €189/month (120 prompts), Premium at €489/month (403 prompts), and custom Enterprise pricing, with 15% off annual billing." },
      { q: "Does Otterly track Claude?", a: "Yes. Otterly lists Claude among its 7 engines, and its FAQ says each Claude answer counts as 3 credits. openllmrank includes Claude in every run at no extra cost." },
      { q: "Is openllmrank an Otterly alternative?", a: "For benchmarking across ChatGPT, Claude, Gemini, Perplexity, and Grok, yes. It does not measure Google AI Overviews or Copilot, and it does not include content briefs, so teams that need those should look at Otterly." },
    ],
  },
  {
    slug: "aiseotracker",
    name: "AI SEO Tracker",
    domain: "aiseotracker.com",
    pricingUrl: "https://aiseotracker.com/pricing",
    checked: "2026-11-23",
    title: "AI SEO Tracker Alternative: vs openllmrank (2026)",
    description:
      "AI SEO Tracker sells a $49 one-time report and plans from $79/month across six engines including Copilot and AI Overviews. openllmrank is $49/month with Claude and Grok and an open-source CLI. Sourced comparison.",
    verdict:
      "AI SEO Tracker and openllmrank are close in price and both sell a one-off report. The difference is which engines you see: AI SEO Tracker covers ChatGPT, Perplexity, Gemini, Copilot, and Google and Bing AI Overviews; openllmrank covers ChatGPT, Claude, Gemini, Perplexity, and Grok through their grounded APIs. Pick AI SEO Tracker for Copilot and AI Overviews or more prompts per brand. Pick openllmrank for Claude and Grok, a cheaper monthly plan, and an open-source method.",
    summary: { entryPrice: "$49 one-time report; $79/month (Basic)", engines: "6, incl. Copilot and Google and Bing AI Overviews", cadence: "Weekly (report: daily for 7 days)" },
    rows: [
      { label: "One-off report", them: "$49 one-time: 50 prompts, daily scans for 7 days, 1 brand", us: `${OUR_PRODUCT.reportPrice}: up to ${HOSTED_CAPS.max_prompts} questions, ${ANSWERS_PER_RUN} answers` },
      { label: "Monthly tracking", them: "$79/month Basic (50 prompts, 1 brand, owner-only); $199/month Pro (500 prompts, unlimited brands)", us: `${OUR_PRODUCT.trackingPrice}: up to ${HOSTED_CAPS.max_prompts} questions per brand, weekly` },
      { label: "Engines", them: "ChatGPT, Perplexity, Gemini, Copilot, Google AI Overviews, Bing AI Overviews", us: PROVIDERS },
      { label: "Claude and Grok", them: "Not listed", us: "Included on every plan" },
      { label: "Refresh", them: "Weekly rescans on Basic and Pro", us: OUR_PRODUCT.cadence },
      { label: "What gets queried", them: "Not stated", us: OUR_PRODUCT.surface },
      { label: "Free option", them: "One-question free check", us: OUR_PRODUCT.free },
      { label: "Open source", them: "Not stated", us: OUR_PRODUCT.openSource },
    ],
    facts: [
      { text: "The AI SEO report costs $49 one-time with no subscription: 50 prompts written from your website, daily scans for 7 days, and 1 brand.", source: "https://aiseotracker.com/pricing" },
      { text: "Basic costs $79/month for 50 tracked prompts, weekly rescans, 1 brand workspace, and owner-only access.", source: "https://aiseotracker.com/pricing" },
      { text: "Pro costs $199/month for 500 tracked prompts, weekly rescans, unlimited brands and projects, and teammate invites.", source: "https://aiseotracker.com/pricing" },
      { text: "It scans six engines: ChatGPT, Perplexity, Gemini, Copilot, Google AI Overviews, and Bing AI Overviews.", source: "https://aiseotracker.com" },
      { text: "Report buyers keep permanent read, print, and export access after the 7-day scan window.", source: "https://aiseotracker.com/pricing" },
      { text: "A separate done-for-you agency service, which writes pages and runs outreach, starts at $1,999/month.", source: "https://aiseotracker.com/pricing" },
    ],
    pickThemIf: [
      "You need Microsoft Copilot or Google and Bing AI Overviews measured.",
      "You want 50 or more prompts per brand, or 500 on the Pro plan.",
      "You want daily scans for a week from a one-off report, or a done-for-you agency to act on the results.",
    ],
    pickUsIf: [
      "Claude and Grok matter to your buyers. openllmrank includes both in every run.",
      "You want monthly tracking for $49 rather than $79.",
      "You want each answer from five grounded provider APIs sampled three times, with the method published.",
      "You want an MIT-licensed CLI to rerun the same analysis on your own API keys.",
    ],
    faq: [
      { q: "How much does AI SEO Tracker cost?", a: "As of November 23, 2026, AI SEO Tracker lists a $49 one-time report, Basic at $79/month (50 prompts), and Pro at $199/month (500 prompts). Its agency service starts at $1,999/month." },
      { q: "Does AI SEO Tracker track Claude or Grok?", a: "Its homepage and pricing page list ChatGPT, Perplexity, Gemini, Copilot, Google AI Overviews, and Bing AI Overviews. Claude and Grok are not listed. openllmrank includes both." },
      { q: "Which is better for a one-off check?", a: "AI SEO Tracker's $49 report covers more prompts (50) and scans daily for a week. openllmrank's $79 report covers up to 10 questions across five model providers, three samples each, including Claude and Grok. Both offer a free check first." },
    ],
  },
];

export function getCompetitor(slug: string): Competitor | undefined {
  return competitors.find((c) => c.slug === slug);
}

export function formatChecked(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
