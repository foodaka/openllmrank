import { describe, expect, test } from "bun:test";
import { extractFromHtml } from "../src/extract";

const BASE = "https://example.com/page";

describe("extractFromHtml", () => {
  test("extracts absolute + relative links, canonical, meta, title", async () => {
    const html = `<!doctype html><html><head>
      <title>Hello</title>
      <link rel="canonical" href="https://example.com/canonical-target">
      <meta name="description" content="A page.">
      <meta name="robots" content="index,follow">
    </head><body>
      <a href="/a">a</a>
      <a href="https://example.com/b#frag">b</a>
      <a href="https://other.com/c">offsite</a>
      <a href="mailto:x@example.com">mail</a>
    </body></html>`;
    const out = await extractFromHtml(html, BASE);
    expect(out.links).toContain("https://example.com/a");
    expect(out.links).toContain("https://example.com/b"); // fragment dropped
    expect(out.links).toContain("https://other.com/c"); // offsite kept; crawler filters
    expect(out.links).not.toContain("mailto:x@example.com");
    expect(out.canonical).toBe("https://example.com/canonical-target");
    expect(out.noindex).toBe(false);
    expect(out.titlePresent).toBe(true);
    expect(out.descriptionPresent).toBe(true);
  });

  test("detects noindex and missing title/description", async () => {
    const html = `<html><head>
      <title>   </title>
      <meta name="robots" content="NOINDEX, nofollow">
    </head><body></body></html>`;
    const out = await extractFromHtml(html, BASE);
    expect(out.noindex).toBe(true);
    expect(out.titlePresent).toBe(false);
    expect(out.descriptionPresent).toBe(false);
  });

  test("handles hostile/malformed HTML without throwing", async () => {
    const html = `<a href="/ok"><<<>>><a href=><meta name=robots content=><title>`;
    const out = await extractFromHtml(html, BASE);
    expect(out.links).toContain("https://example.com/ok");
  });
});
