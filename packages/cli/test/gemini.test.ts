import { describe, expect, test } from "bun:test";
import { GeminiProvider } from "../src/providers/gemini";
import type { ProviderError } from "../src/core/types";

type FetchImpl = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("GeminiProvider", () => {
  test("calls Gemini generateContent with Google Search grounding and extracts text, sources, usage, and cost", async () => {
    let request: { url: string; body: unknown } | undefined;
    const fetch: FetchImpl = async (url, init) => {
      request = { url: String(url), body: JSON.parse(String(init?.body)) };
      return jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: "Acme is visible in AI search." }] },
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: "https://acme.com", title: "Acme" } },
                { web: { uri: "https://acme.com", title: "Duplicate" } },
                { web: { uri: "https://example.com/guide", title: "Guide" } },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 22 },
      });
    };

    const provider = new GeminiProvider({ apiKey: "test-key", fetch });
    const result = await provider.query({ prompt: "Who leads?", model: "gemini-2.0-flash" });

    expect(request?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=test-key",
    );
    expect(request?.body).toEqual({
      contents: [{ role: "user", parts: [{ text: "Who leads?" }] }],
      tools: [{ google_search: {} }],
    });
    expect(result.response_text).toBe("Acme is visible in AI search.");
    expect(result.search_results).toEqual([
      { url: "https://acme.com", title: "Acme" },
      { url: "https://example.com/guide", title: "Guide" },
    ]);
    expect(result.tokens_in).toBe(11);
    expect(result.tokens_out).toBe(22);
    expect(result.cost_usd).toBeGreaterThan(0);
  });

  test("translates 429 API errors to rate_limit ProviderError", async () => {
    const fetch: FetchImpl = async () =>
      jsonResponse({ error: { message: "quota temporarily exhausted" } }, 429, { "retry-after": "3" });
    const provider = new GeminiProvider({ apiKey: "test-key", fetch });

    let caught: unknown;
    try {
      await provider.query({ prompt: "x", model: "gemini-2.0-flash" });
    } catch (e) {
      caught = e;
    }

    expect((caught as ProviderError).kind).toBe("rate_limit");
    expect((caught as ProviderError).retry_after_ms).toBe(3000);
    expect((caught as ProviderError).http_status).toBe(429);
  });

  test("constructor without API key throws auth error", () => {
    const original = process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    try {
      let caught: unknown;
      try {
        new GeminiProvider({ fetch: async () => jsonResponse({}) });
      } catch (e) {
        caught = e;
      }
      expect((caught as ProviderError).kind).toBe("auth");
    } finally {
      if (original) process.env.GOOGLE_API_KEY = original;
    }
  });
});
