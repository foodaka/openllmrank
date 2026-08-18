import { describe, expect, test } from "bun:test";
import { classifyMonitorEmail, diffFindings, findingKey } from "../src/diff";
import type { Finding } from "../src/types";

const orphan = (url: string): Finding => ({
  type: "orphan_page",
  url,
  severity: "critical",
  tier: "headline",
});
const broken = (url: string): Finding => ({
  type: "broken_internal_link",
  url,
  status: 404,
  found_on: ["https://x.example/"],
  severity: "critical",
  tier: "headline",
});
const botBlocked = (bot: string): Finding => ({
  type: "bot_blocked",
  bot,
  category: "ai_search",
  severity: "warning",
  tier: "headline",
});
const hygiene: Finding = {
  type: "missing_description",
  url: "https://x.example/a",
  severity: "info",
  tier: "secondary",
};

describe("findingKey", () => {
  test("is total over every variant and stable", () => {
    const variants: Finding[] = [
      orphan("https://x.example/a"),
      broken("https://x.example/b"),
      botBlocked("OAI-SearchBot"),
      { type: "robots_blocks_all", severity: "critical", tier: "headline" },
      { type: "missing_sitemap", severity: "info", tier: "secondary" },
      { type: "more_findings", of_type: "orphan_page", count: 3, severity: "critical", tier: "headline" },
      { type: "not_verified_reachable", url: "https://x.example/c", severity: "warning", tier: "headline" },
      { type: "robots_blocked_page", url: "https://x.example/d", severity: "warning", tier: "headline" },
      { type: "sitemap_unreadable", url: "https://x.example/s.xml", severity: "warning", tier: "secondary" },
      { type: "noindex_page", url: "https://x.example/e", severity: "critical", tier: "headline" },
      { type: "canonical_mismatch", url: "https://x.example/f", canonical: "https://y.example/", cross_domain: true, severity: "warning", tier: "secondary" },
      { type: "missing_title", url: "https://x.example/g", severity: "info", tier: "secondary" },
      hygiene,
    ];
    const keys = variants.map(findingKey);
    expect(keys.every((k) => typeof k === "string" && k.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length); // all distinct here
    expect(findingKey(botBlocked("OAI-SearchBot"))).toBe("bot_blocked:OAI-SearchBot");
  });
});

describe("diffFindings", () => {
  test("appeared / resolved / ongoing", () => {
    const prev = [orphan("https://x.example/a"), broken("https://x.example/dead")];
    const curr = [orphan("https://x.example/a"), botBlocked("PerplexityBot")];
    const d = diffFindings(prev, curr);
    expect(d.appeared.map(findingKey)).toEqual(["bot_blocked:PerplexityBot"]);
    expect(d.resolved.map(findingKey)).toEqual(["broken_internal_link:https://x.example/dead"]);
    expect(d.ongoing.map(findingKey)).toEqual(["orphan_page:https://x.example/a"]);
  });

  test("hygiene-tier findings never participate", () => {
    const d = diffFindings([hygiene], []);
    expect(d.resolved).toEqual([]);
    const d2 = diffFindings([], [hygiene]);
    expect(d2.appeared).toEqual([]);
  });

  test("identical sets diff to empty appeared/resolved", () => {
    const set = [orphan("https://x.example/a")];
    const d = diffFindings(set, set);
    expect(d.appeared).toEqual([]);
    expect(d.resolved).toEqual([]);
    expect(d.ongoing).toHaveLength(1);
  });
});

describe("classifyMonitorEmail", () => {
  const a = orphan("https://x.example/a");

  test("failed crawl is 'unreachable', never all-clear", () => {
    const r = classifyMonitorEmail({
      previousCompleteFindings: [],
      currentState: "failed",
      currentFindings: [],
    });
    expect(r.kind).toBe("unreachable");
    expect(r.diff).toBeNull();
  });

  test("partial crawl is a state note — no diff, no resolutions claimed", () => {
    const r = classifyMonitorEmail({
      previousCompleteFindings: [a],
      currentState: "partial",
      currentFindings: [],
    });
    expect(r.kind).toBe("state_note");
    expect(r.diff).toBeNull();
  });

  test("first complete crawl is a baseline, even with findings", () => {
    const r = classifyMonitorEmail({
      previousCompleteFindings: null,
      currentState: "complete",
      currentFindings: [a],
    });
    expect(r.kind).toBe("baseline");
  });

  test("complete-vs-complete with changes", () => {
    const r = classifyMonitorEmail({
      previousCompleteFindings: [],
      currentState: "complete",
      currentFindings: [a],
    });
    expect(r.kind).toBe("changes");
    expect(r.diff!.appeared).toHaveLength(1);
  });

  test("no change + no findings = all_clear; no change + findings = still_issues", () => {
    expect(
      classifyMonitorEmail({
        previousCompleteFindings: [],
        currentState: "complete",
        currentFindings: [],
      }).kind,
    ).toBe("all_clear");
    expect(
      classifyMonitorEmail({
        previousCompleteFindings: [a],
        currentState: "complete",
        currentFindings: [a],
      }).kind,
    ).toBe("still_issues");
  });
});
