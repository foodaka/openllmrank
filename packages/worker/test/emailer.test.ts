import { describe, expect, test } from "bun:test";
import {
  renderReportReadyHtml,
  renderReportReadyText,
} from "../src/emailer";

describe("report-ready email", () => {
  test("delivers a report link instead of embedding the full report table", () => {
    const html = renderReportReadyHtml({
      brand_name: "Acme",
      report_url: "https://app.openllmrank.com/reports/00000000-0000-4000-8000-000000000000",
    });
    expect(html).toContain("View report");
    expect(html).toContain("/reports/00000000-0000-4000-8000-000000000000");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Total run cost");
  });

  test("includes the hosted report URL in the plain-text part", () => {
    const text = renderReportReadyText({
      brand_name: "Acme",
      report_url: "https://app.openllmrank.com/reports/report-id",
    });
    expect(text).toContain("https://app.openllmrank.com/reports/report-id");
  });
});
