// Findings: pages + phase1 → tiered, versioned findings.
//
// Tier rules (eng review decision 5A):
//   headline  — crawl-path problems: orphans, broken internal links,
//               robots-blocks-all, search/AI-search bots blocked.
//   secondary — hygiene: canonical mismatches, noindex, missing title/
//               description, missing sitemap (informational), training-bot
//               blocks (policy choice, not a visibility problem).
//
// Partial-crawl honesty (Codex finding 4, accepted): when the crawl did not
// complete, "we never reached it" is not evidence of orphanhood — those pages
// are reported as not_verified_reachable instead of orphan_page.

import { canonicalKey, type RedirectMap } from "./normalize";
import type { CrawlState, Finding, Page, Phase1 } from "./types";

export function buildFindings(args: {
  state: CrawlState;
  pages: Page[];
  phase1: Phase1;
  sitemapUnreadable: string[];
  redirects: RedirectMap;
  origin: string;
  /** Hosts the crawl treats as "this site" (typed host + observed www/apex
   * twin). Sitemap URLs on other hosts are never crawled, so no reachability
   * claim — orphan or otherwise — may be made about them. Optional for
   * callers/tests that predate host adoption: defaults to the origin host. */
  allowedHosts?: string[];
  /** URLs the crawler skipped because robots.txt disallows OUR user agent.
   * These must never be claimed as orphans — we were forbidden from looking. */
  robotsSkippedUrls?: string[];
  /** False when the BFS never seeded (root disallowed for our UA). With no
   * link graph, "unreached by links" is meaningless — orphan and
   * not-verified claims are suppressed entirely. Defaults to true. */
  linkCrawlRan?: boolean;
}): Finding[] {
  const linkCrawlRan = args.linkCrawlRan ?? true;
  const { state, pages, phase1, sitemapUnreadable, redirects } = args;
  const allowedHosts = new Set(
    (args.allowedHosts ?? [new URL(args.origin).hostname]).map((h) => h.toLowerCase()),
  );
  const onAllowedHost = (url: string): boolean => {
    try {
      return allowedHosts.has(new URL(url).hostname.toLowerCase());
    } catch {
      return false;
    }
  };
  const findings: Finding[] = [];

  // ── robots / bots ─────────────────────────────────────────────────────
  if (phase1.robots_blocks_all) {
    findings.push({ type: "robots_blocks_all", severity: "critical", tier: "headline" });
  } else {
    for (const access of phase1.bot_access) {
      if (access.allowed) continue;
      if (access.category === "search_engine") {
        findings.push({
          type: "bot_blocked",
          bot: access.bot,
          category: access.category,
          severity: "critical",
          tier: "headline",
        });
      } else if (access.category === "ai_search") {
        findings.push({
          type: "bot_blocked",
          bot: access.bot,
          category: access.category,
          severity: "warning",
          tier: "headline",
        });
      } else {
        // Training bots: blocking is a legitimate policy choice — inform, don't alarm.
        findings.push({
          type: "bot_blocked",
          bot: access.bot,
          category: access.category,
          severity: "info",
          tier: "secondary",
        });
      }
    }
  }

  // ── sitemap presence ──────────────────────────────────────────────────
  if (!phase1.sitemap_found) {
    findings.push({ type: "missing_sitemap", severity: "info", tier: "secondary" });
  }
  for (const url of sitemapUnreadable) {
    findings.push({ type: "sitemap_unreadable", url, severity: "warning", tier: "secondary" });
  }

  // ── link graph ────────────────────────────────────────────────────────
  // Performance contract (review finding): sitemaps carry up to 5,000 URLs
  // and pages carry thousands of links, and this runs on the worker's shared
  // event loop. Every set/map below is computed ONCE with memoized keys —
  // no O(sitemap × pages) scans — and per-type finding lists are capped.
  const keyCache = new Map<string, string>();
  const key = (url: string): string => {
    let k = keyCache.get(url);
    if (k === undefined) {
      k = canonicalKey(url, redirects);
      keyCache.set(url, k);
    }
    return k;
  };

  const okPages = pages.filter((p) => p.status >= 200 && p.status < 300);
  const reachedByLink = new Set(
    pages
      .filter((p) => p.discovered_via === "link")
      .flatMap((p) => [key(p.url), key(p.final_url)]),
  );
  const pageByKey = new Map<string, Page>();
  for (const p of pages) {
    pageByKey.set(key(p.url), p);
    pageByKey.set(key(p.final_url), p);
  }
  const robotsBlocked = new Set((args.robotsSkippedUrls ?? []).map(key));

  // Broken internal links: pages that returned 4xx/5xx (or died), with the
  // pages that linked to them. status 0 = network-level failure.
  const linkSources = new Map<string, string[]>();
  for (const page of okPages) {
    for (const link of page.links) {
      const k = key(link);
      const sources = linkSources.get(k) ?? [];
      if (sources.length < 10) sources.push(page.final_url);
      linkSources.set(k, sources);
    }
  }
  const broken: Finding[] = [];
  const fetchFailed: Finding[] = [];
  for (const page of pages) {
    if (page.status >= 200 && page.status < 400) continue;
    const sources = linkSources.get(key(page.url)) ?? [];
    // status 0 = network-level failure. When nothing links to the page (a
    // phase-2b sitemap fetch that timed out), calling it a critical "broken
    // internal link" is a false public claim — the honest label is that we
    // couldn't verify it (adversarial finding 9).
    if (page.status === 0 && sources.length === 0) {
      fetchFailed.push({
        type: "not_verified_reachable",
        url: page.url,
        severity: "warning",
        tier: "headline",
      });
      continue;
    }
    broken.push({
      type: "broken_internal_link",
      url: page.url,
      status: page.status,
      found_on: sources,
      severity: "critical",
      tier: "headline",
    });
  }

  // Orphans: in the sitemap, alive when fetched, but unreachable by following
  // internal links — the founder's own bug. Only claimable on a COMPLETE
  // crawl; on a partial crawl the honest label is "not verified reachable".
  // Robots-disallowed pages get their own finding — "we were forbidden from
  // checking" is not evidence of orphanhood.
  const orphans: Finding[] = [];
  const notVerified: Finding[] = [];
  const robotsBlockedFindings: Finding[] = [];
  for (const url of phase1.sitemap_urls) {
    if (!onAllowedHost(url)) continue; // never crawled → no claim to make
    const k = key(url);
    if (reachedByLink.has(k)) continue;
    if (robotsBlocked.has(k)) {
      robotsBlockedFindings.push({
        type: "robots_blocked_page",
        url,
        severity: "warning",
        tier: "headline",
      });
      continue;
    }
    const fetched = pageByKey.get(k);
    if (fetched && (fetched.status < 200 || fetched.status >= 400)) continue; // already a broken link finding
    if (!linkCrawlRan) continue; // no link graph → no reachability claims
    if (state === "complete") {
      orphans.push({ type: "orphan_page", url, severity: "critical", tier: "headline" });
    } else {
      notVerified.push({ type: "not_verified_reachable", url, severity: "warning", tier: "headline" });
    }
  }

  // Cap each per-URL list; an aggregate row carries the remainder so nothing
  // is silently dropped (storage, API payload, and DOM all stay bounded).
  const MAX_PER_TYPE = 50;
  const pushCapped = (list: Finding[]) => {
    findings.push(...list.slice(0, MAX_PER_TYPE));
    if (list.length > MAX_PER_TYPE) {
      const first = list[0]!;
      findings.push({
        type: "more_findings",
        of_type: first.type,
        count: list.length - MAX_PER_TYPE,
        severity: first.severity,
        tier: first.tier,
      });
    }
  };
  pushCapped(broken);
  pushCapped(orphans);
  pushCapped([...notVerified, ...fetchFailed]);
  pushCapped(robotsBlockedFindings);

  // ── per-page hygiene (secondary tier) ─────────────────────────────────
  // Dedupe by final URL: two crawl paths can land on the same page (e.g. a
  // link plus a redirect), and each page deserves at most one finding per rule.
  const seenFinalUrls = new Set<string>();
  const hygienePages = okPages.filter((p) => {
    const k = key(p.final_url);
    if (seenFinalUrls.has(k)) return false;
    seenFinalUrls.add(k);
    return true;
  });
  const sitemapKeys = new Set(phase1.sitemap_urls.map(key));
  for (const page of hygienePages) {
    if (page.noindex) {
      // noindex on a page you sitemap'd is usually a mistake worth headline
      // attention; elsewhere it's often intentional.
      const inSitemap = sitemapKeys.has(key(page.final_url));
      findings.push({
        type: "noindex_page",
        url: page.final_url,
        severity: inSitemap ? "critical" : "info",
        tier: inSitemap ? "headline" : "secondary",
      });
    }
    if (page.canonical) {
      const pageKey = key(page.final_url);
      const canonicalTarget = key(page.canonical);
      if (canonicalTarget !== pageKey) {
        const crossDomain = (() => {
          try {
            return new URL(page.canonical).hostname !== new URL(page.final_url).hostname;
          } catch {
            return false;
          }
        })();
        findings.push({
          type: "canonical_mismatch",
          url: page.final_url,
          canonical: page.canonical,
          cross_domain: crossDomain,
          // Often intentional (Codex finding 17) — inform, never alarm.
          severity: crossDomain ? "warning" : "info",
          tier: "secondary",
        });
      }
    }
    if (!page.title_present) {
      findings.push({ type: "missing_title", url: page.final_url, severity: "info", tier: "secondary" });
    }
    if (!page.description_present) {
      findings.push({ type: "missing_description", url: page.final_url, severity: "info", tier: "secondary" });
    }
  }

  return findings;
}
