import { describe, expect, test } from "bun:test";
import { XaiProvider } from "../src/providers/xai";
import type { ProviderError } from "../src/core/types";

describe("XaiProvider", () => {
  test("uses the Responses API with web search and extracts unique citations", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const provider = new XaiProvider({
      apiKey: "secret-xai-key",
      fetch: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return Response.json({
          output: [
            { type: "web_search_call" },
            {
              type: "message",
              content: [{
                type: "output_text",
                text: "Acme appears in the shortlist.",
                annotations: [{
                  type: "url_citation",
                  url: "https://example.com/two",
                  title: "Second source",
                }],
              }],
            },
          ],
          citations: ["https://example.com/one", "https://example.com/two"],
          usage: { input_tokens: 1000, output_tokens: 500 },
        });
      },
    });

    const result = await provider.query({ prompt: "best tools", model: "grok-4.5" });
    expect(requestUrl).toBe("https://api.x.ai/v1/responses");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer secret-xai-key");
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      tools: [{ type: "web_search" }],
    });
    expect(result.response_text).toBe("Acme appears in the shortlist.");
    expect(result.search_results).toEqual([
      { url: "https://example.com/one" },
      { url: "https://example.com/two" },
    ]);
    expect(result.cost_usd).toBeCloseTo(0.01, 8);
  });

  test("normalizes service errors as transient", async () => {
    const provider = new XaiProvider({
      apiKey: "test",
      fetch: async () => Response.json({ error: "unavailable" }, { status: 503 }),
    });
    try {
      await provider.query({ prompt: "test", model: "grok-4.5" });
      throw new Error("expected query to fail");
    } catch (error) {
      expect((error as ProviderError).kind).toBe("transient");
      expect((error as ProviderError).http_status).toBe(503);
    }
  });
});
