import { describe, expect, test } from "bun:test";
import { safeNext } from "../lib/safe-next";

describe("safeNext", () => {
  test("keeps same-origin paths with query and hash", () => {
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/dashboard/abc?x=1#y")).toBe("/dashboard/abc?x=1#y");
    expect(safeNext("/reports/123")).toBe("/reports/123");
  });

  test("falls back on anything that could leave the site", () => {
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "/\\\\evil.com",
      "https://evil.com",
      "http://evil.com/dashboard",
      "javascript:alert(1)",
      "/dashboard\r\nSet-Cookie: x",
      "dashboard",
      "",
      null,
      undefined,
      "/login",
      "/auth/callback?code=x",
    ]) {
      expect(safeNext(bad)).toBe("/dashboard");
    }
  });

  test("honours a custom fallback", () => {
    expect(safeNext("//evil.com", "/")).toBe("/");
  });
});
