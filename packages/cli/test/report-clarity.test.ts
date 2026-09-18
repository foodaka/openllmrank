import { expect, test } from "bun:test";
import { renderHtmlReport } from "../src/core/render-html";

test("report separates absent brands from ties and shows a lead instead of a zero gap", () => {
  const gaps = [
    { prompt_id: "absent", prompt_text: "Absent question", provider: "openai", brand_rate: 0, competitors: [{ name: "Other", rate: 0 }], gap_score: 0 },
    { prompt_id: "tied", prompt_text: "Tied question", provider: "openai", brand_rate: 1, competitors: [{ name: "Other", rate: 1 }], gap_score: 0 },
    { prompt_id: "lead", prompt_text: "Leading question", provider: "openai", brand_rate: 1, competitors: [{ name: "Other", rate: 2 / 3 }], gap_score: -1 / 3 },
  ];
  const html = renderHtmlReport({ brand_name: "Brand", competitor_names: ["Other"], rates: [], gaps, calls: [], citations: [], runs: [], since_iso: "2026-09-18", generated_at: "2026-09-18", project_version: "test" });
  const positiveSection = html.split('<h2 id="wins">')[1]!.split('<h2 id="unseen">')[0]!;
  expect(positiveSection).toContain("Tied question");
  expect(positiveSection).toContain("33-point lead");
  expect(positiveSection).not.toContain("Absent question");
  expect(html.split('<h2 id="unseen">')[1]).toContain("Absent question");
  expect(html).not.toContain("<small> pp</small>");
});
