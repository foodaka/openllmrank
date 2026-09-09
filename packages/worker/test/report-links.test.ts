import { afterEach, describe, expect, test } from "bun:test";
import { verifyReportToken } from "@openllmrank/shared/report-token";
import { reportUrlForJob } from "../src/email-retry";

const JOB_ID = "00000000-0000-4000-8000-000000000000";
const previous = {
  DATABASE_URL: process.env.DATABASE_URL,
  REPORT_BASE_URL: process.env.REPORT_BASE_URL,
  REPORT_LINK_SECRET: process.env.REPORT_LINK_SECRET,
};

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54332/postgres";
process.env.REPORT_BASE_URL = "https://app.openllmrank.com";
process.env.REPORT_LINK_SECRET = "test-report-link-secret";

afterEach(() => {
  process.env.DATABASE_URL = previous.DATABASE_URL;
  process.env.REPORT_BASE_URL = previous.REPORT_BASE_URL;
  process.env.REPORT_LINK_SECRET = previous.REPORT_LINK_SECRET;
});

describe("worker report links", () => {
  test("emails a signed report URL", () => {
    const url = new URL(reportUrlForJob(JOB_ID));
    const token = url.searchParams.get("t");

    expect(url.origin + url.pathname).toBe(
      `https://app.openllmrank.com/reports/${JOB_ID}`,
    );
    expect(token).toBeTruthy();
    expect(verifyReportToken(token!, JOB_ID, "test-report-link-secret")).toBe(true);
  });
});
