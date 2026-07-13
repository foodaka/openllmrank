import { describe, expect, test } from "bun:test";
import { GeminiProvider } from "../src/providers/gemini";
import type { ProviderError } from "../src/core/types";

describe("GeminiProvider", () => {
  test("uses the API-key header, enables Google Search, and returns grounded sources", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const provider = new GeminiProvider({
      apiKey: "secret-google-key",
      fetch: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return Response.json({
          candidates: [{
            content: { parts: [{ text: "Acme is one option." }] },
            groundingMetadata: {
              webSearchQueries: ["best analytics", "analytics shortlist"],
              groundingChunks: [
                { web: { uri: "https://example.com/rankings", title: "Rankings" } },
                { web: { uri: "https://example.com/rankings", title: "Duplicate" } },
              ],
            },
          }],
          usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 },
        });
      },
    });

    const result = await provider.query({
      prompt: "best analytics tools",
      model: "gemini-3.5-flash",
    });

    expect(requestUrl).not.toContain("secret-google-key");
    expect(new Headers(requestInit?.headers).get("x-goog-api-key")).toBe("secret-google-key");
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      tools: [{ google_search: {} }],
    });
    expect(result.response_text).toBe("Acme is one option.");
    expect(result.search_results).toEqual([
      { url: "https://example.com/rankings", title: "Rankings" },
    ]);
    expect(result.cost_usd).toBeCloseTo(0.034, 8);
  });

  test("normalizes rate limits and retry-after", async () => {
    const provider = new GeminiProvider({
      apiKey: "test",
      fetch: async () => Response.json(
        { error: { message: "Too many requests" } },
        { status: 429, headers: { "retry-after": "2" } },
      ),
    });

    try {
      await provider.query({ prompt: "test", model: "gemini-3.5-flash" });
      throw new Error("expected query to fail");
    } catch (error) {
      expect((error as ProviderError).kind).toBe("rate_limit");
      expect((error as ProviderError).retry_after_ms).toBe(2000);
    }
  });
});
