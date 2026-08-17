// The crawl pipeline. One public entry point, deterministic, no LLM anywhere:
//
//   runCheck(origin)
//     ├── PHASE 1 (seconds): robots.txt fetch → bot roster, blocks-all,
//     │   sitemap candidates → sitemap presence. Reported immediately via
//     │   onPhase1 so the worker can persist it before the crawl starts.
//     ├── PHASE 2a (link crawl): BFS from `/` following same-host <a href>,
//     │   politeness delay between fetches, robots rules honored, page cap.
//     ├── PHASE 2b (sitemap fetch): sitemap URLs the BFS never reached are
//     │   fetched too — reachability by link and by sitemap are different
//     │   facts and the orphan check needs both.
//     └── checks.ts turns pages + phase1 into tiered findings.
//
// Terminal states: "complete" (everything discovered was visited),
// "partial" (cap/timeout hit — orphan claims are downgraded, see checks.ts),
// "failed" (the origin itself was unreachable; phase-1 may still exist).
// robots.txt disallowing everything is a COMPLETE diagnosis with a critical
// finding, not a failure (eng review decision 5A).

import { extractFromHtml } from "./extract";
import {
  guardedFetch,
  GuardedFetchError,
  type GuardedFetchOptions,
} from "./guarded-fetch";
import { canonicalKey, normalizeUrl, RedirectMap } from "./normalize";
import { analyzeRobots, type RobotsInfo } from "./robots";
import { fetchSitemaps } from "./sitemap";
import { buildFindings } from "./checks";
import {
  SCHEMA_VERSION,
  type CrawlProgress,
  type CrawlResult,
  type Page,
  type Phase1,
} from "./types";

export type CrawlOptions = {
  /** Hard page cap (link crawl + sitemap fetches combined). */
  maxPages?: number;
  /** Politeness delay between fetches, ms. */
  delayMs?: number;
  /** Whole-crawl budget, ms; hitting it yields state "partial". */
  totalTimeoutMs?: number;
  /** Called once phase-1 facts exist — persist them for the polling page. */
  onPhase1?: (phase1: Phase1) => void | Promise<void>;
  /** Called periodically so the report page can show "checked N of M". */
  onProgress?: (progress: CrawlProgress) => void | Promise<void>;
  fetch?: GuardedFetchOptions;
};

const DEFAULTS = {
  maxPages: 200,
  delayMs: 350,
  totalTimeoutMs: 8 * 60_000,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runCheck(origin: string, options: CrawlOptions = {}): Promise<CrawlResult> {
  const opts = { ...DEFAULTS, ...options };
  const fetchOpts = options.fetch ?? {};
  const host = new URL(origin).hostname.toLowerCase();
  const deadline = Date.now() + opts.totalTimeoutMs;

  // Hosts that count as "this site". Starts as the typed host; when the SITE
  // ITSELF redirects us to its www/apex twin (stepracers.com → 308 →
  // www.stepracers.com), that twin is adopted — observed, never assumed,
  // same philosophy as the redirect-based URL normalization. Without this,
  // every internal link on the post-redirect host is dropped and the whole
  // sitemap gets reported as orphans (the stepracers.com false positive).
  const allowedHosts = new Set([host]);
  const isWwwTwin = (a: string, b: string) => a === `www.${b}` || b === `www.${a}`;
  const adoptHostFrom = (finalUrl: string): void => {
    let h: string;
    try {
      h = new URL(finalUrl).hostname.toLowerCase();
    } catch {
      return;
    }
    if (allowedHosts.has(h)) return;
    if ([...allowedHosts].some((existing) => isWwwTwin(h, existing))) {
      allowedHosts.add(h);
      // Re-bind the robots rules to the adopted host: robots-parser matches
      // by origin, so rules bound to the typed apex return undefined (i.e.
      // "allowed") for every www URL — the adopted host's policy would never
      // be applied (Codex finding). The content is the same file: the apex
      // robots fetch followed the same redirect the seed did.
      robots = analyzeRobots(`https://${h}/robots.txt`, robotsContent);
    }
  };
  const hostAllowed = (url: string): boolean => {
    try {
      return allowedHosts.has(new URL(url).hostname.toLowerCase());
    } catch {
      return false;
    }
  };

  // ── Phase 1 ────────────────────────────────────────────────────────────
  let robots: RobotsInfo;
  let robotsContent: string | null = null;
  try {
    const res = await guardedFetch(`${origin}/robots.txt`, fetchOpts);
    robotsContent = res.status === 200 ? res.body : null;
    robots = analyzeRobots(`${origin}/robots.txt`, robotsContent);
  } catch (err) {
    if (!(err instanceof GuardedFetchError)) throw err;
    // robots.txt unreachable is not fatal by itself — the root fetch below
    // decides whether the whole site is down.
    robots = analyzeRobots(`${origin}/robots.txt`, null);
  }

  const guessedFallback = robots.sitemaps.length > 0 ? [] : [`${origin}/sitemap.xml`];
  const sitemapCandidates = robots.sitemaps.length > 0 ? robots.sitemaps : guessedFallback;
  const sitemap = await fetchSitemaps(sitemapCandidates, fetchOpts, guessedFallback);

  const phase1: Phase1 = {
    schema_version: SCHEMA_VERSION,
    robots_txt_found: robots.found,
    robots_blocks_all: robots.blocksAll,
    sitemap_urls: sitemap.urls,
    sitemap_found: sitemap.found,
    bot_access: robots.botAccess,
  };
  await options.onPhase1?.(phase1);

  // NOTE: `robots` is re-bound when the seed redirects to a www/apex twin
  // (see adoptHostFrom), so it is declared with `let` semantics via closure.

  const result = (state: CrawlResult["state"], pages: Page[], failure: string | null): CrawlResult => ({
    schema_version: SCHEMA_VERSION,
    domain: host,
    state,
    failure_reason: failure,
    pages_crawled: pages.length,
    pages_discovered: discovered.size,
    phase1,
    findings: buildFindings({
      state,
      pages,
      phase1,
      sitemapUnreadable: sitemap.unreadable,
      redirects,
      origin,
      allowedHosts: [...allowedHosts],
      robotsSkippedUrls: [...robotsSkipped],
      linkCrawlRan,
    }),
  });

  const redirects = new RedirectMap();
  const discovered = new Set<string>();
  // URLs we never fetched because robots.txt disallows OUR user agent —
  // checks.ts must not claim them as orphans (we were forbidden to look).
  const robotsSkipped = new Set<string>();
  // NOTE deliberately NO early-return on robots.blocksAll: `Disallow: /` with
  // path-level `Allow:` exceptions still leaves individual pages crawlable,
  // and phase 2b's per-URL robots checks handle that correctly. The
  // robots_blocks_all finding itself comes from phase1 in checks.ts.
  // When the ROOT is disallowed for our UA the BFS never seeds, the link
  // graph is unknowable, and checks.ts suppresses orphan claims entirely
  // (linkCrawlRan=false) — a blocked crawler must produce zero false orphans
  // (Codex findings 3+4).

  // ── Phase 2a: link crawl (BFS) ─────────────────────────────────────────
  const pages: Page[] = [];
  const visited = new Set<string>();
  const queue: string[] = [];

  const rootUrl = normalizeUrl(`${origin}/`)!;
  // "robots.txt respected" includes our own seed fetch: a site that
  // disallows only our UA gets no BFS at all (adversarial finding 12).
  let linkCrawlRan = true;
  if (!robots.isAllowed(rootUrl)) {
    robotsSkipped.add(rootUrl);
    linkCrawlRan = false;
  } else {
    queue.push(rootUrl);
    discovered.add(rootUrl);
  }

  let hitCap = false;
  let hitDeadline = false;
  let firstFetchFailed: string | null = null;

  const visit = async (url: string, via: Page["discovered_via"]): Promise<void> => {
    // Re-key at dequeue time: the RedirectMap grows during the crawl, so a
    // URL enqueued under one key may resolve to an already-visited final URL
    // by now — without this re-check the same page gets fetched twice.
    const key = canonicalKey(url, redirects);
    if (visited.has(key)) return;
    visited.add(key);

    let res;
    try {
      res = await guardedFetch(url, fetchOpts);
    } catch (err) {
      if (!(err instanceof GuardedFetchError)) throw err;
      if (pages.length === 0 && via === "link" && url === rootUrl) {
        firstFetchFailed = err.message;
        return;
      }
      pages.push({
        url,
        status: 0,
        final_url: url,
        links: [],
        canonical: null,
        noindex: false,
        title_present: false,
        description_present: false,
        discovered_via: via,
      });
      return;
    }

    if (res.finalUrl !== url) {
      redirects.record(url, res.finalUrl);
      adoptHostFrom(res.finalUrl);
      visited.add(canonicalKey(res.finalUrl, redirects));
    }

    const contentType = res.headers["content-type"] ?? "";
    const isHtml = contentType.includes("text/html") || contentType.includes("xhtml");
    const headerNoindex = /noindex/i.test(res.headers["x-robots-tag"] ?? "");

    let extract = {
      links: [] as string[],
      canonical: null as string | null,
      noindex: false,
      titlePresent: false,
      descriptionPresent: false,
    };
    if (res.status === 200 && isHtml) {
      extract = await extractFromHtml(res.body, res.finalUrl);
    }

    pages.push({
      url,
      status: res.status,
      final_url: res.finalUrl,
      links: extract.links,
      canonical: extract.canonical,
      noindex: extract.noindex || headerNoindex,
      title_present: extract.titlePresent,
      description_present: extract.descriptionPresent,
      discovered_via: via,
    });

    if (via === "link") {
      for (const link of extract.links) {
        if (!hostAllowed(link)) continue;
        if (!robots.isAllowed(link)) {
          robotsSkipped.add(link);
          continue;
        }
        const linkKey = canonicalKey(link, redirects);
        if (visited.has(linkKey) || discovered.has(linkKey)) continue;
        discovered.add(linkKey);
        queue.push(link);
      }
    }
  };

  while (queue.length > 0) {
    if (pages.length >= opts.maxPages) {
      hitCap = true;
      break;
    }
    if (Date.now() > deadline) {
      hitDeadline = true;
      break;
    }
    await visit(queue.shift()!, "link");
    if (firstFetchFailed) {
      return result("failed", [], firstFetchFailed);
    }
    await options.onProgress?.({ pages_crawled: pages.length, pages_discovered: discovered.size });
    if (queue.length > 0) await sleep(opts.delayMs);
  }

  // ── Phase 2b: sitemap URLs the link crawl never reached ───────────────
  // Register every known sitemap URL as discovered UP FRONT: breaking at the
  // page cap must not make the report claim "checked N of N" while thousands
  // of known-but-unfetched URLs exist (Codex finding).
  for (const url of sitemap.urls) {
    if (hostAllowed(url)) discovered.add(canonicalKey(url, redirects));
  }
  for (const url of sitemap.urls) {
    if (!hostAllowed(url)) continue;
    if (pages.length >= opts.maxPages) {
      hitCap = true;
      break;
    }
    if (Date.now() > deadline) {
      hitDeadline = true;
      break;
    }
    const key = canonicalKey(url, redirects);
    if (visited.has(key)) continue;
    if (!robots.isAllowed(url)) {
      robotsSkipped.add(url);
      continue;
    }
    await visit(url, "sitemap");
    await options.onProgress?.({ pages_crawled: pages.length, pages_discovered: discovered.size });
    await sleep(opts.delayMs);
  }

  // Truncated sitemap discovery also means partial coverage: branches of the
  // sitemap were never even read, so "complete" would be a false claim.
  const state: CrawlResult["state"] =
    hitCap || hitDeadline || sitemap.truncated ? "partial" : "complete";
  return result(state, pages, null);
}
