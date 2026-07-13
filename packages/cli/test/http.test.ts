import { describe, expect, test } from "bun:test";
import type { ProviderError } from "../src/core/types";
import {
  classifyHttpError,
  normalizeProviderFailure,
  parseResponseBody,
  requireResponseText,
  responseErrorMessage,
} from "../src/providers/http";

describe("provider HTTP helpers", () => {
  test("parses JSON, preserves malformed text, and handles empty bodies", async () => {
    expect(await parseResponseBody(Response.json({ ok: true }))).toEqual({ ok: true });
    expect(await parseResponseBody(new Response("not-json"))).toBe("not-json");
    expect(await parseResponseBody(new Response(null))).toBeNull();
  });

  test("extracts provider error messages from supported response shapes", () => {
    expect(responseErrorMessage({ error: "plain" }, "fallback")).toBe("plain");
    expect(responseErrorMessage({ error: { message: "nested" } }, "fallback")).toBe("nested");
    expect(responseErrorMessage({ message: "top-level" }, "fallback")).toBe("top-level");
    expect(responseErrorMessage("malformed", "fallback")).toBe("fallback");
  });

  test("rejects malformed successful responses with no answer text", () => {
    expect(requireResponseText("ExampleAI", " answer ", {})).toBe(" answer ");
    expect(() => requireResponseText("ExampleAI", "   ", { choices: [] })).toThrow();
    try {
      requireResponseText("ExampleAI", "", { choices: [] });
    } catch (error) {
      expect(error).toMatchObject({
        kind: "transient",
        message: "ExampleAI returned a successful response without answer text.",
      });
    }
  });

  test.each([
    [401, "bad key", "auth"],
    [403, "forbidden", "auth"],
    [429, "too many requests", "rate_limit"],
    [429, "insufficient credits", "auth"],
    [400, "bad request", "bad_request"],
    [404, "missing model", "bad_request"],
    [409, "conflict", "bad_request"],
    [422, "invalid input", "bad_request"],
    [500, "upstream failed", "transient"],
    [503, "unavailable", "transient"],
    [418, "teapot", "unknown"],
  ] as const)("classifies HTTP %i as %s -> %s", (status, message, expectedKind) => {
    const error = classifyHttpError({
      providerName: "ExampleAI",
      envVar: "EXAMPLE_API_KEY",
      status,
      message,
      headers: new Headers(),
      raw: { error: message },
    });
    expect(error.kind).toBe(expectedKind);
    expect(error.http_status).toBe(status);
    if (status === 401 || status === 403) {
      expect(error.message).toContain("EXAMPLE_API_KEY");
    }
  });

  test("supports numeric and HTTP-date Retry-After values", () => {
    const numeric = classifyHttpError({
      providerName: "ExampleAI",
      envVar: "EXAMPLE_API_KEY",
      status: 429,
      message: "slow down",
      headers: new Headers({ "retry-after": "2.5" }),
      raw: null,
    });
    expect(numeric.retry_after_ms).toBe(2500);

    const future = new Date(Date.now() + 5_000).toUTCString();
    const dated = classifyHttpError({
      providerName: "ExampleAI",
      envVar: "EXAMPLE_API_KEY",
      status: 429,
      message: "slow down",
      headers: new Headers({ "retry-after": future }),
      raw: null,
    });
    expect(dated.retry_after_ms).toBeGreaterThan(3_000);
    expect(dated.retry_after_ms).toBeLessThanOrEqual(5_000);
  });

  test("normalizes aborts and network failures while preserving ProviderErrors", () => {
    const aborted = normalizeProviderFailure(new DOMException("cancelled", "AbortError"));
    expect(aborted).toMatchObject({ kind: "transient", message: "Provider request was aborted." });

    const network = normalizeProviderFailure(new Error("socket closed"));
    expect(network).toMatchObject({ kind: "transient", message: "socket closed" });

    const providerError: ProviderError = {
      kind: "bad_request",
      message: "invalid model",
      http_status: 400,
      raw: null,
    };
    expect(normalizeProviderFailure(providerError)).toBe(providerError);
  });
});
