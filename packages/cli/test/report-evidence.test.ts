import { describe, expect, test } from "bun:test";
import type { CallRow, CitationRow, PromptRow, RunRow } from "../src/core/db";
import { computeGap, computeRates } from "../src/core/gap";
import { renderHtmlReport } from "../src/core/render-html";

function reportWithResponse(response: string): string {
  const timestamp = "2026-09-15T09:00:00.000Z";
  const prompts: PromptRow[] = [{
    prompt_id: "p1", prompt_text: "Best analytics tools?", provider: "openai",
    model: "test-model", config_blob: "{}", created_at: timestamp,
  }];
  const calls: CallRow[] = [{
    run_id: "r1", prompt_id: "p1", sample_index: 0, ts: timestamp,
    response_text: response, search_results_json: "[]", latency_ms: 200,
    tokens_in: 100, tokens_out: 80, cost_usd: 0.01,
    error_code: null, error_message: null,
  }];
  const citations: CitationRow[] = [{
    run_id: "r1", prompt_id: "p1", sample_index: 0,
    brand: "Globex", matched_text: "Globex", kind: "name",
  }];
  const runs: RunRow[] = [{
    run_id: "r1", started_at: timestamp, finished_at: timestamp, config_hash: "test",
  }];
  const rates = computeRates(calls, citations, prompts, ["Acme", "Globex"]);
  return renderHtmlReport({
    brand_name: "Acme", competitor_names: ["Globex"], rates,
    gaps: computeGap(rates, "Acme", ["Globex"]), calls, citations, runs,
    since_iso: timestamp, generated_at: timestamp, project_version: "test", prompts,
  });
}

async function elements(html: string, selector: string): Promise<Array<Record<string, string>>> {
  const found: Array<Record<string, string>> = [];
  await new HTMLRewriter().on(selector, {
    element(element) { found.push(Object.fromEntries(element.attributes)); },
  }).transform(new Response(html)).text();
  return found;
}

async function textContent(html: string, selector: string): Promise<string> {
  let content = "";
  await new HTMLRewriter().on(selector, {
    text(chunk) { content += chunk.text; },
  }).transform(new Response(html)).text();
  return content;
}

describe("report response evidence", () => {
  test("renders untrusted HTML as text without executable elements", async () => {
    const payload = '<script>alert("demo")</script><img src=x onerror="alert(1)">';
    const html = reportWithResponse(payload);
    expect(await elements(html, ".response script, .response img")).toHaveLength(0);
    expect(html).toContain("&lt;script&gt;alert(&quot;demo&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  test("never makes javascript or data Markdown destinations clickable", async () => {
    const html = reportWithResponse(
      '[run](javascript:alert(1)) [mixed](JaVaScRiPt:alert(2)) [data](data:text/html,<script>alert(3)</script>)',
    );
    expect(await elements(html, ".response a")).toHaveLength(0);
    expect(await elements(html, ".response script")).toHaveLength(0);
    expect(await textContent(html, ".response")).toContain("javascript:alert(1)");
  });

  test("escapes quotes in a link destination without creating attributes", async () => {
    const url = 'https://example.com/"onmouseover="alert(1)';
    const html = reportWithResponse(`[A source](${url})`);
    const links = await elements(html, ".response a");
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      href: "https://example.com/&quot;onmouseover=&quot;alert(1)",
      target: "_blank", rel: "noopener noreferrer",
    });
    expect(await elements(html, ".response [onmouseover]")).toHaveLength(0);
  });

  test("preserves balanced parentheses and competitor names in HTTPS destinations", async () => {
    const url = "https://example.com/Globex_(analytics)?ref=Acme&source=report";
    const html = reportWithResponse(`[Globex documentation](${url})`);
    const links = await elements(html, ".response a");
    expect(links).toHaveLength(1);
    expect(links[0]?.href).toBe(url.replaceAll("&", "&amp;"));
    expect(await elements(html, ".response a .mark-competitor")).toHaveLength(1);
    expect(await textContent(html, ".response")).toBe("Globex documentation");
  });

  test("uses native disclosure with its response outside the summary and table cells", async () => {
    const html = reportWithResponse("An answer that can be expanded and read in full.");
    expect(await elements(html, "details.evidence-row > summary")).toHaveLength(1);
    expect(await elements(html, "details.evidence-row > .evidence-body > .response")).toHaveLength(1);
    expect(await elements(html, "summary .response, td .response")).toHaveLength(0);
    // Check the final response declarations: earlier legacy rules must be
    // overridden so long answers use page scrolling rather than a nested pane.
    const responseRules = [...html.matchAll(/\.response\s*\{([^}]+)\}/g)]
      .map((match) => match[1]!).join(";");
    const declarations = Object.fromEntries(responseRules.split(";").map((rule) => {
      const colon = rule.indexOf(":");
      return [rule.slice(0, colon).trim(), rule.slice(colon + 1).trim()];
    }));
    expect(declarations["max-height"]).toBe("none");
    expect(declarations.overflow).toBe("visible");
    expect(declarations["max-width"]).toBe("76ch");
  });

  test("renders headings, bold text, bullet variants and numbered lists semantically", async () => {
    const html = reportWithResponse(
      "### Recommendations\n- **Privacy first**\n* Easy setup\n+ Clear pricing\n\n1. Compare options\n2. Try a pilot",
    );
    expect(await textContent(html, ".response-heading")).toBe("Recommendations");
    expect(await elements(html, ".response ul > li")).toHaveLength(3);
    expect(await elements(html, ".response ol > li")).toHaveLength(2);
    expect(await textContent(html, ".response strong")).toBe("Privacy first");
  });

  test("preserves numbering after an explanatory paragraph separates list items", async () => {
    const html = reportWithResponse(
      "1. Compare options\n\nChoose criteria that match your buyers.\n\n2. Try a pilot\n3. Measure results",
    );
    const lists = await elements(html, ".response ol");
    expect(lists).toHaveLength(2);
    expect(lists[0]?.start).toBeUndefined();
    expect(lists[1]?.start).toBe("2");
    expect(await elements(html, '.response ol[start="2"] > li')).toHaveLength(2);
    expect(await textContent(html, ".response p")).toBe("Choose criteria that match your buyers.");
  });
});
