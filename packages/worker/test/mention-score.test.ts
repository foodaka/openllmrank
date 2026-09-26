// Scoring rules for the free mention check: what counts as a mention, what
// the visitor sees, and which URLs are trusted enough to link.

import { describe, expect, test } from "bun:test";
import { questionHash, scoreAnswer } from "../src/mention-score";

const brand = { name: "Acme", domain: "acme.com" };

function answer(response_text: string, search_results: { url: string; title?: string }[] = []) {
  return { provider: "openai", model: "gpt-5.4-mini", response_text, search_results, cached: false };
}

describe("scoreAnswer", () => {
  test("a name mention is found and excerpted", () => {
    const r = scoreAnswer(answer("For small teams, Acme and Globex are the usual picks."), brand);
    expect(r.mentioned).toBe(true);
    expect(r.excerpts).toHaveLength(1);
    expect(r.excerpts[0]).toContain("Acme");
  });

  test("a substring of another word is not a mention", () => {
    const r = scoreAnswer(answer("Acmeish tools and Acmecorp dominate."), brand);
    expect(r.mentioned).toBe(false);
    expect(r.excerpts).toEqual([]);
  });

  test("a cited source on the brand's domain counts, and is flagged", () => {
    const r = scoreAnswer(
      answer("Globex leads this category.", [
        { url: "https://www.acme.com/pricing", title: "Pricing" },
        { url: "https://review.example/best", title: "Best tools" },
      ]),
      brand,
    );
    expect(r.mentioned).toBe(true);
    expect(r.sources.map((s) => [s.domain, s.is_brand])).toEqual([
      ["acme.com", true],
      ["review.example", false],
    ]);
  });

  test("brands with punctuation match (word boundaries only where the name has word characters)", () => {
    const r = scoreAnswer(answer("Most shops use C++ for this."), { name: "C++", domain: "cpp.example" });
    expect(r.mentioned).toBe(true);
    expect(r.excerpts[0]).toContain("C++");
  });

  test("unsafe and duplicate source URLs are dropped", () => {
    const r = scoreAnswer(
      answer("Nothing here.", [
        { url: "javascript:alert(1)" },
        { url: "https://user:pass@evil.example/" },
        { url: "https://ok.example/a" },
        { url: "https://ok.example/a" },
      ]),
      brand,
    );
    expect(r.sources.map((s) => s.url)).toEqual(["https://ok.example/a"]);
  });

  test("the preview is flattened and capped", () => {
    const r = scoreAnswer(answer(`Line one\n\n${"word ".repeat(400)}`), brand);
    expect(r.answer_preview.startsWith("Line one word")).toBe(true);
    expect(r.answer_preview.length).toBeLessThanOrEqual(701);
    expect(r.answer_preview.endsWith("…")).toBe(true);
  });

  test("at most three excerpts, overlapping mentions merged", () => {
    const text = Array.from({ length: 6 }, (_, i) => `${"filler ".repeat(40)}Acme ${i}`).join(" ");
    const r = scoreAnswer(answer(text), brand);
    expect(r.excerpts).toHaveLength(3);
    const close = scoreAnswer(answer("Acme, then Acme again, then Acme."), brand);
    expect(close.excerpts).toHaveLength(1);
  });
});

describe("questionHash", () => {
  test("ignores case and whitespace, distinguishes wording", () => {
    expect(questionHash("Best CRM  for agencies?")).toBe(questionHash("  best crm for AGENCIES? "));
    expect(questionHash("Best CRM for agencies?")).not.toBe(questionHash("Best CRM for startups?"));
  });
});
