// The SEO surface this ship touched: robots.ts, sitemap.ts, and the blog
// registry. These are pure functions — and the exact files whose silent
// breakage caused the "Discovered — currently not indexed" incident the
// crawl check was built to catch. No DB, no network.

import { describe, expect, test } from "bun:test";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { getPostBySlug, getRelatedPosts } from "../lib/blog";

const NEW_SLUG = "discovered-currently-not-indexed";

describe("robots.ts + sitemap.ts for the crawl-check ship", () => {
  test("tokenized reports are blocked but /check and the sitemap stay open", () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules[0]! : r.rules!;
    const disallow = Array.isArray(rules.disallow) ? rules.disallow : [rules.disallow];

    // "/check/" (trailing slash) blocks /check/[token] reports...
    expect(disallow).toContain("/check/");
    // ...but must NOT block the tool page itself.
    expect(disallow).not.toContain("/check");
    expect(rules.allow).toBe("/");
    expect(disallow).toContain("/api/");

    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    // The tool page is in the sitemap; the new post is too.
    expect(urls).toContain("https://openllmrank.io/check");
    expect(urls).toContain(`https://openllmrank.io/blog/${NEW_SLUG}`);
    // No tokenized /check/... URL may ever leak into the sitemap.
    expect(urls.some((u) => u.includes("/check/"))).toBe(false);
  });

  test("blog registry: new post resolves and its related links are not typos", () => {
    const post = getPostBySlug(NEW_SLUG);
    expect(post).toBeDefined();
    expect(post!.date).toBe("2026-08-15");
    expect(post!.title).toContain("Discovered");

    // Every related slug must resolve to a real post — a typo here recreates
    // the exact broken-crawl-path failure the post is about.
    const related = getRelatedPosts(NEW_SLUG);
    expect(related.length).toBe(3);
    for (const r of related) {
      expect(getPostBySlug(r.slug)).toBeDefined();
    }
  });
});
