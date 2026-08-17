// End-to-end: a real HTTP fixture site with planted defects, crawled through
// the full pipeline (robots → sitemap → BFS → phase-2 → findings). This is
// the test that proves the engine finds the founder's actual bug class.
//
// Planted defects:
//   /ghost      — in sitemap, alive, but no internal link reaches it → orphan
//   /dead       — linked from /, returns 404                        → broken link
//   /hidden     — linked AND sitemapped, carries meta noindex       → headline noindex
//   robots.txt  — blocks GPTBot (training) and OAI-SearchBot (ai search)
//   /nested     — sitemap is an INDEX file pointing at a child sitemap

import { afterAll, describe, expect, test } from "bun:test";
import { runCheck } from "../src/crawler";

function html(body: string, head = ""): Response {
  return new Response(`<!doctype html><html><head><title>t</title><meta name="description" content="d">${head}</head><body>${body}</body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const server = Bun.serve({
  port: 0,
  fetch(req: Request): Response {
    const url = new URL(req.url);
    const base = url.origin;
    switch (url.pathname) {
      case "/robots.txt":
        return new Response(
          [
            "User-agent: GPTBot",
            "Disallow: /",
            "",
            "User-agent: OAI-SearchBot",
            "Disallow: /",
            "",
            "User-agent: *",
            "Allow: /",
            `Sitemap: ${base}/sitemap-index.xml`,
          ].join("\n"),
          { headers: { "content-type": "text/plain" } },
        );
      case "/sitemap-index.xml":
        return new Response(
          `<?xml version="1.0"?><sitemapindex><sitemap><loc>${base}/sitemap-pages.xml</loc></sitemap></sitemapindex>`,
          { headers: { "content-type": "application/xml" } },
        );
      case "/sitemap-pages.xml":
        return new Response(
          `<?xml version="1.0"?><urlset>
            <url><loc>${base}/</loc></url>
            <url><loc>${base}/a</loc></url>
            <url><loc>${base}/ghost</loc></url>
            <url><loc>${base}/hidden</loc></url>
          </urlset>`,
          { headers: { "content-type": "application/xml" } },
        );
      case "/":
        return html(`<a href="/a">a</a> <a href="/dead">dead</a> <a href="/hidden">h</a>`);
      case "/a":
        return html(`<a href="/">home</a>`);
      case "/ghost":
        return html("orphaned but alive");
      case "/hidden":
        return html("secret", `<meta name="robots" content="noindex">`);
      default:
        return new Response("not found", { status: 404 });
    }
  },
});
afterAll(() => server.stop(true));

const origin = `http://127.0.0.1:${server.port}`;

describe("full crawl of the fixture site", async () => {
  const phase1Seen: unknown[] = [];
  const progressSeen: number[] = [];

  const result = await runCheck(origin, {
    delayMs: 1,
    fetch: { allowPrivate: true },
    onPhase1: (p) => {
      phase1Seen.push(p);
    },
    onProgress: (p) => {
      progressSeen.push(p.pages_crawled);
    },
  });

  test("crawl completes", () => {
    expect(result.state).toBe("complete");
    expect(result.failure_reason).toBeNull();
    expect(result.schema_version).toBe(1);
  });

  test("phase-1 callback fired before crawl results, with bot findings", () => {
    expect(phase1Seen).toHaveLength(1);
    const p = phase1Seen[0] as { sitemap_found: boolean; sitemap_urls: string[] };
    expect(p.sitemap_found).toBe(true);
    // Sitemap INDEX resolved through to the child sitemap's URLs.
    expect(p.sitemap_urls).toContain(`${origin}/ghost`);
  });

  test("progress callback fired during the crawl", () => {
    expect(progressSeen.length).toBeGreaterThan(0);
    expect(progressSeen.at(-1)!).toBeGreaterThanOrEqual(4);
  });

  test("planted orphan found (the founder's bug class)", () => {
    const orphans = result.findings.filter((f) => f.type === "orphan_page");
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({
      url: `${origin}/ghost`,
      severity: "critical",
      tier: "headline",
    });
  });

  test("planted broken internal link found with its source page", () => {
    const broken = result.findings.filter((f) => f.type === "broken_internal_link");
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ url: `${origin}/dead`, status: 404 });
    expect((broken[0] as { found_on: string[] }).found_on[0]).toBe(`${origin}/`);
  });

  test("sitemapped noindex page escalates to headline critical", () => {
    const noindex = result.findings.filter((f) => f.type === "noindex_page");
    expect(noindex).toHaveLength(1);
    expect(noindex[0]).toMatchObject({
      url: `${origin}/hidden`,
      severity: "critical",
      tier: "headline",
    });
  });

  test("bot blocks: training bot secondary, AI-search bot headline", () => {
    const blocked = result.findings.filter((f) => f.type === "bot_blocked");
    const byBot = Object.fromEntries(blocked.map((f) => [(f as { bot: string }).bot, f]));
    expect(byBot["GPTBot"]).toMatchObject({ tier: "secondary", severity: "info" });
    expect(byBot["OAI-SearchBot"]).toMatchObject({ tier: "headline", severity: "warning" });
    expect(byBot["Googlebot"]).toBeUndefined(); // allowed → no finding
  });

  test("no false positives: healthy linked+sitemapped pages produce no findings", () => {
    const urlsInFindings = result.findings
      .map((f) => ("url" in f ? (f as { url: string }).url : null))
      .filter(Boolean);
    expect(urlsInFindings).not.toContain(`${origin}/`);
    expect(urlsInFindings).not.toContain(`${origin}/a`);
  });
});

describe("www/apex redirect must not orphan the site (stepracers.com regression)", () => {
  // Real-world shape: user types the apex domain, the site 308-redirects to
  // www, all internal links are root-relative (resolve to the www host), and
  // the sitemap lists www URLs — the homepage entry WITHOUT a trailing slash.
  // The bug: filtering links against the typed apex host dropped every
  // internal edge, so 9/10 sitemap URLs were reported as critical orphans on
  // a site with zero real orphans.
  const APEX = "crawlcheck-apex.invalid";
  const WWW = `www.${APEX}`;

  const vhost = Bun.serve({
    port: 0,
    fetch(req: Request): Response {
      const url = new URL(req.url);
      const base = `http://${WWW}:${url.port}`;
      // Apex vhost: everything 308s to www, like stepracers.com.
      if (url.hostname === APEX) {
        return new Response(null, {
          status: 308,
          headers: { location: `${base}${url.pathname}` },
        });
      }
      switch (url.pathname) {
        case "/robots.txt":
          return new Response(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml`, {
            headers: { "content-type": "text/plain" },
          });
        case "/sitemap.xml":
          return new Response(
            // Homepage listed WITHOUT trailing slash; /c listed although the
            // link to it carries a #fragment (must still credit /c).
            `<?xml version="1.0"?><urlset>
              <url><loc>${base}</loc></url>
              <url><loc>${base}/b</loc></url>
              <url><loc>${base}/c</loc></url>
            </urlset>`,
            { headers: { "content-type": "application/xml" } },
          );
        case "/":
          // Root-relative hrefs, exactly like the real site's footer.
          return html(`<a href="/b">b</a> <a href="/c#pricing">c</a>`);
        case "/b":
        case "/c":
          return html(`<a href="/">home</a>`);
        default:
          return new Response("not found", { status: 404 });
      }
    },
  });
  afterAll(() => vhost.stop(true));

  test("no orphans when the seed redirects apex→www", async () => {
    const result = await runCheck(`http://${APEX}:${vhost.port}`, {
      delayMs: 1,
      fetch: {
        allowPrivate: true,
        resolveOverride: (host) => (host === APEX || host === WWW ? "127.0.0.1" : null),
      },
    });
    expect(result.state).toBe("complete");
    const orphans = result.findings.filter(
      (f) => f.type === "orphan_page" || f.type === "not_verified_reachable",
    );
    expect(orphans).toEqual([]);
    // The crawl must actually follow the www links, not stall at the seed.
    expect(result.pages_crawled).toBeGreaterThanOrEqual(3);
    expect(result.findings.filter((f) => f.type === "broken_internal_link")).toEqual([]);
  });
});

describe("failure and partial states", () => {
  test("unreachable origin yields failed with explanation", async () => {
    const result = await runCheck("http://127.0.0.1:1", {
      delayMs: 1,
      fetch: { allowPrivate: true, timeoutMs: 2000 },
    });
    expect(result.state).toBe("failed");
    expect(result.failure_reason).toBeTruthy();
  });

  test("page cap yields partial, orphan claims downgraded", async () => {
    const result = await runCheck(origin, {
      delayMs: 1,
      maxPages: 2,
      fetch: { allowPrivate: true },
    });
    expect(result.state).toBe("partial");
    expect(result.findings.filter((f) => f.type === "orphan_page")).toHaveLength(0);
    expect(
      result.findings.filter((f) => f.type === "not_verified_reachable").length,
    ).toBeGreaterThan(0);
  });

  test("robots blocking everything is a complete diagnosis, not a failure", async () => {
    const blockAll = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/robots.txt") {
          return new Response("User-agent: *\nDisallow: /", {
            headers: { "content-type": "text/plain" },
          });
        }
        return new Response("body");
      },
    });
    try {
      const result = await runCheck(`http://127.0.0.1:${blockAll.port}`, {
        delayMs: 1,
        fetch: { allowPrivate: true },
      });
      expect(result.state).toBe("complete");
      expect(result.findings.some((f) => f.type === "robots_blocks_all")).toBe(true);
      expect(result.pages_crawled).toBe(0);
    } finally {
      blockAll.stop(true);
    }
  });
});
