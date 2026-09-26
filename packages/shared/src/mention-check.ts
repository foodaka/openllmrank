// Free "Does AI mention you?" check: the contract between the web tier
// (submit + render) and the worker (ask + score). Browser-safe: no node:
// imports, so client components can use the labels and schemas. Versioned like the crawl
// check: results are immutable snapshots, so every stored payload carries
// schema_version and a meaning change means a new version.

import { z } from "zod";
import type { ProviderConfig } from "./config";

export const MENTION_SCHEMA_VERSION = 1;

/** One sample on the three assistants most buyers use. The paid report is
 * the upgrade: more questions, five assistants, repeated samples. Models
 * match HOSTED_REPORT_PROVIDERS so free and paid answers are comparable. */
export const MENTION_CHECK_PROVIDERS: readonly ProviderConfig[] = [
  { id: "openai", model: "gpt-5.4-mini" },
  { id: "perplexity", model: "sonar" },
  { id: "google", model: "gemini-3.5-flash" },
];

export const MENTION_PROVIDER_LABELS: Record<string, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
  perplexity: "Perplexity",
  xai: "Grok",
};

/** Bump when the way we ask changes; old cached answers stop matching. */
export const MENTION_PROMPT_VERSION = 1;

/** Cached answers are reused for this long across brands. */
export const MENTION_ANSWER_TTL_MS = 24 * 60 * 60 * 1000;

/** Conservative per-check spend reserved against the daily budget while a
 * check is queued or running (real cost replaces it once finished). */
export const MENTION_CHECK_ESTIMATED_COST_USD = 0.15;

export function normalizeQuestion(question: string): string {
  return question.trim().replace(/\s+/g, " ");
}

export const MentionSourceSchema = z.object({
  url: z.string(),
  domain: z.string(),
  title: z.string().nullable(),
  /** The source is the brand's own site or names the brand. */
  is_brand: z.boolean(),
});

export const MentionAnswerResultSchema = z.object({
  provider: z.string(),
  model: z.string(),
  status: z.enum(["ok", "failed"]),
  /** The brand is named in the answer text or linked as a source. */
  mentioned: z.boolean(),
  /** Up to 3 short excerpts around the brand's mentions. */
  excerpts: z.array(z.string()),
  /** The opening of the answer, so the visitor sees who AI names instead. */
  answer_preview: z.string(),
  sources: z.array(MentionSourceSchema),
  cached: z.boolean(),
});

export const MentionResultsSchema = z.object({
  schema_version: z.literal(MENTION_SCHEMA_VERSION),
  answers: z.array(MentionAnswerResultSchema),
  mentioned_count: z.number().int(),
  answered_count: z.number().int(),
});

export type MentionSource = z.infer<typeof MentionSourceSchema>;
export type MentionAnswerResult = z.infer<typeof MentionAnswerResultSchema>;
export type MentionResults = z.infer<typeof MentionResultsSchema>;

export const MENTION_TERMINAL_STATES = ["complete", "failed"] as const;
export type MentionState = "queued" | "running" | "complete" | "failed";
