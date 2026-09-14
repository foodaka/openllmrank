import { describe, expect, test } from "bun:test";
import { analyzeRobots } from "../src/robots";

const URL = "https://example.com/robots.txt";

describe("analyzeRobots", () => {
  test("missing robots.txt: everything allowed, nothing found", () => {
    const info = analyzeRobots(URL, null);
    expect(info.found).toBe(false);
    expect(info.blocksAll).toBe(false);
    expect(info.sitemaps).toEqual([]);
    expect(info.botAccess.every((b) => b.allowed)).toBe(true);
    expect(info.isAllowed("https://example.com/anything")).toBe(true);
  });

  test("blocks-all detected", () => {
    const info = analyzeRobots(URL, "User-agent: *\nDisallow: /\n");
    expect(info.blocksAll).toBe(true);
    expect(info.isAllowed("https://example.com/")).toBe(false);
  });

  test("wildcard-disallow with a specific bot allowed is NOT blocks-all", () => {
    // Common config: block everything by default, allow Googlebot. The site
    // is visible to what matters — reporting it as "invisible by
    // configuration" would be a false critical.
    const info = analyzeRobots(
      URL,
      "User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n",
    );
    expect(info.blocksAll).toBe(false);
    const google = info.botAccess.find((b) => b.bot === "Googlebot");
    expect(google?.allowed).toBe(true);
  });

  test("bot roster categorizes search vs AI-search vs training bots", () => {
    const content = [
      "User-agent: GPTBot",
      "Disallow: /",
      "",
      "User-agent: OAI-SearchBot",
      "Disallow: /",
      "",
      "User-agent: *",
      "Allow: /",
    ].join("\n");
    const info = analyzeRobots(URL, content);
    const byBot = Object.fromEntries(info.botAccess.map((b) => [b.bot, b]));

    expect(byBot["GPTBot"]).toEqual({ bot: "GPTBot", category: "ai_training", allowed: false });
    expect(byBot["OAI-SearchBot"]).toEqual({
      bot: "OAI-SearchBot",
      category: "ai_search",
      allowed: false,
    });
    // Blocking GPTBot does NOT imply ChatGPT-search is blocked — separate bots.
    expect(byBot["Claude-SearchBot"]!.allowed).toBe(true);
    expect(byBot["ClaudeBot"]!.allowed).toBe(true);
    expect(byBot["Googlebot"]).toEqual({
      bot: "Googlebot",
      category: "search_engine",
      allowed: true,
    });
    expect(info.blocksAll).toBe(false);
  });

  test("extracts sitemap declarations", () => {
    const info = analyzeRobots(
      URL,
      "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\nSitemap: https://example.com/blog-sitemap.xml",
    );
    expect(info.sitemaps).toEqual([
      "https://example.com/sitemap.xml",
      "https://example.com/blog-sitemap.xml",
    ]);
  });

  test("path rules apply to our crawler", () => {
    const info = analyzeRobots(URL, "User-agent: *\nDisallow: /private/\n");
    expect(info.isAllowed("https://example.com/public")).toBe(true);
    expect(info.isAllowed("https://example.com/private/x")).toBe(false);
  });
});
