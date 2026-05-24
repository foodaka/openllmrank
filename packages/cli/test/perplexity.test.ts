import { describe, expect, test } from "bun:test";
import { PerplexityProvider } from "../src/providers/perplexity";
import type { ProviderError } from "../src/core/types";

type FetchImpl = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("PerplexityProvider", () => {
  test("calls Perplexity chat completions and extracts text, citations, usage, and cost", async () => {
    let request: { url: string; body: unknown; authorization: string | null } | undefined;
    const fetch: FetchImpl = async (url, init) => {
      request = {
        url: String(url),
        body: JSON.parse(String(init?.body)),
        authorization: new Headers(init?.headers).get("authorization"),
      };
      return jsonResponse({
        choices: [{ message: { content: "Acme is cited in AI answers." } }],
        citations: ["https://acme.com", "https://acme.com", "https://example.com/report"],
        usage: { prompt_tokens: 12, completion_tokens: 34 },
      });
    };

    const provider = new PerplexityProvider({ apiKey: "test-key", fetch });
    const result = await provider.query({ prompt: "Who leads?", model: "sonar" });

    expect(request?.url).toBe("https://api.perplexity.ai/chat/completions");
    expect(request?.authorization).toBe("Bearer test-key");
    expect(request?.body).toEqual({
      model: "sonar",
      messages: [{ role: "user", content: "Who leads?" }],
      web_search_options: { search_context_size: "medium" },
    });
    expect(result.response_text).toBe("Acme is cited in AI answers.");
    expect(result.search_results).toEqual([
      { url: "https://acme.com" },
      { url: "https://example.com/report" },
    ]);
    expect(result.tokens_in).toBe(12);
    expect(result.tokens_out).toBe(34);
    expect(result.cost_usd).toBeGreaterThan(0);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  test("translates 401 API errors to auth ProviderError", async () => {
    const fetch: FetchImpl = async () => jsonResponse({ error: { message: "bad key" } }, 401);
    const provider = new PerplexityProvider({ apiKey: "bad", fetch });

    let caught: unknown;
    try {
      await provider.query({ prompt: "x", model: "sonar" });
    } catch (e) {
      caught = e;
    }

    expect((caught as ProviderError).kind).toBe("auth");
    expect((caught as ProviderError).message).toContain("PERPLEXITY_API_KEY");
    expect((caught as ProviderError).http_status).toBe(401);
  });

  test("constructor without API key throws auth error", () => {
    const original = process.env.PERPLEXITY_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
    try {
      let caught: unknown;
      try {
        new PerplexityProvider({ fetch: async () => jsonResponse({}) });
      } catch (e) {
        caught = e;
      }
      expect((caught as ProviderError).kind).toBe("auth");
    } finally {
      if (original) process.env.PERPLEXITY_API_KEY = original;
    }
  });
});
