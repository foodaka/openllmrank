import { afterAll, describe, expect, test } from "bun:test";
import { fetchSitemaps } from "../src/sitemap";

const server = Bun.serve({
  port: 0,
  fetch(req: Request): Response {
    const url = new URL(req.url);
    const base = url.origin;
    if (url.pathname === "/big-index.xml") {
      // 12 children — exceeds MAX_SITEMAP_FILES(10) so discovery truncates.
      const kids = Array.from({ length: 12 }, (_, i) => `<sitemap><loc>${base}/child-${i}.xml</loc></sitemap>`).join("");
      return new Response(`<?xml version="1.0"?><sitemapindex>${kids}</sitemapindex>`, {
        headers: { "content-type": "application/xml" },
      });
    }
    if (/^\/child-\d+\.xml$/.test(url.pathname)) {
      return new Response(
        `<?xml version="1.0"?><urlset><url><loc>${base}${url.pathname.replace(".xml", "")}</loc></url></urlset>`,
        { headers: { "content-type": "application/xml" } },
      );
    }
    if (url.pathname === "/evil-index.xml") {
      return new Response(
        `<?xml version="1.0"?><sitemapindex><sitemap><loc>http://other-host.invalid/x.xml</loc></sitemap><sitemap><loc>${base}/sitemap.xml</loc></sitemap></sitemapindex>`,
        { headers: { "content-type": "application/xml" } },
      );
    }
    switch (url.pathname) {
      case "/sitemap.xml":
        return new Response(
          `<?xml version="1.0"?><urlset><url><loc>${base}/a</loc></url><url><loc>${base}/b</loc></url></urlset>`,
          { headers: { "content-type": "application/xml" } },
        );
      case "/not-xml.xml":
        return new Response("<html>this is not a sitemap</html>", {
          headers: { "content-type": "text/html" },
        });
      case "/missing.xml":
        return new Response("gone", { status: 404 });
      default:
        return new Response("404", { status: 404 });
    }
  },
});
afterAll(() => server.stop(true));

const base = `http://127.0.0.1:${server.port}`;
const opts = { allowPrivate: true };

describe("fetchSitemaps", () => {
  test("parses a plain urlset", async () => {
    const res = await fetchSitemaps([`${base}/sitemap.xml`], opts);
    expect(res.found).toBe(true);
    expect(res.urls).toEqual([`${base}/a`, `${base}/b`]);
    expect(res.unreadable).toEqual([]);
  });

  test("non-XML and 404 candidates are reported unreadable, not fatal", async () => {
    const res = await fetchSitemaps(
      [`${base}/not-xml.xml`, `${base}/missing.xml`, `${base}/sitemap.xml`],
      opts,
    );
    expect(res.found).toBe(true); // the good one still counts
    expect(res.urls).toEqual([`${base}/a`, `${base}/b`]);
    expect(res.unreadable).toEqual([`${base}/not-xml.xml`, `${base}/missing.xml`]);
  });

  test("no readable sitemap anywhere → found=false", async () => {
    const res = await fetchSitemaps([`${base}/missing.xml`], opts);
    expect(res.found).toBe(false);
    expect(res.urls).toEqual([]);
  });

  test("index exceeding the file cap reports truncated=true", async () => {
    const res = await fetchSitemaps([`${base}/big-index.xml`], opts);
    expect(res.truncated).toBe(true);
    expect(res.urls.length).toBeGreaterThan(0); // partial results still returned
  });

  test("small discovery is NOT truncated", async () => {
    const res = await fetchSitemaps([`${base}/sitemap.xml`], opts);
    expect(res.truncated).toBe(false);
  });

  test("cross-host index children are dropped (request-gadget guard)", async () => {
    const res = await fetchSitemaps([`${base}/evil-index.xml`], opts);
    // Same-host child processed; other-host.invalid child never fetched
    // (a fetch attempt would surface as unreadable via DNS failure).
    expect(res.urls).toEqual([`${base}/a`, `${base}/b`]);
    expect(res.unreadable).toEqual([]);
  });
});
