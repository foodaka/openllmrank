// Comparison pages (/vs/[slug], /alternatives) and the generated llms.txt.
// Pure functions, no DB or network.

import { describe, expect, test } from "bun:test";
import sitemap from "../app/sitemap";
import { renderLlmsTxt } from "../app/llms.txt/route";
import { competitors, getCompetitor, OUR_PRODUCT } from "../lib/compare";
import { getAllPosts } from "../lib/blog";

describe("competitor registry", () => {
  test("slugs are unique and resolve", () => {
    const slugs = competitors.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(getCompetitor(s)?.slug).toBe(s);
    expect(getCompetitor("nope")).toBeUndefined();
  });

  for (const c of competitors) {
    test(`${c.slug}: sourced facts, honest picks, dated, titles fit`, () => {
      // At least 5 specific facts, each from the vendor's own site.
      expect(c.facts.length).toBeGreaterThanOrEqual(5);
      for (const f of c.facts) {
        const host = new URL(f.source).hostname.replace(/^www\./, "");
        expect(host).toBe(c.domain);
        expect(f.source.startsWith("https://")).toBe(true);
      }
      // At least 3 cases where the competitor is the better choice.
      expect(c.pickThemIf.length).toBeGreaterThanOrEqual(3);
      expect(c.pickUsIf.length).toBeGreaterThanOrEqual(3);
      expect(c.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.faq.length).toBeGreaterThanOrEqual(3);
      // Google truncates around 60 chars; the template adds " — openllmrank".
      expect(c.title.length).toBeLessThanOrEqual(60);
      expect(c.description.length).toBeLessThanOrEqual(240);
    });
  }

  test("our numbers come from the hosted caps", () => {
    expect(OUR_PRODUCT.answersPerRun).toBe(OUR_PRODUCT.maxPrompts * OUR_PRODUCT.samples * OUR_PRODUCT.providers);
    expect(OUR_PRODUCT.providers).toBe(5);
  });
});

describe("sitemap and llms.txt include the comparison pages", () => {
  test("sitemap lists /alternatives and every /vs/ page", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain("https://openllmrank.io/alternatives");
    for (const c of competitors) expect(urls).toContain(`https://openllmrank.io/vs/${c.slug}`);
  });

  test("llms.txt lists comparisons, free tools, methodology, and every post", () => {
    const txt = renderLlmsTxt();
    expect(txt.startsWith("# openllmrank\n")).toBe(true);
    expect(txt).toContain("https://openllmrank.io/alternatives");
    for (const c of competitors) expect(txt).toContain(`https://openllmrank.io/vs/${c.slug}`);
    for (const p of getAllPosts()) expect(txt).toContain(`https://openllmrank.io/blog/${p.slug}`);
    for (const path of ["/snapshot", "/check", "/methodology", "/api/mcp"]) {
      expect(txt).toContain(`https://openllmrank.io${path}`);
    }
    // Prices match the homepage copy.
    expect(txt).toContain("$79");
    expect(txt).toContain("$49/month");
  });
});
