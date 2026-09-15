import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { accountInviteRedirectUrl, normalizeAccountEmail } from "../lib/account-invite";

const dashboardRoot = join(import.meta.dir, "..", "app", "dashboard");

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

describe("dashboard auth foundation", () => {
  it("keeps the recovery setup destination on the configured site", () => {
    const previous = process.env.NEXT_PUBLIC_SITE_ORIGIN;
    try {
      process.env.NEXT_PUBLIC_SITE_ORIGIN = "https://openllmrank.io/";
      expect(accountInviteRedirectUrl()).toBe("https://openllmrank.io/auth/set-password");
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_ORIGIN;
      else process.env.NEXT_PUBLIC_SITE_ORIGIN = previous;
    }
  });

  it("normalizes customer email addresses before auth operations", () => {
    expect(normalizeAccountEmail("  Customer@Example.COM ")).toBe("customer@example.com");
  });

  it("does not let dashboard routes import the service-role client", () => {
    const offenders = routeFiles(dashboardRoot).filter((file) =>
      /^\s*import[^;]*\bserviceClient\b/m.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
