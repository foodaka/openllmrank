import { describe, expect, test } from "bun:test";
import {
  createReportToken,
  getVerifiedReportTokenExpiry,
  verifyReportToken,
} from "../src/report-token";

const JOB_ID = "00000000-0000-4000-8000-000000000000";
const SECRET = "test-report-link-secret";
const NOW = 1_800_000_000;

describe("report link tokens", () => {
  test("round-trips an unexpired token for its job", () => {
    const token = createReportToken(JOB_ID, SECRET, NOW + 3600);

    expect(verifyReportToken(token, JOB_ID, SECRET, NOW)).toBe(true);
    expect(verifyReportToken(token, `${JOB_ID.slice(0, -1)}1`, SECRET, NOW)).toBe(false);
  });

  test("rejects a token after one character is changed", () => {
    const token = createReportToken(JOB_ID, SECRET, NOW + 3600);
    const index = Math.floor(token.length / 2);
    const replacement = token[index] === "A" ? "B" : "A";
    const tampered = `${token.slice(0, index)}${replacement}${token.slice(index + 1)}`;

    expect(verifyReportToken(tampered, JOB_ID, SECRET, NOW)).toBe(false);
  });

  test("rejects expired and malformed tokens", () => {
    const expired = createReportToken(JOB_ID, SECRET, NOW);

    expect(verifyReportToken(expired, JOB_ID, SECRET, NOW)).toBe(false);
    expect(verifyReportToken("not-a-token", JOB_ID, SECRET, NOW)).toBe(false);
  });

  test("reads the expiry only from a correctly signed token", () => {
    const expiresAt = NOW - 3600;
    const token = createReportToken(JOB_ID, SECRET, expiresAt);

    expect(getVerifiedReportTokenExpiry(token, JOB_ID, SECRET)).toBe(expiresAt);
    expect(getVerifiedReportTokenExpiry(`${token}A`, JOB_ID, SECRET)).toBeNull();
  });
});
