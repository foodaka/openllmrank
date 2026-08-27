import { describe, expect, test } from "bun:test";
import { createReportToken } from "@openllmrank/shared/report-token";
import {
  reportLinkEnforcementEnabled,
  resolveReportAccess,
} from "../lib/report-access";

const JOB_ID = "00000000-0000-4000-8000-000000000000";
const OWNER_ID = "10000000-0000-4000-8000-000000000000";
const OTHER_ID = "20000000-0000-4000-8000-000000000000";
const SECRET = "test-report-link-secret";
const NOW = new Date("2026-08-16T00:00:00.000Z");

function job(overrides: Partial<{
  user_id: string;
  report_link_expires_at: string | null;
}> = {}) {
  return {
    user_id: OWNER_ID,
    report_link_expires_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("report access resolution", () => {
  test("keeps enforcement enabled by default with an explicit rollback", () => {
    expect(reportLinkEnforcementEnabled(undefined)).toBe(true);
    expect(reportLinkEnforcementEnabled("true")).toBe(true);
    expect(reportLinkEnforcementEnabled("false")).toBe(false);
  });

  test("allows a valid signed token without a session", async () => {
    const token = createReportToken(
      JOB_ID,
      SECRET,
      Math.floor(NOW.getTime() / 1000) + 3600,
    );

    await expect(resolveReportAccess({
      jobId: JOB_ID,
      job: job(),
      token,
      hasToken: true,
      secret: SECRET,
      getUserId: async () => null,
      now: NOW,
    })).resolves.toEqual({ allowed: true, method: "signed" });
  });

  test("rejects a tampered token instead of using legacy grace", async () => {
    const token = createReportToken(
      JOB_ID,
      SECRET,
      Math.floor(NOW.getTime() / 1000) + 3600,
    );
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    await expect(resolveReportAccess({
      jobId: JOB_ID,
      job: job(),
      token: tampered,
      hasToken: true,
      secret: SECRET,
      getUserId: async () => null,
      now: NOW,
    })).resolves.toEqual({ allowed: false, status: 401 });
  });

  test("allows an owner session and rejects another tenant with 404", async () => {
    await expect(resolveReportAccess({
      jobId: JOB_ID,
      job: job(),
      token: null,
      hasToken: false,
      secret: SECRET,
      getUserId: async () => OWNER_ID,
      now: NOW,
    })).resolves.toEqual({ allowed: true, method: "session" });

    await expect(resolveReportAccess({
      jobId: JOB_ID,
      job: job(),
      token: null,
      hasToken: false,
      secret: SECRET,
      getUserId: async () => OTHER_ID,
      now: NOW,
    })).resolves.toEqual({ allowed: false, status: 404 });
  });

  test("allows active bare UUID grace and rejects expired bare UUID", async () => {
    await expect(resolveReportAccess({
      jobId: JOB_ID,
      job: job(),
      token: null,
      hasToken: false,
      secret: SECRET,
      getUserId: async () => null,
      now: NOW,
    })).resolves.toEqual({ allowed: true, method: "legacy" });

    await expect(resolveReportAccess({
      jobId: JOB_ID,
      job: job({ report_link_expires_at: "2026-08-15T23:59:59.000Z" }),
      token: null,
      hasToken: false,
      secret: SECRET,
      getUserId: async () => null,
      now: NOW,
    })).resolves.toEqual({ allowed: false, status: 401 });
  });

  test("returns 404 when the job does not exist", async () => {
    await expect(resolveReportAccess({
      jobId: JOB_ID,
      job: null,
      token: null,
      hasToken: false,
      secret: SECRET,
      getUserId: async () => null,
      now: NOW,
    })).resolves.toEqual({ allowed: false, status: 404 });
  });
});
