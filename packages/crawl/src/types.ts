// Versioned finding/result schemas for the crawl check.
//
// Reports are immutable snapshots rendered years after they were written, so
// every stored payload carries SCHEMA_VERSION and the renderer switches on it.
// Never mutate the meaning of an existing field for a shipped version — add a
// new version instead.

import { z } from "zod";

export const SCHEMA_VERSION = 1;

/** Bots that feed AI *search/answer* surfaces — being blocked here costs
 * visibility in AI answers. Distinct from training bots by design: blocking
 * GPTBot (training) does NOT block ChatGPT search (OAI-SearchBot). */
export const AI_SEARCH_BOTS = [
  "OAI-SearchBot",
  "Claude-SearchBot",
  "PerplexityBot",
] as const;

/** Bots that collect training data. Blocking these is a legitimate policy
 * choice and does not remove a site from AI search surfaces. */
export const AI_TRAINING_BOTS = ["GPTBot", "ClaudeBot", "CCBot"] as const;

/** Classic search engine bots. */
export const SEARCH_ENGINE_BOTS = ["Googlebot", "Bingbot"] as const;

export const BotAccessSchema = z.object({
  bot: z.string(),
  category: z.enum(["search_engine", "ai_search", "ai_training"]),
  allowed: z.boolean(),
});
export type BotAccess = z.infer<typeof BotAccessSchema>;

/** Phase-1 findings: cheap fetches the worker performs immediately after
 * claiming, before the crawl. Rendered within seconds via polling. */
export const Phase1Schema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  robots_txt_found: z.boolean(),
  robots_blocks_all: z.boolean(),
  sitemap_urls: z.array(z.string()),
  sitemap_found: z.boolean(),
  bot_access: z.array(BotAccessSchema),
});
export type Phase1 = z.infer<typeof Phase1Schema>;

// ── Findings ────────────────────────────────────────────────────────────────
//
// Discriminated union on `type`. `tier` controls rendering: "headline"
// findings are the crawl-path problems the product exists for; "secondary"
// findings render collapsed (hygiene — real but commodity SEO-audit output).

const base = {
  severity: z.enum(["critical", "warning", "info"]),
  tier: z.enum(["headline", "secondary"]),
};

export const FindingSchema = z.discriminatedUnion("type", [
  // In sitemap but not reachable by following internal links from `/`.
  // Only emitted when the crawl COMPLETED — on a partial crawl "we didn't
  // reach it" is not evidence of anything (see not_verified_reachable).
  z.object({
    ...base,
    type: z.literal("orphan_page"),
    url: z.string(),
  }),
  // Partial-crawl counterpart of orphan_page: sitemap URL we never verified.
  z.object({
    ...base,
    type: z.literal("not_verified_reachable"),
    url: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("broken_internal_link"),
    url: z.string(),
    status: z.number(),
    found_on: z.array(z.string()),
  }),
  z.object({
    ...base,
    type: z.literal("robots_blocks_all"),
  }),
  z.object({
    ...base,
    type: z.literal("bot_blocked"),
    bot: z.string(),
    category: z.enum(["search_engine", "ai_search", "ai_training"]),
  }),
  z.object({
    ...base,
    type: z.literal("missing_sitemap"),
  }),
  z.object({
    ...base,
    type: z.literal("sitemap_unreadable"),
    url: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("noindex_page"),
    url: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("canonical_mismatch"),
    url: z.string(),
    canonical: z.string(),
    cross_domain: z.boolean(),
  }),
  z.object({
    ...base,
    type: z.literal("missing_title"),
    url: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("missing_description"),
    url: z.string(),
  }),
  // Sitemap URL our crawler was FORBIDDEN from verifying (robots disallows
  // our UA). Not an orphan claim — we simply cannot know (review finding:
  // robots-disallowed pages must never be reported as orphans).
  z.object({
    ...base,
    type: z.literal("robots_blocked_page"),
    url: z.string(),
  }),
  // Overflow marker: per-type finding lists are capped so a 5,000-URL
  // sitemap can't produce megabyte payloads and 5,000 DOM rows.
  z.object({
    ...base,
    type: z.literal("more_findings"),
    of_type: z.string(),
    count: z.number(),
  }),
]);

/** Terminal crawl states — single source of truth for worker, API, and UI. */
export const TERMINAL_CRAWL_STATES = ["complete", "partial", "failed"] as const;
export function isTerminalState(state: string): boolean {
  return (TERMINAL_CRAWL_STATES as readonly string[]).includes(state);
}
export type Finding = z.infer<typeof FindingSchema>;

export const CrawlStateSchema = z.enum(["complete", "partial", "failed"]);
export type CrawlState = z.infer<typeof CrawlStateSchema>;

/** One crawled page, kept AFTER the HTML body is discarded. Bounded memory:
 * links/meta only, never bodies. */
export const PageSchema = z.object({
  url: z.string(),
  status: z.number(),
  // Final URL after redirects (differs from `url` when the page redirected).
  final_url: z.string(),
  links: z.array(z.string()),
  canonical: z.string().nullable(),
  noindex: z.boolean(),
  title_present: z.boolean(),
  description_present: z.boolean(),
  // "link" = reached by BFS from `/`; "sitemap" = phase-2 fetch of a sitemap
  // URL that the link crawl never reached.
  discovered_via: z.enum(["link", "sitemap"]),
});
export type Page = z.infer<typeof PageSchema>;

export const CrawlResultSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  domain: z.string(),
  state: CrawlStateSchema,
  // Set when state === "failed" — rendered as an explanation, never a blank page.
  failure_reason: z.string().nullable(),
  pages_crawled: z.number(),
  pages_discovered: z.number(),
  phase1: Phase1Schema,
  findings: z.array(FindingSchema),
});
export type CrawlResult = z.infer<typeof CrawlResultSchema>;

export type CrawlProgress = {
  pages_crawled: number;
  pages_discovered: number;
};
