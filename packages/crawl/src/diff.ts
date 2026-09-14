// Finding diff for monitoring: what changed between two crawls of a domain.
//
// Identity rules (eng review, Codex-hardened):
//   - Keys are TOTAL and PERSISTED-SAFE: computed only from fields stored in
//     findings_jsonb — never from transient crawl state like the RedirectMap.
//   - Per-variant key material: url-bearing findings key on (type, url);
//     bot_blocked keys on (type, bot); more_findings on (type, of_type);
//     robots_blocks_all keys on type alone.
//   - Only HEADLINE-tier findings participate. Hygiene (secondary tier) churns
//     on normal deploys and must never page a subscriber.
//   - Finding diffs are only meaningful between two COMPLETE crawls: a partial
//     or failed crawl cannot prove a finding resolved. Callers enforce that
//     (see worker monitor logic); diffFindings itself just compares two sets.

import type { CrawlState, Finding } from "./types";

/** Stable identity for a finding across crawls. Total over every variant. */
export function findingKey(f: Finding): string {
  switch (f.type) {
    case "robots_blocks_all":
      return f.type;
    case "bot_blocked":
      return `${f.type}:${f.bot}`;
    case "more_findings":
      return `${f.type}:${f.of_type}`;
    case "missing_sitemap":
      return f.type;
    default:
      // Every remaining variant carries a url.
      return `${f.type}:${f.url}`;
  }
}

export type FindingsDiff = {
  /** Headline findings present now but not before. */
  appeared: Finding[];
  /** Headline findings present before but gone now. */
  resolved: Finding[];
  /** Headline findings present in both. */
  ongoing: Finding[];
};

export function diffFindings(previous: Finding[], current: Finding[]): FindingsDiff {
  const prevHeadline = previous.filter((f) => f.tier === "headline");
  const currHeadline = current.filter((f) => f.tier === "headline");
  const prevKeys = new Map(prevHeadline.map((f) => [findingKey(f), f]));
  const currKeys = new Map(currHeadline.map((f) => [findingKey(f), f]));

  return {
    appeared: currHeadline.filter((f) => !prevKeys.has(findingKey(f))),
    resolved: prevHeadline.filter((f) => !currKeys.has(findingKey(f))),
    ongoing: currHeadline.filter((f) => prevKeys.has(findingKey(f))),
  };
}

export type MonitorEmailKind =
  | "baseline" // first crawl for this monitor — report the starting point
  | "changes" // something appeared or resolved (complete↔complete diff)
  | "all_clear" // complete crawl, no headline findings, nothing changed
  | "still_issues" // complete crawl, unchanged but non-empty headline findings
  | "unreachable" // crawl failed — site down / blocked; never an all-clear
  | "state_note"; // partial or state transition without a trustworthy diff

/** Decide the weekly email's kind. `previousCompleteFindings` is null when no
 * prior COMPLETE crawl exists (first run, or every prior run failed). */
export function classifyMonitorEmail(args: {
  previousCompleteFindings: Finding[] | null;
  currentState: CrawlState;
  currentFindings: Finding[];
}): { kind: MonitorEmailKind; diff: FindingsDiff | null } {
  const { previousCompleteFindings, currentState, currentFindings } = args;

  if (currentState === "failed") return { kind: "unreachable", diff: null };

  if (currentState === "partial") {
    // A partial crawl can't prove resolutions and may under-report new
    // problems — send an honest status note, never a diff or all-clear.
    return { kind: "state_note", diff: null };
  }

  // currentState === "complete"
  if (previousCompleteFindings === null) {
    return { kind: "baseline", diff: null };
  }
  const diff = diffFindings(previousCompleteFindings, currentFindings);
  if (diff.appeared.length > 0 || diff.resolved.length > 0) {
    return { kind: "changes", diff };
  }
  return { kind: diff.ongoing.length === 0 ? "all_clear" : "still_issues", diff };
}
