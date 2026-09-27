// Scores one grounded answer for the free mention check. Pure: no DB, no
// network, so the rules are unit-tested directly.
//
// Mention detection reuses the CLI's extractCitations (the same matcher the
// paid report uses), with the brand's domain as an alias so "acme.com" in
// the text or a cited source counts too.

import { createHash } from "node:crypto";
import { extractCitations } from "openllmrank/src/core/citations";
import type { GroundedSource } from "openllmrank/src/core/types";
import {
  MENTION_PROMPT_VERSION,
  normalizeQuestion,
  type MentionAnswerResult,
  type MentionSource,
} from "@openllmrank/shared/mention-check";

const MAX_EXCERPTS = 3;
const EXCERPT_RADIUS = 110;
const PREVIEW_CHARS = 700;
const MAX_SOURCES = 8;

export type MentionBrand = { name: string; domain: string };

export type RawAnswer = {
  provider: string;
  model: string;
  response_text: string;
  search_results: GroundedSource[];
  cached: boolean;
};

/** Cache key for an answer: case- and whitespace-insensitive, versioned. */
export function questionHash(question: string): string {
  return createHash("sha256")
    .update(`v${MENTION_PROMPT_VERSION}:${normalizeQuestion(question).toLowerCase()}`)
    .digest("hex");
}

export function scoreAnswer(answer: RawAnswer, brand: MentionBrand): MentionAnswerResult {
  const brands = [{ name: brand.name, aliases: [brand.domain] }];
  const mentioned = extractCitations(answer.response_text, brands, answer.search_results).length > 0;

  return {
    provider: answer.provider,
    model: answer.model,
    status: "ok",
    mentioned,
    excerpts: excerpts(answer.response_text, [brand.name, brand.domain]),
    answer_preview: preview(answer.response_text),
    sources: sources(answer.search_results, brand),
    cached: answer.cached,
  };
}

export function failedAnswer(provider: string, model: string): MentionAnswerResult {
  return {
    provider,
    model,
    status: "failed",
    mentioned: false,
    excerpts: [],
    answer_preview: "",
    sources: [],
    cached: false,
  };
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

/** Short windows around the first few mentions, merged when they overlap. */
function excerpts(text: string, needles: string[]): string[] {
  const lower = text.toLowerCase();
  const hits: number[] = [];
  for (const needle of needles) {
    const n = needle.toLowerCase();
    if (!n) continue;
    let i = lower.indexOf(n);
    while (i !== -1) {
      // Word boundaries only where the needle itself starts/ends with a word
      // character, so names like "C++" still match.
      const okBefore = !isWordChar(n[0]) || !isWordChar(text[i - 1]);
      const okAfter = !isWordChar(n[n.length - 1]) || !isWordChar(text[i + n.length]);
      if (okBefore && okAfter) hits.push(i);
      i = lower.indexOf(n, i + 1);
    }
  }
  hits.sort((a, b) => a - b);

  const out: string[] = [];
  let lastEnd = -1;
  for (const hit of hits) {
    if (out.length >= MAX_EXCERPTS) break;
    const start = Math.max(0, hit - EXCERPT_RADIUS);
    if (start < lastEnd) continue;
    const end = Math.min(text.length, hit + EXCERPT_RADIUS);
    lastEnd = end;
    out.push(`${start > 0 ? "…" : ""}${squash(text.slice(start, end))}${end < text.length ? "…" : ""}`);
  }
  return out;
}

function preview(text: string): string {
  const flat = squash(text);
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS).trimEnd()}…` : flat;
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Grounded sources, http(s) only (URLs in model output are untrusted),
 * deduped, brand-owned or brand-naming sources flagged. */
function sources(results: GroundedSource[], brand: MentionBrand): MentionSource[] {
  const seen = new Set<string>();
  const out: MentionSource[] = [];
  for (const r of results) {
    const url = safeHttpUrl(r.url);
    if (!url || seen.has(url.href)) continue;
    seen.add(url.href);
    const domain = url.hostname.replace(/^www\./, "");
    const ownSite = domain === brand.domain || domain.endsWith(`.${brand.domain}`);
    const names =
      extractCitations("", [{ name: brand.name, aliases: [brand.domain] }], [r]).length > 0;
    out.push({ url: url.href, domain, title: r.title?.trim() || null, is_brand: ownSite || names });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

function safeHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}
