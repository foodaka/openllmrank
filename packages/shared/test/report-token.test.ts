import { describe, expect, test } from "bun:test";
import {
  reportLinkSecret,
  signReportToken,
  signedReportUrl,
  verifyReportToken,
} from "../src/report-token";

const JOB = "384a0dc8-1a79-43c3-98e5-94958da43029";
const SECRET = "0123456789abcdef0123456789abcdef";

describe("report token", () => {
  test("round trips", () => {
    const token = signReportToken(JOB, SECRET);
    const claims = verifyReportToken(token, SECRET);
    expect(claims?.jobId).toBe(JOB);
    expect(claims!.exp * 1000).toBeGreaterThan(Date.now() + 89 * 86_400_000);
  });

  test("rejects a different secret, tampering, garbage, and empty", () => {
    const token = signReportToken(JOB, SECRET);
    expect(verifyReportToken(token, "another-secret-of-similar-length")).toBeNull();
    const raw = Buffer.from(token, "base64url").toString("utf8");
    const tampered = Buffer.from(raw.replace(JOB, JOB.replace("3", "4")), "utf8").toString("base64url");
    expect(verifyReportToken(tampered, SECRET)).toBeNull();
    expect(verifyReportToken("not-a-token", SECRET)).toBeNull();
    expect(verifyReportToken("", SECRET)).toBeNull();
    expect(verifyReportToken(null, SECRET)).toBeNull();
  });

  test("expires", () => {
    const token = signReportToken(JOB, SECRET, 60, 1_000_000_000_000);
    expect(verifyReportToken(token, SECRET, 1_000_000_000_000 + 59_000)).not.toBeNull();
    expect(verifyReportToken(token, SECRET, 1_000_000_000_000 + 61_000)).toBeNull();
  });

  test("signedReportUrl attaches ?t= and strips trailing slashes", () => {
    const url = signedReportUrl("https://openllmrank.io/", JOB, SECRET);
    expect(url.startsWith(`https://openllmrank.io/reports/${JOB}?t=`)).toBe(true);
    const t = new URL(url).searchParams.get("t");
    expect(verifyReportToken(t, SECRET)?.jobId).toBe(JOB);
  });

  test("secret is required in production and defaulted elsewhere", () => {
    expect(() => reportLinkSecret({ NODE_ENV: "production" })).toThrow(/REPORT_LINK_SECRET/);
    expect(reportLinkSecret({ NODE_ENV: "development" })).toMatch(/dev-only/);
    expect(reportLinkSecret({ NODE_ENV: "production", REPORT_LINK_SECRET: SECRET })).toBe(SECRET);
  });
});
