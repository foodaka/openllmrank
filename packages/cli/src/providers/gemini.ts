import type {
  GroundedSource,
  Provider,
  ProviderError,
  ProviderQueryArgs,
  ProviderResult,
} from "../core/types";

type FetchLike = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>;

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

type PricingEntry = {
  input_per_1m: number;
  output_per_1m: number;
  search_call_cost: number;
};

const PRICING: Record<string, PricingEntry> = {
  "gemini-2.0-flash": { input_per_1m: 0.1, output_per_1m: 0.4, search_call_cost: 0.005 },
  "gemini-1.5-pro": { input_per_1m: 1.25, output_per_1m: 5.0, search_call_cost: 0.005 },
};

function estimateCost(model: string, tokens_in: number, tokens_out: number): number {
  const p = PRICING[model] ?? PRICING["gemini-2.0-flash"]!;
  return (tokens_in / 1_000_000) * p.input_per_1m + (tokens_out / 1_000_000) * p.output_per_1m + p.search_call_cost;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null) {
    const b = body as { error?: { message?: string } | string; message?: string };
    if (typeof b.error === "string") return b.error;
    if (typeof b.error?.message === "string") return b.error.message;
    if (typeof b.message === "string") return b.message;
  }
  return fallback;
}

function classifyHttpError(status: number, message: string, headers: Headers, raw: unknown): ProviderError {
  if (status === 401 || status === 403) {
    return {
      kind: "auth",
      message: `Google Gemini rejected the API key. Set GOOGLE_API_KEY to a valid key. (${message})`,
      http_status: status,
      raw,
    };
  }
  if (status === 429) {
    const retryAfter = headers.get("retry-after");
    return {
      kind: /billing|insufficient|api key/i.test(message) ? "auth" : "rate_limit",
      message,
      retry_after_ms: retryAfter ? Math.max(0, Number(retryAfter) * 1000) : undefined,
      http_status: status,
      raw,
    };
  }
  if (status >= 500 && status < 600) return { kind: "transient", message, http_status: status, raw };
  if (status === 400 || status === 404 || status === 422) return { kind: "bad_request", message, http_status: status, raw };
  return { kind: "unknown", message, http_status: status, raw };
}

function extractText(data: GeminiResponse): string {
  const parts = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
  return parts.map((part) => part.text).filter((text): text is string => Boolean(text)).join("\n");
}

function extractSources(data: GeminiResponse): GroundedSource[] {
  const out: GroundedSource[] = [];
  const seen = new Set<string>();
  for (const candidate of data.candidates ?? []) {
    for (const chunk of candidate.groundingMetadata?.groundingChunks ?? []) {
      const url = chunk.web?.uri;
      if (url && !seen.has(url)) {
        seen.add(url);
        out.push({ url, title: chunk.web?.title });
      }
    }
  }
  return out;
}

export class GeminiProvider implements Provider {
  readonly id = "google" as const;
  private apiKey: string;
  private fetchImpl: FetchLike;

  constructor(opts: { apiKey?: string; fetch?: FetchLike } = {}) {
    const apiKey = opts.apiKey ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      const err: ProviderError = {
        kind: "auth",
        message: "GOOGLE_API_KEY is not set. Add it to your environment or .env file.",
        raw: null,
      };
      throw err;
    }
    this.apiKey = apiKey;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async query(args: ProviderQueryArgs): Promise<ProviderResult> {
    const start = Date.now();
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: args.prompt }] }],
          tools: [{ google_search: {} }],
        }),
        signal: args.signal,
      });
      const body = await parseJson(response);
      if (!response.ok) {
        throw classifyHttpError(response.status, errorMessage(body, response.statusText), response.headers, body);
      }
      const data = body as GeminiResponse;
      const usage = data.usageMetadata ?? {};
      const tokens_in = usage.promptTokenCount ?? 0;
      const tokens_out = usage.candidatesTokenCount ?? Math.max(0, (usage.totalTokenCount ?? 0) - tokens_in);
      return {
        response_text: extractText(data),
        search_results: extractSources(data),
        tokens_in,
        tokens_out,
        cost_usd: estimateCost(args.model, tokens_in, tokens_out),
        latency_ms: Date.now() - start,
      };
    } catch (err) {
      if (typeof err === "object" && err !== null && "kind" in err) throw err;
      throw { kind: "transient", message: err instanceof Error ? err.message : String(err), raw: err } satisfies ProviderError;
    }
  }
}
