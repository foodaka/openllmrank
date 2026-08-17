import { describe, expect, test } from "bun:test";
import { buildFindings } from "../src/checks";
import { RedirectMap } from "../src/normalize";
import { SCHEMA_VERSION, type Page, type Phase1 } from "../src/types";

const ORIGIN = "https://example.com";

function phase1(overrides: Partial<Phase1> = {}): Phase1 {
  return {
    schema_version: SCHEMA_VERSION,
    robots_txt_found: true,
    robots_blocks_all: false,
    sitemap_urls: [],
    sitemap_found: true,
    bot_access: [],
    ...overrides,
  };
}

function page(overrides: Partial<Page> & { url: string }): Page {
  return {
    status: 200,
    final_url: overrides.url,
    links: [],
    canonical: null,
    noindex: false,
    title_present: true,
    description_present: true,
    discovered_via: "link",
    ...overrides,
  };
}

function build(args: Partial<Parameters<typeof buildFindings>[0]>) {
  return buildFindings({
    state: "complete",
    pages: [],
    phase1: phase1(),
    sitemapUnreadable: [],
    redirects: new RedirectMap(),
    origin: ORIGIN,
    ...args,
  });
}

describe("orphan detection", () => {
  const sitemapUrls = [`${ORIGIN}/reachable`, `${ORIGIN}/orphan`];
  const pages = [
    page({ url: `${ORIGIN}/`, links: [`${ORIGIN}/reachable`] }),
    page({ url: `${ORIGIN}/reachable` }),
    page({ url: `${ORIGIN}/orphan`, discovered_via: "sitemap" }),
  ];

  test("complete crawl: sitemap-only page is an orphan (headline critical)", () => {
    const findings = build({ pages, phase1: phase1({ sitemap_urls: sitemapUrls }) });
    const orphans = findings.filter((f) => f.type === "orphan_page");
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({
      url: `${ORIGIN}/orphan`,
      severity: "critical",
      tier: "headline",
    });
    expect(findings.filter((f) => f.type === "not_verified_reachable")).toHaveLength(0);
  });

  test("partial crawl: same page is only 'not verified reachable'", () => {
    const findings = build({
      state: "partial",
      pages,
      phase1: phase1({ sitemap_urls: sitemapUrls }),
    });
    expect(findings.filter((f) => f.type === "orphan_page")).toHaveLength(0);
    const nv = findings.filter((f) => f.type === "not_verified_reachable");
    expect(nv).toHaveLength(1);
    expect(nv[0]).toMatchObject({ url: `${ORIGIN}/orphan`, severity: "warning" });
  });

  test("redirect-observed equivalence prevents false orphans", () => {
    const redirects = new RedirectMap();
    redirects.record(`${ORIGIN}/orphan`, `${ORIGIN}/orphan/`);
    const findings = build({
      pages: [
        page({ url: `${ORIGIN}/`, links: [`${ORIGIN}/orphan/`] }),
        page({ url: `${ORIGIN}/orphan/` }),
      ],
      phase1: phase1({ sitemap_urls: [`${ORIGIN}/orphan`] }),
      redirects,
    });
    expect(findings.filter((f) => f.type === "orphan_page")).toHaveLength(0);
  });
});

describe("broken internal links", () => {
  test("404 page reported with linking sources", () => {
    const findings = build({
      pages: [
        page({ url: `${ORIGIN}/`, links: [`${ORIGIN}/dead`] }),
        page({ url: `${ORIGIN}/dead`, status: 404 }),
      ],
    });
    const broken = findings.filter((f) => f.type === "broken_internal_link");
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({
      url: `${ORIGIN}/dead`,
      status: 404,
      found_on: [`${ORIGIN}/`],
      severity: "critical",
      tier: "headline",
    });
  });

  test("broken sitemap URL is a broken link, not also an orphan", () => {
    const findings = build({
      pages: [
        page({ url: `${ORIGIN}/` }),
        page({ url: `${ORIGIN}/dead`, status: 404, discovered_via: "sitemap" }),
      ],
      phase1: phase1({ sitemap_urls: [`${ORIGIN}/dead`] }),
    });
    expect(findings.filter((f) => f.type === "broken_internal_link")).toHaveLength(1);
    expect(findings.filter((f) => f.type === "orphan_page")).toHaveLength(0);
  });
});

describe("reachability claim boundaries", () => {
  test("foreign-host sitemap URLs get NO reachability claim", () => {
    const findings = build({
      phase1: phase1({ sitemap_urls: ["https://cdn.other.net/asset"] }),
      allowedHosts: ["example.com"],
    });
    expect(
      findings.filter(
        (f) => f.type === "orphan_page" || f.type === "not_verified_reachable",
      ),
    ).toHaveLength(0);
  });

  test("robots-disallowed sitemap URLs are robots_blocked_page, never orphans", () => {
    const findings = build({
      phase1: phase1({ sitemap_urls: [`${ORIGIN}/private/page`] }),
      robotsSkippedUrls: [`${ORIGIN}/private/page`],
    });
    expect(findings.filter((f) => f.type === "orphan_page")).toHaveLength(0);
    const blocked = findings.filter((f) => f.type === "robots_blocked_page");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ severity: "warning", tier: "headline" });
  });

  test("status-0 with no linking source is not-verified, not a broken-link claim", () => {
    const findings = build({
      pages: [page({ url: `${ORIGIN}/timed-out`, status: 0, discovered_via: "sitemap" })],
    });
    expect(findings.filter((f) => f.type === "broken_internal_link")).toHaveLength(0);
    expect(findings.filter((f) => f.type === "not_verified_reachable")).toHaveLength(1);
  });

  test("status-0 WITH a linking source stays a broken internal link", () => {
    const findings = build({
      pages: [
        page({ url: `${ORIGIN}/`, links: [`${ORIGIN}/dead`] }),
        page({ url: `${ORIGIN}/dead`, status: 0 }),
      ],
    });
    const broken = findings.filter((f) => f.type === "broken_internal_link");
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ status: 0 });
  });

  test("per-type lists cap at 50 with an aggregate overflow row", () => {
    const findings = build({
      phase1: phase1({
        sitemap_urls: Array.from({ length: 120 }, (_, i) => `${ORIGIN}/p${i}`),
      }),
    });
    const orphans = findings.filter((f) => f.type === "orphan_page");
    const more = findings.filter((f) => f.type === "more_findings");
    expect(orphans).toHaveLength(50);
    expect(more).toHaveLength(1);
    expect(more[0]).toMatchObject({ of_type: "orphan_page", count: 70 });
  });
});

describe("robots and bots", () => {
  test("robots-blocks-all is the single headline critical, bot list suppressed", () => {
    const findings = build({
      phase1: phase1({
        robots_blocks_all: true,
        bot_access: [{ bot: "Googlebot", category: "search_engine", allowed: false }],
      }),
    });
    expect(findings.filter((f) => f.type === "robots_blocks_all")).toHaveLength(1);
    expect(findings.filter((f) => f.type === "bot_blocked")).toHaveLength(0);
  });

  test("bot severities: search critical, ai_search warning, training info/secondary", () => {
    const findings = build({
      phase1: phase1({
        bot_access: [
          { bot: "Googlebot", category: "search_engine", allowed: false },
          { bot: "OAI-SearchBot", category: "ai_search", allowed: false },
          { bot: "GPTBot", category: "ai_training", allowed: false },
          { bot: "PerplexityBot", category: "ai_search", allowed: true },
        ],
      }),
    });
    const blocked = findings.filter((f) => f.type === "bot_blocked");
    expect(blocked).toHaveLength(3);
    const byBot = Object.fromEntries(blocked.map((f) => [(f as { bot: string }).bot, f]));
    expect(byBot["Googlebot"]).toMatchObject({ severity: "critical", tier: "headline" });
    expect(byBot["OAI-SearchBot"]).toMatchObject({ severity: "warning", tier: "headline" });
    expect(byBot["GPTBot"]).toMatchObject({ severity: "info", tier: "secondary" });
  });
});

describe("hygiene tier", () => {
  test("missing sitemap is informational secondary, never headline", () => {
    const findings = build({ phase1: phase1({ sitemap_found: false }) });
    const f = findings.find((x) => x.type === "missing_sitemap");
    expect(f).toMatchObject({ severity: "info", tier: "secondary" });
  });

  test("noindex escalates to headline critical only when the page is sitemapped", () => {
    const findings = build({
      pages: [
        page({ url: `${ORIGIN}/hidden`, noindex: true }),
        page({ url: `${ORIGIN}/intentional`, noindex: true }),
      ],
      phase1: phase1({ sitemap_urls: [`${ORIGIN}/hidden`] }),
    });
    const noindex = findings.filter((f) => f.type === "noindex_page");
    const hidden = noindex.find((f) => (f as { url: string }).url === `${ORIGIN}/hidden`);
    const intentional = noindex.find(
      (f) => (f as { url: string }).url === `${ORIGIN}/intentional`,
    );
    expect(hidden).toMatchObject({ severity: "critical", tier: "headline" });
    expect(intentional).toMatchObject({ severity: "info", tier: "secondary" });
  });

  test("canonical mismatch: cross-domain warns, same-domain informs, both secondary", () => {
    const findings = build({
      pages: [
        page({ url: `${ORIGIN}/a`, canonical: `${ORIGIN}/b` }),
        page({ url: `${ORIGIN}/c`, canonical: "https://other.com/c" }),
        page({ url: `${ORIGIN}/self`, canonical: `${ORIGIN}/self` }),
      ],
    });
    const canon = findings.filter((f) => f.type === "canonical_mismatch");
    expect(canon).toHaveLength(2);
    const cross = canon.find((f) => (f as { cross_domain: boolean }).cross_domain);
    const same = canon.find((f) => !(f as { cross_domain: boolean }).cross_domain);
    expect(cross).toMatchObject({ severity: "warning", tier: "secondary" });
    expect(same).toMatchObject({ severity: "info", tier: "secondary" });
  });

  test("two crawl paths to the same final URL yield one finding, not two", () => {
    const findings = build({
      pages: [
        page({ url: `${ORIGIN}/login`, final_url: `${ORIGIN}/login`, noindex: true }),
        page({ url: `${ORIGIN}/old-login`, final_url: `${ORIGIN}/login`, noindex: true }),
      ],
    });
    expect(findings.filter((f) => f.type === "noindex_page")).toHaveLength(1);
  });

  test("missing title/description flagged on crawled pages", () => {
    const findings = build({
      pages: [page({ url: `${ORIGIN}/bare`, title_present: false, description_present: false })],
    });
    expect(findings.some((f) => f.type === "missing_title")).toBe(true);
    expect(findings.some((f) => f.type === "missing_description")).toBe(true);
  });
});
