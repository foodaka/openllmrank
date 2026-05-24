import type {
  GroundedSource,
  Provider,
  ProviderError,
  ProviderQueryArgs,
  ProviderResult,
} from "../core/types";

type FetchLike = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>;

type PerplexityUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type PerplexityResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  citations?: unknown;
  usage?: PerplexityUsage;
};

type PricingEntry = {
  input_per_1m: number;
  output_per_1m: number;
  search_call_cost: number;
};

const PRICING: Record<string, PricingEntry> = {
  sonar: { input_per_1m: 1.0, output_per_1m: 1.0, search_call_cost: 0.005 },
  "sonar-pro": { input_per_1m: 3.0, output_per_1m: 15.0, search_call_cost: 0.005 },
};

function estimateCost(model: string, tokens_in: number, tokens_out: number): number {
  const p = PRICING[model] ?? PRICING.sonar!;
  return (tokens_in / 1_000_000) * p.input_per_1m + (tokens_out / 1_000_000) * p.output_per_1m + p.search_call_cost;
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
      message: `Perplexity rejected the API key. Set PERPLEXITY_API_KEY to a valid key. (${message})`,
      http_status: status,
      raw,
    };
  }
  if (status === 429) {
    const retryAfter = headers.get("retry-after");
    return {
      kind: /quota|billing|insufficient/i.test(message) ? "auth" : "rate_limit",
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

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractSources(citations: unknown): GroundedSource[] {
  if (!Array.isArray(citations)) return [];
  const out: GroundedSource[] = [];
  const seen = new Set<string>();
  for (const item of citations) {
    let url: string | undefined;
    let title: string | undefined;
    let snippet: string | undefined;
    if (typeof item === "string") {
      url = item;
    } else if (typeof item === "object" && item !== null) {
      const c = item as { url?: string; title?: string; snippet?: string };
      url = c.url;
      title = c.title;
      snippet = c.snippet;
    }
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push({ url, title, snippet });
    }
  }
  return out;
}

export class PerplexityProvider implements Provider {
  readonly id = "perplexity" as const;
  private apiKey: string;
  private fetchImpl: FetchLike;

  constructor(opts: { apiKey?: string; fetch?: FetchLike } = {}) {
    const apiKey = opts.apiKey ?? process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      const err: ProviderError = {
        kind: "auth",
        message: "PERPLEXITY_API_KEY is not set. Add it to your environment or .env file.",
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
      const response = await this.fetchImpl("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: args.model,
          messages: [{ role: "user", content: args.prompt }],
          web_search_options: { search_context_size: "medium" },
        }),
        signal: args.signal,
      });
      const body = await parseJson(response);
      if (!response.ok) {
        throw classifyHttpError(response.status, errorMessage(body, response.statusText), response.headers, body);
      }
      const data = body as PerplexityResponse;
      const usage = data.usage ?? {};
      const tokens_in = usage.prompt_tokens ?? 0;
      const tokens_out = usage.completion_tokens ?? Math.max(0, (usage.total_tokens ?? 0) - tokens_in);
      return {
        response_text: data.choices?.[0]?.message?.content ?? "",
        search_results: extractSources(data.citations),
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
