import { afterEach, describe, expect, test } from "bun:test";
import { clearRobotsCache, extract, scrape } from "../src/core/scraper";

afterEach(() => clearRobotsCache());

describe("extract", () => {
  test("returns title from <title>", () => {
    const html = "<html><head><title>Acme Inc</title></head><body><p>Hello</p></body></html>";
    expect(extract(html).title).toBe("Acme Inc");
  });

  test("falls back to h1 when title is empty", () => {
    const html = "<html><head><title></title></head><body><h1>Acme</h1></body></html>";
    expect(extract(html).title).toBe("Acme");
  });

  test("strips script and style content", () => {
    const html =
      "<html><body><p>Real content here.</p><script>console.log('secret')</script><style>.x{}</style></body></html>";
    const { content } = extract(html);
    expect(content).toContain("Real content here.");
    expect(content).not.toContain("secret");
    expect(content).not.toContain(".x{}");
  });

  test("strips nav, footer, aside, header", () => {
    const html = `
      <html><body>
        <header>Top nav</header>
        <nav>Site nav</nav>
        <main><h1>Office step challenges</h1><p>Compete with coworkers.</p></main>
        <aside>Sidebar ads</aside>
        <footer>Privacy policy</footer>
      </body></html>`;
    const { content } = extract(html);
    expect(content).toContain("Compete with coworkers");
    expect(content).not.toContain("Top nav");
    expect(content).not.toContain("Site nav");
    expect(content).not.toContain("Sidebar ads");
    expect(content).not.toContain("Privacy policy");
  });

  test("prefers <main> content over body fallback", () => {
    const html = `
      <html><body>
        <main><p>Main content for office step challenges.</p></main>
        <div>Other content</div>
      </body></html>`;
    const { content } = extract(html);
    expect(content).toContain("Main content for office step challenges");
  });

  test("falls back to body when no main/article exists", () => {
    const html = "<html><body><p>Just a body paragraph.</p></body></html>";
    expect(extract(html).content).toContain("Just a body paragraph");
  });

  test("collapses whitespace", () => {
    const html = "<html><body><main>line\n\n\n\n\none\n\n   line   two</main></body></html>";
    const { content } = extract(html);
    expect(content).not.toMatch(/\n{4,}/);
    expect(content).not.toContain("   line");
  });

  test("truncates content over MAX_CONTENT_CHARS", () => {
    const big = "a".repeat(20_000);
    const html = `<html><body><main>${big}</main></body></html>`;
    const { content } = extract(html);
    expect(content.length).toBeLessThanOrEqual(8100);
    expect(content).toContain("[...truncated]");
  });

  test("empty body returns empty content", () => {
    const html = "<html><body></body></html>";
    expect(extract(html).content).toBe("");
  });

  test("extracts content from <article> when no main", () => {
    const html =
      "<html><body><article><h2>Title</h2><p>Article paragraph one.</p></article></body></html>";
    expect(extract(html).content).toContain("Article paragraph one");
  });
});

describe("scrape with robots.txt", () => {
  const origFetch = globalThis.fetch;
  let calls: { url: string; init?: RequestInit }[] = [];

  function mockFetch(handlers: Array<(url: string) => Response | Promise<Response> | null>) {
    globalThis.fetch = (async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      for (const h of handlers) {
        const r = await h(url);
        if (r) return r;
      }
      return new Response("default", { status: 200, headers: { "content-type": "text/html" } });
    }) as typeof fetch;
  }

  function restore() {
    globalThis.fetch = origFetch;
    calls = [];
  }

  test("blocks fetch when robots.txt disallows path", async () => {
    mockFetch([
      (url) =>
        url.endsWith("/robots.txt")
          ? new Response("User-agent: *\nDisallow: /private", {
              status: 200,
              headers: { "content-type": "text/plain" },
            })
          : null,
    ]);
    try {
      const r = await scrape("https://example.test/private/page");
      expect(r.ok).toBe(false);
      expect(r.reason).toContain("robots.txt");
    } finally {
      restore();
    }
  });

  test("allows fetch when robots.txt allows path", async () => {
    mockFetch([
      (url) =>
        url.endsWith("/robots.txt")
          ? new Response("User-agent: *\nDisallow:", {
              status: 200,
              headers: { "content-type": "text/plain" },
            })
          : null,
      (url) =>
        url.includes("/page")
          ? new Response("<html><body><main><p>Allowed content here.</p></main></body></html>", {
              status: 200,
              headers: { "content-type": "text/html" },
            })
          : null,
    ]);
    try {
      const r = await scrape("https://example.test/page");
      expect(r.ok).toBe(true);
      expect(r.content).toContain("Allowed content here");
    } finally {
      restore();
    }
  });

  test("treats missing robots.txt as allowed", async () => {
    mockFetch([
      (url) =>
        url.endsWith("/robots.txt") ? new Response("", { status: 404 }) : null,
      (url) =>
        url.includes("/page")
          ? new Response("<html><body><main><p>OK content.</p></main></body></html>", {
              status: 200,
              headers: { "content-type": "text/html" },
            })
          : null,
    ]);
    try {
      const r = await scrape("https://example2.test/page");
      expect(r.ok).toBe(true);
    } finally {
      restore();
    }
  });

  test("respectRobots: false bypasses the check", async () => {
    mockFetch([
      (url) =>
        url.includes("/page")
          ? new Response("<html><body><main><p>Bypassed content.</p></main></body></html>", {
              status: 200,
              headers: { "content-type": "text/html" },
            })
          : null,
    ]);
    try {
      const r = await scrape("https://example3.test/page", { respectRobots: false });
      expect(r.ok).toBe(true);
      const robotsCalls = calls.filter((c) => c.url.endsWith("/robots.txt"));
      expect(robotsCalls).toHaveLength(0);
    } finally {
      restore();
    }
  });
});
