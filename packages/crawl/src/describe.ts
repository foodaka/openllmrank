// Single source of truth for human-readable finding descriptions. Consumed by
// the CLI and the web report — wording drift between surfaces was a review
// finding, so neither may carry its own copy of this switch.

import type { Finding } from "./types";

export function describeFinding(f: Finding): string {
  switch (f.type) {
    case "orphan_page":
      return `Orphan page — in your sitemap, but no internal link reaches it: ${f.url}`;
    case "not_verified_reachable":
      return `Not verified reachable: ${f.url}`;
    case "broken_internal_link":
      // No linking source means the dead URL came from the sitemap — that's
      // a stale sitemap entry, not evidence of a broken href (Codex finding).
      return f.found_on[0]
        ? `Broken internal link (${f.status === 0 ? "unreachable" : `HTTP ${f.status}`}): ${f.url} — linked from ${f.found_on[0]}`
        : `Dead URL (${f.status === 0 ? "unreachable" : `HTTP ${f.status}`}) listed in your sitemap: ${f.url}`;
    case "robots_blocks_all":
      return "robots.txt disallows ALL crawlers — the site is invisible by configuration";
    case "bot_blocked":
      return `${f.bot} is blocked by robots.txt (${f.category.replace("_", " ")})`;
    case "missing_sitemap":
      return "No sitemap.xml found (informational — small fully-linked sites don't need one)";
    case "sitemap_unreadable":
      return `Sitemap could not be read: ${f.url}`;
    case "noindex_page":
      return `Page carries noindex${f.severity === "critical" ? " while ALSO listed in your sitemap" : ""}: ${f.url}`;
    case "canonical_mismatch":
      return `Canonical points elsewhere${f.cross_domain ? " (cross-domain)" : ""}: ${f.url} → ${f.canonical}`;
    case "missing_title":
      return `Missing <title>: ${f.url}`;
    case "missing_description":
      return `Missing meta description: ${f.url}`;
    case "robots_blocked_page":
      return `In your sitemap, but robots.txt forbids our crawler from verifying it: ${f.url}`;
    case "more_findings":
      return `…and ${f.count} more ${f.of_type.replace(/_/g, " ")} findings (list capped)`;
  }
}
