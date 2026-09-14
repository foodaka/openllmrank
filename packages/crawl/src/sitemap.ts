// Sitemap fetching + parsing, including sitemap-index files (nested
// sitemaps). Returns the flat URL list plus which sitemap files were
// unreadable, bounded so a hostile sitemap can't balloon the crawl.

import { XMLParser } from "fast-xml-parser";
import { guardedFetch, GuardedFetchError, type GuardedFetchOptions } from "./guarded-fetch";
import { normalizeUrl } from "./normalize";

export type SitemapResult = {
  urls: string[];
  unreadable: string[];
  found: boolean;
  /** True when discovery hit the file/URL caps with work left — the URL list
   * is incomplete and the crawl must not report itself as covering the whole
   * sitemap (Codex finding: silent truncation looked like "complete"). */
  truncated: boolean;
};

const MAX_SITEMAP_FILES = 10;
const MAX_SITEMAP_URLS = 5_000;

const parser = new XMLParser({ ignoreAttributes: true });

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Fetch and flatten sitemaps starting from candidate URLs (robots.txt
 * declarations, falling back to /sitemap.xml). `found` is false when no
 * candidate returned a parseable sitemap at all.
 *
 * `guessedCandidates`: URLs we GUESSED (the /sitemap.xml fallback) rather
 * than ones the site declared. A 404 on a guess means "no sitemap", not
 * "unreadable sitemap" — without this distinction every sitemap-less site
 * got both a missing_sitemap AND a spurious sitemap_unreadable finding.
 */
export async function fetchSitemaps(
  candidates: string[],
  fetchOpts: GuardedFetchOptions,
  guessedCandidates: string[] = [],
): Promise<SitemapResult> {
  const guessed = new Set(guessedCandidates);
  const urls = new Set<string>();
  const unreadable: string[] = [];
  let found = false;
  let truncated = false;

  const queue = [...candidates];
  let filesFetched = 0;

  while (queue.length > 0) {
    if (filesFetched >= MAX_SITEMAP_FILES) {
      truncated = true;
      break;
    }
    const sitemapUrl = queue.shift()!;
    filesFetched++;

    let body: string;
    try {
      const res = await guardedFetch(sitemapUrl, fetchOpts);
      if (res.status !== 200) {
        // A missing guess is simply "no sitemap"; only declared candidates
        // (or non-404 statuses on a guess) count as unreadable.
        if (!(guessed.has(sitemapUrl) && res.status === 404)) {
          unreadable.push(sitemapUrl);
        }
        continue;
      }
      body = res.body;
    } catch (err) {
      if (err instanceof GuardedFetchError) {
        if (!guessed.has(sitemapUrl)) unreadable.push(sitemapUrl);
        continue;
      }
      throw err;
    }

    let doc: Record<string, unknown>;
    try {
      doc = parser.parse(body) as Record<string, unknown>;
    } catch {
      unreadable.push(sitemapUrl);
      continue;
    }

    const index = doc.sitemapindex as { sitemap?: unknown } | undefined;
    const urlset = doc.urlset as { url?: unknown } | undefined;

    if (index) {
      found = true;
      const parentHost = new URL(sitemapUrl).hostname.toLowerCase();
      for (const entry of asArray(index.sitemap as { loc?: string } | Array<{ loc?: string }>)) {
        if (entry?.loc && typeof entry.loc === "string") {
          const child = entry.loc.trim();
          // Nested children must live on the SAME host as their parent index:
          // a hostile index otherwise turns the worker into a cross-origin
          // request gadget hitting arbitrary hosts (Codex finding).
          try {
            if (new URL(child).hostname.toLowerCase() !== parentHost) continue;
          } catch {
            continue;
          }
          queue.push(child);
        }
      }
    } else if (urlset) {
      found = true;
      for (const entry of asArray(urlset.url as { loc?: string } | Array<{ loc?: string }>)) {
        if (entry?.loc && typeof entry.loc === "string") {
          const normalized = normalizeUrl(entry.loc.trim());
          if (normalized) {
            if (urls.size < MAX_SITEMAP_URLS) urls.add(normalized);
            else truncated = true;
          }
        }
      }
    } else {
      unreadable.push(sitemapUrl);
    }
  }

  return { urls: [...urls], unreadable, found, truncated };
}
