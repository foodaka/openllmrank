import { describe, expect, test } from "bun:test";
import {
  canonicalKey,
  domainInputToOrigin,
  isSameHost,
  normalizeUrl,
  RedirectMap,
} from "../src/normalize";

describe("normalizeUrl", () => {
  test("lowercases host, drops default port and fragment", () => {
    expect(normalizeUrl("HTTPS://Example.COM:443/Path#frag")).toBe(
      "https://example.com/Path",
    );
    expect(normalizeUrl("http://example.com:80/a")).toBe("http://example.com/a");
  });

  test("does NOT collapse www/apex, scheme, or trailing slash", () => {
    // These are different URLs until a redirect proves otherwise (Codex
    // finding 3 / decision 5A).
    expect(normalizeUrl("https://www.example.com/")).not.toBe(
      normalizeUrl("https://example.com/"),
    );
    expect(normalizeUrl("http://example.com/")).not.toBe(
      normalizeUrl("https://example.com/"),
    );
    expect(normalizeUrl("https://example.com/a")).not.toBe(
      normalizeUrl("https://example.com/a/"),
    );
  });

  test("resolves relative URLs against a base", () => {
    expect(normalizeUrl("/blog", "https://example.com/post")).toBe(
      "https://example.com/blog",
    );
  });

  test("rejects non-http and garbage", () => {
    expect(normalizeUrl("mailto:x@example.com")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("::::")).toBeNull();
  });
});

describe("RedirectMap + canonicalKey", () => {
  test("collapses only observed redirects", () => {
    const map = new RedirectMap();
    expect(canonicalKey("https://example.com/a", map)).toBe("https://example.com/a");

    map.record("https://example.com/a", "https://example.com/a/");
    expect(canonicalKey("https://example.com/a", map)).toBe("https://example.com/a/");
    // Unobserved variants stay distinct.
    expect(canonicalKey("https://example.com/b", map)).toBe("https://example.com/b");
  });

  test("resolves chains and survives cycles", () => {
    const map = new RedirectMap();
    map.record("http://example.com/", "https://example.com/");
    map.record("https://example.com/", "https://www.example.com/");
    expect(canonicalKey("http://example.com/", map)).toBe("https://www.example.com/");

    map.record("https://cycle.com/x", "https://cycle.com/y");
    map.record("https://cycle.com/y", "https://cycle.com/x");
    // Bounded resolution — must terminate.
    expect(typeof canonicalKey("https://cycle.com/x", map)).toBe("string");
  });
});

describe("isSameHost", () => {
  test("exact hostname only", () => {
    expect(isSameHost("https://example.com/a", "example.com")).toBe(true);
    expect(isSameHost("https://WWW.example.com/a", "example.com")).toBe(false);
    expect(isSameHost("https://evil.com/example.com", "example.com")).toBe(false);
    expect(isSameHost("not a url", "example.com")).toBe(false);
  });
});

describe("domainInputToOrigin", () => {
  test("accepts bare domains and full URLs", () => {
    expect(domainInputToOrigin("example.com")).toBe("https://example.com");
    expect(domainInputToOrigin("  HTTPS://Example.com/path?q=1 ")).toBe(
      "https://example.com",
    );
    expect(domainInputToOrigin("http://example.com")).toBe("http://example.com");
  });

  test("rejects ports, credentials, dotless names, garbage", () => {
    expect(domainInputToOrigin("example.com:8080")).toBeNull();
    expect(domainInputToOrigin("https://user:pw@example.com")).toBeNull();
    expect(domainInputToOrigin("localhost")).toBeNull();
    expect(domainInputToOrigin("intranet")).toBeNull();
    expect(domainInputToOrigin("")).toBeNull();
    expect(domainInputToOrigin("ht!tp://???")).toBeNull();
  });
});
