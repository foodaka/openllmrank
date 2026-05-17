import { describe, expect, test } from "bun:test";
import { extractCitations } from "../src/core/citations";
import type { Brand } from "../src/core/types";

const acme: Brand = { name: "Acme", aliases: ["acme.com", "Acme Inc"] };
const globex: Brand = { name: "Globex", aliases: ["globex.com"] };
const initech: Brand = { name: "Initech", aliases: ["initech.io", "Initech Corp"] };
const all: Brand[] = [acme, globex, initech];

describe("extractCitations", () => {
  test("empty text returns empty", () => {
    expect(extractCitations("", all)).toEqual([]);
  });

  test("empty brands list returns empty", () => {
    expect(extractCitations("Some text about Acme.", [])).toEqual([]);
  });

  test("matches a single brand name", () => {
    const out = extractCitations("Acme is great.", all);
    expect(out).toHaveLength(1);
    expect(out[0]?.brand).toBe("Acme");
    expect(out[0]?.kind).toBe("name");
  });

  test("does not match substring inside a longer word", () => {
    const out = extractCitations("AcmeCorp launched a product.", all);
    expect(out.find((c) => c.brand === "Acme")).toBeUndefined();
  });

  test("matches case-insensitively", () => {
    const out = extractCitations("acme is one option. ACME another. Acme third.", all);
    const acmeHits = out.filter((c) => c.brand === "Acme" && c.kind === "name");
    expect(acmeHits).toHaveLength(3);
  });

  test("matches possessive form", () => {
    const out = extractCitations("Acme's product is fast.", all);
    expect(out.find((c) => c.brand === "Acme" && c.kind === "name")).toBeDefined();
  });

  test("matches with trailing punctuation", () => {
    const out = extractCitations("I like Acme, Globex, and Initech.", all);
    expect(out.filter((c) => c.kind === "name").length).toBe(3);
  });

  test("matches URL alias as kind=url", () => {
    const out = extractCitations("See https://acme.com for details.", all);
    expect(out.find((c) => c.brand === "Acme" && c.kind === "url")).toBeDefined();
  });

  test("does not match URL alias as a name", () => {
    const out = extractCitations("Visit acme.com for info.", all);
    const urlHits = out.filter((c) => c.brand === "Acme" && c.kind === "url");
    expect(urlHits).toHaveLength(1);
  });

  test("matches markdown link to brand", () => {
    const out = extractCitations("Check out [Acme](https://acme.com) today.", all);
    const acmeHits = out.filter((c) => c.brand === "Acme");
    expect(acmeHits.length).toBeGreaterThanOrEqual(2);
    expect(acmeHits.find((c) => c.kind === "name")).toBeDefined();
    expect(acmeHits.find((c) => c.kind === "url")).toBeDefined();
  });

  test("multi-word alias matches", () => {
    const out = extractCitations("Acme Inc is the best.", all);
    expect(out.find((c) => c.brand === "Acme" && c.matched_text === "Acme Inc")).toBeDefined();
  });

  test("multiple distinct brand mentions", () => {
    const text = "Acme vs Globex: Globex Corp is also called globex.com.";
    const out = extractCitations(text, all);
    const brands = new Set(out.map((c) => c.brand));
    expect(brands.has("Acme")).toBe(true);
    expect(brands.has("Globex")).toBe(true);
  });

  test("no false positive for substring of unrelated word", () => {
    const out = extractCitations("Sacme is not Acme.", all);
    const acmeHits = out.filter((c) => c.brand === "Acme" && c.kind === "name");
    expect(acmeHits).toHaveLength(1);
  });

  test("URL with path still matches", () => {
    const out = extractCitations("https://acme.com/pricing has details.", all);
    expect(out.find((c) => c.brand === "Acme" && c.kind === "url")).toBeDefined();
  });

  test("dedupes identical url match", () => {
    const out = extractCitations("acme.com and acme.com again.", all);
    const urlHits = out.filter((c) => c.brand === "Acme" && c.kind === "url");
    expect(urlHits).toHaveLength(2);
  });

  test("brand vs competitor alias overlap respects longest-first ordering", () => {
    const overlap: Brand[] = [
      { name: "OpenAI", aliases: [] },
      { name: "OpenAI Codex", aliases: [] },
    ];
    const text = "OpenAI Codex is a tool.";
    const out = extractCitations(text, overlap);
    expect(out.find((c) => c.brand === "OpenAI Codex")).toBeDefined();
  });

  test("brand inside parentheses", () => {
    const out = extractCitations("The leader (Acme) ships fastest.", all);
    expect(out.find((c) => c.brand === "Acme" && c.kind === "name")).toBeDefined();
  });

  test("brand at start of string", () => {
    const out = extractCitations("Acme is mentioned.", all);
    expect(out.find((c) => c.brand === "Acme")).toBeDefined();
  });

  test("brand at end of string with no terminal punctuation", () => {
    const out = extractCitations("The best is Acme", all);
    expect(out.find((c) => c.brand === "Acme")).toBeDefined();
  });

  test("ignores text where alias is purely substring", () => {
    const out = extractCitations("Macme is not what we mean.", all);
    expect(out.find((c) => c.brand === "Acme")).toBeUndefined();
  });

  test("grounded sources match brand by URL", () => {
    const out = extractCitations(
      "No mention in prose.",
      all,
      [{ url: "https://acme.com/about", title: "About Acme", snippet: "" }],
    );
    expect(out.find((c) => c.brand === "Acme" && c.kind === "grounded_source")).toBeDefined();
  });

  test("grounded sources match brand by name in title", () => {
    const out = extractCitations(
      "",
      all,
      [{ url: "https://example.com", title: "Why Globex wins", snippet: "" }],
    );
    expect(out.find((c) => c.brand === "Globex" && c.kind === "grounded_source")).toBeDefined();
  });

  test("grounded source dedupes per (brand, url)", () => {
    const out = extractCitations(
      "",
      all,
      [{ url: "https://acme.com", title: "Acme", snippet: "About Acme" }],
    );
    const groundedHits = out.filter((c) => c.brand === "Acme" && c.kind === "grounded_source");
    expect(groundedHits).toHaveLength(1);
  });

  test("text with all three brands and URLs", () => {
    const text =
      "Top tools: Acme (acme.com), Globex (globex.com), and Initech (initech.io).";
    const out = extractCitations(text, all);
    const namesByBrand: Record<string, number> = {};
    const urlsByBrand: Record<string, number> = {};
    for (const c of out) {
      if (c.kind === "name") namesByBrand[c.brand] = (namesByBrand[c.brand] ?? 0) + 1;
      if (c.kind === "url") urlsByBrand[c.brand] = (urlsByBrand[c.brand] ?? 0) + 1;
    }
    expect(namesByBrand.Acme).toBeGreaterThanOrEqual(1);
    expect(namesByBrand.Globex).toBeGreaterThanOrEqual(1);
    expect(namesByBrand.Initech).toBeGreaterThanOrEqual(1);
    expect(urlsByBrand["Acme"]).toBeGreaterThanOrEqual(1);
  });

  test("ignores empty alias entry safely", () => {
    const out = extractCitations("Acme rules.", [{ name: "Acme", aliases: [""] }]);
    expect(out.length).toBeGreaterThan(0);
  });
});
