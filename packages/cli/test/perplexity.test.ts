import { describe, expect, test } from "bun:test";
import { PerplexityProvider } from "../src/providers/perplexity";
import type { ProviderError } from "../src/core/types";

describe("PerplexityProvider", () => {
  test("queries Sonar with web search and trusts the API's itemized cost", async () => {
    let requestInit: RequestInit | undefined;
    const provider = new PerplexityProvider({
      apiKey: "secret-perplexity-key",
      fetch: async (_input, init) => {
        requestInit = init;
        return Response.json({
          choices: [{ message: { content: "Acme is frequently recommended." } }],
          citations: [
            "https://example.com/one",
            { url: "https://example.com/two", title: "Comparison", snippet: "Top tools" },
          ],
          usage: {
            prompt_tokens: 800,
            completion_tokens: 300,
            cost: { total_cost: 0.0123 },
          },
        });
      },
    });

    const result = await provider.query({ prompt: "best tools", model: "sonar" });
    const body = JSON.parse(String(requestInit?.body));
    expect(new Headers(requestInit?.headers).get("authorization")).toBe(
      "Bearer secret-perplexity-key",
    );
    expect(body.web_search_options.search_context_size).toBe("medium");
    expect(result.search_results).toHaveLength(2);
    expect(result.cost_usd).toBe(0.0123);
  });

  test("normalizes authentication failures", async () => {
    const provider = new PerplexityProvider({
      apiKey: "bad",
      fetch: async () => Response.json(
        { error: { message: "Invalid API key" } },
        { status: 401 },
      ),
    });
    try {
      await provider.query({ prompt: "test", model: "sonar" });
      throw new Error("expected query to fail");
    } catch (error) {
      expect((error as ProviderError).kind).toBe("auth");
      expect((error as ProviderError).message).toContain("PERPLEXITY_API_KEY");
    }
  });
});
