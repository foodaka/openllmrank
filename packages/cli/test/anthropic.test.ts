import { describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "../src/providers/anthropic";
import type { ProviderError } from "../src/core/types";

class FakeMessages {
  constructor(private impl: () => Promise<unknown>) {}
  create() {
    return this.impl();
  }
}

function makeClient(impl: () => Promise<unknown>): Anthropic {
  return { messages: new FakeMessages(impl) } as unknown as Anthropic;
}

describe("AnthropicProvider", () => {
  test("extracts text from content blocks", async () => {
    const client = makeClient(async () => ({
      content: [
        { type: "text", text: "Acme is the leader." },
        { type: "text", text: "Globex is second." },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    }));
    const p = new AnthropicProvider({ client });
    const r = await p.query({ prompt: "x", model: "claude-haiku-4-5" });
    expect(r.response_text).toContain("Acme is the leader.");
    expect(r.response_text).toContain("Globex is second.");
    expect(r.tokens_in).toBe(10);
    expect(r.tokens_out).toBe(20);
    expect(r.cost_usd).toBeGreaterThan(0);
  });

  test("extracts search_results from text-block citations", async () => {
    const client = makeClient(async () => ({
      content: [
        {
          type: "text",
          text: "Acme leads",
          citations: [
            { type: "web_search_result_location", url: "https://acme.com/about", title: "About Acme", cited_text: "Acme is a leader" },
            { type: "web_search_result_location", url: "https://globex.com", title: "Globex Home", cited_text: "Globex" },
          ],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 10 },
    }));
    const p = new AnthropicProvider({ client });
    const r = await p.query({ prompt: "x", model: "claude-haiku-4-5" });
    expect(r.search_results).toHaveLength(2);
    expect(r.search_results[0]?.url).toBe("https://acme.com/about");
  });

  test("extracts search_results from web_search_tool_result blocks", async () => {
    const client = makeClient(async () => ({
      content: [
        {
          type: "web_search_tool_result",
          content: [
            { url: "https://acme.com", title: "Acme", snippet: "About" },
            { url: "https://globex.com", title: "Globex", snippet: "About globex" },
          ],
        },
        { type: "text", text: "ok" },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const p = new AnthropicProvider({ client });
    const r = await p.query({ prompt: "x", model: "claude-haiku-4-5" });
    expect(r.search_results.length).toBe(2);
  });

  test("dedupes duplicate URLs across blocks", async () => {
    const client = makeClient(async () => ({
      content: [
        {
          type: "text",
          text: "x",
          citations: [{ type: "web_search_result_location", url: "https://acme.com" }],
        },
        {
          type: "web_search_tool_result",
          content: [{ url: "https://acme.com", title: "Acme" }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const p = new AnthropicProvider({ client });
    const r = await p.query({ prompt: "x", model: "claude-haiku-4-5" });
    expect(r.search_results).toHaveLength(1);
  });

  test("translates 401 -> auth ProviderError", async () => {
    const apiErr = new Anthropic.APIError(401, { error: { message: "Unauthorized" } }, "Unauthorized", undefined);
    const client = makeClient(async () => {
      throw apiErr;
    });
    const p = new AnthropicProvider({ client });
    let caught: unknown;
    try {
      await p.query({ prompt: "x", model: "claude-haiku-4-5" });
    } catch (e) {
      caught = e;
    }
    expect((caught as ProviderError).kind).toBe("auth");
  });

  test("429 with credit/billing message classifies as auth", async () => {
    const apiErr = new Anthropic.APIError(
      429,
      { error: { message: "Insufficient credit. Add billing." } },
      "Insufficient credit",
      undefined,
    );
    const client = makeClient(async () => {
      throw apiErr;
    });
    const p = new AnthropicProvider({ client });
    let caught: unknown;
    try {
      await p.query({ prompt: "x", model: "claude-haiku-4-5" });
    } catch (e) {
      caught = e;
    }
    expect((caught as ProviderError).kind).toBe("auth");
    expect((caught as ProviderError).message).toContain("billing");
  });

  test("translates 500 -> transient ProviderError", async () => {
    const apiErr = new Anthropic.APIError(500, { error: { message: "boom" } }, "boom", undefined);
    const client = makeClient(async () => {
      throw apiErr;
    });
    const p = new AnthropicProvider({ client });
    let caught: unknown;
    try {
      await p.query({ prompt: "x", model: "claude-haiku-4-5" });
    } catch (e) {
      caught = e;
    }
    expect((caught as ProviderError).kind).toBe("transient");
  });

  test("captures request_id from header", async () => {
    const headers = new Headers({ "request-id": "req_anthropic_123" });
    const apiErr = new Anthropic.APIError(
      500,
      { error: { message: "boom" } },
      "boom",
      headers,
    );
    const client = makeClient(async () => {
      throw apiErr;
    });
    const p = new AnthropicProvider({ client });
    let caught: unknown;
    try {
      await p.query({ prompt: "x", model: "claude-haiku-4-5" });
    } catch (e) {
      caught = e;
    }
    expect((caught as ProviderError).message).toContain("req_anthropic_123");
  });

  test("constructor without API key throws auth error", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      let caught: unknown;
      try {
        new AnthropicProvider();
      } catch (e) {
        caught = e;
      }
      expect((caught as ProviderError).kind).toBe("auth");
    } finally {
      if (original) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
