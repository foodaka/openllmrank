import type { ProviderError } from "../core/types";

export type FetchLike = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

export async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function responseErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const value = body as {
    error?: { message?: string } | string;
    message?: string;
  };
  if (typeof value.error === "string") return value.error;
  if (typeof value.error?.message === "string") return value.error.message;
  if (typeof value.message === "string") return value.message;
  return fallback;
}

export function requireResponseText(
  providerName: string,
  text: string,
  raw: unknown,
): string {
  if (text.trim().length > 0) return text;
  throw {
    kind: "transient",
    message: `${providerName} returned a successful response without answer text.`,
    raw,
  } satisfies ProviderError;
}

function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

export function classifyHttpError(args: {
  providerName: string;
  envVar: string;
  status: number;
  message: string;
  headers: Headers;
  raw: unknown;
}): ProviderError {
  const { providerName, envVar, status, message, headers, raw } = args;
  if (status === 401 || status === 403) {
    return {
      kind: "auth",
      message: `${providerName} rejected the API key. Set ${envVar} to a valid key. (${message})`,
      http_status: status,
      raw,
    };
  }
  if (status === 429) {
    return {
      kind: /billing|credit|quota|insufficient|api key/i.test(message)
        ? "auth"
        : "rate_limit",
      message,
      retry_after_ms: retryAfterMs(headers),
      http_status: status,
      raw,
    };
  }
  if (status >= 500 && status < 600) {
    return { kind: "transient", message, http_status: status, raw };
  }
  if (status === 400 || status === 404 || status === 409 || status === 422) {
    return { kind: "bad_request", message, http_status: status, raw };
  }
  return { kind: "unknown", message, http_status: status, raw };
}

export function normalizeProviderFailure(error: unknown): ProviderError {
  if (typeof error === "object" && error !== null && "kind" in error) {
    return error as ProviderError;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { kind: "transient", message: "Provider request was aborted.", raw: error };
  }
  return {
    kind: "transient",
    message: error instanceof Error ? error.message : String(error),
    raw: error,
  };
}
