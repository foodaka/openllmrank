import { describe, expect, test } from "bun:test";
import OpenAI from "openai";
import { OpenAIProvider } from "../src/providers/openai";
import type { ProviderError } from "../src/core/types";

class FakeResponses {
  constructor(private impl: () => Promise<unknown>) {}
  create() {
    return this.impl();
  }
}

function makeClient(impl: () => Promise<unknown>): OpenAI {
  const c = { responses: new FakeResponses(impl) } as unknown as OpenAI;
  return c;
}

describe("OpenAIProvider", () => {
  test("returns response_text from output_text field", async () => {
    const client = makeClient(async () => ({
      output_text: "Acme is great",
      output: [],
      usage: { input_tokens: 10, output_tokens: 20 },
    }));
    const p = new OpenAIProvider({ client });
    const r = await p.query({ prompt: "x", model: "gpt-4o-mini" });
    expect(r.response_text).toBe("Acme is great");
    expect(r.tokens_in).toBe(10);
    expect(r.tokens_out).toBe(20);
    expect(r.cost_usd).toBeGreaterThan(0);
  });

  test("falls back to extracting text from output array when output_text missing", async () => {
    const client = makeClient(async () => ({
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "Acme is the leader." },
            { type: "output_text", text: "Globex is second." },
          ],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 10 },
    }));
    const p = new OpenAIProvider({ client });
    const r = await p.query({ prompt: "x", model: "gpt-4o-mini" });
    expect(r.response_text).toContain("Acme is the leader.");
    expect(r.response_text).toContain("Globex is second.");
  });

  test("extracts search_results from url_citation annotations", async () => {
    const client = makeClient(async () => ({
      output_text: "Acme leads",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "Acme leads",
              annotations: [
                { type: "url_citation", url: "https://acme.com/about", title: "About Acme" },
                { type: "url_citation", url: "https://globex.com", title: "Globex Home" },
              ],
            },
          ],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 10 },
    }));
    const p = new OpenAIProvider({ client });
    const r = await p.query({ prompt: "x", model: "gpt-4o-mini" });
    expect(r.search_results).toHaveLength(2);
    expect(r.search_results[0]?.url).toBe("https://acme.com/about");
  });

  test("dedupes duplicate URLs in annotations", async () => {
    const client = makeClient(async () => ({
      output_text: "x",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "x",
              annotations: [
                { type: "url_citation", url: "https://acme.com" },
                { type: "url_citation", url: "https://acme.com" },
              ],
            },
          ],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const p = new OpenAIProvider({ client });
    const r = await p.query({ prompt: "x", model: "gpt-4o-mini" });
    expect(r.search_results).toHaveLength(1);
  });

  test("translates 401 -> auth ProviderError", async () => {
    const apiErr = new OpenAI.APIError(401, { error: { message: "Unauthorized" } }, "Unauthorized", undefined);
    const client = makeClient(async () => {
      throw apiErr;
    });
    const p = new OpenAIProvider({ client });
    let caught: unknown;
    try {
      await p.query({ prompt: "x", model: "gpt-4o-mini" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    const pe = caught as ProviderError;
    expect(pe.kind).toBe("auth");
  });

  test("translates 429 -> rate_limit ProviderError", async () => {
    const apiErr = new OpenAI.APIError(
      429,
      { error: { message: "rate" } },
      "rate",
      { "retry-after": "2" } as never,
    );
    const client = makeClient(async () => {
      throw apiErr;
    });
    const p = new OpenAIProvider({ client });
    let caught: unknown;
    try {
      await p.query({ prompt: "x", model: "gpt-4o-mini" });
    } catch (e) {
      caught = e;
    }
    const pe = caught as ProviderError;
    expect(pe.kind).toBe("rate_limit");
    expect(pe.retry_after_ms).toBe(2000);
  });

  test("translates 500 -> transient ProviderError", async () => {
    const apiErr = new OpenAI.APIError(500, { error: { message: "boom" } }, "boom", undefined);
    const client = makeClient(async () => {
      throw apiErr;
    });
    const p = new OpenAIProvider({ client });
    let caught: unknown;
    try {
      await p.query({ prompt: "x", model: "gpt-4o-mini" });
    } catch (e) {
      caught = e;
    }
    expect((caught as ProviderError).kind).toBe("transient");
  });

  test("translates 400 -> bad_request ProviderError", async () => {
    const apiErr = new OpenAI.APIError(400, { error: { message: "bad" } }, "bad", undefined);
    const client = makeClient(async () => {
      throw apiErr;
    });
    const p = new OpenAIProvider({ client });
    let caught: unknown;
    try {
      await p.query({ prompt: "x", model: "gpt-4o-mini" });
    } catch (e) {
      caught = e;
    }
    expect((caught as ProviderError).kind).toBe("bad_request");
  });

  test("429 with quota/billing message classifies as auth (not rate_limit)", async () => {
    const apiErr = new OpenAI.APIError(
      429,
      { error: { message: "You exceeded your current quota, please check your plan and billing details." } },
      "You exceeded your current quota",
      undefined,
    );
    const client = makeClient(async () => {
      throw apiErr;
    });
    const p = new OpenAIProvider({ client });
    let caught: unknown;
    try {
      await p.query({ prompt: "x", model: "gpt-4o-mini" });
    } catch (e) {
      caught = e;
    }
    expect((caught as ProviderError).kind).toBe("auth");
    expect((caught as ProviderError).message).toContain("billing");
  });

  test("captures request_id from x-request-id header", async () => {
    const apiErr = new OpenAI.APIError(
      500,
      { error: { message: "boom" } },
      "boom",
      { "x-request-id": "req_abc123def" } as never,
    );
    const client = makeClient(async () => {
      throw apiErr;
    });
    const p = new OpenAIProvider({ client });
    let caught: unknown;
    try {
      await p.query({ prompt: "x", model: "gpt-4o-mini" });
    } catch (e) {
      caught = e;
    }
    expect((caught as ProviderError).message).toContain("req_abc123def");
  });

  test("captures request_id from message body when no header", async () => {
    const apiErr = new OpenAI.APIError(
      500,
      { error: { message: "Please include the request ID req_xyz789." } },
      "Please include the request ID req_xyz789.",
      undefined,
    );
    const client = makeClient(async () => {
      throw apiErr;
    });
    const p = new OpenAIProvider({ client });
    let caught: unknown;
    try {
      await p.query({ prompt: "x", model: "gpt-4o-mini" });
    } catch (e) {
      caught = e;
    }
    expect((caught as ProviderError).message).toContain("req_xyz789");
  });

  test("constructor without API key throws auth error", () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      let caught: unknown;
      try {
        new OpenAIProvider();
      } catch (e) {
        caught = e;
      }
      expect((caught as ProviderError).kind).toBe("auth");
    } finally {
      if (original) process.env.OPENAI_API_KEY = original;
    }
  });
});
