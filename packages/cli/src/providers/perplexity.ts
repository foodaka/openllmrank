import type {
  GroundedSource,
  Provider,
  ProviderError,
  ProviderQueryArgs,
  ProviderResult,
} from "../core/types";
import {
  classifyHttpError,
  type FetchLike,
  normalizeProviderFailure,
  parseResponseBody,
  requireResponseText,
  responseErrorMessage,
} from "./http";

type PerplexityResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  citations?: unknown;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: { total_cost?: number };
  };
};

const PRICING: Record<string, { input: number; output: number; request: number }> = {
  sonar: { input: 1, output: 1, request: 0.008 },
  "sonar-pro": { input: 3, output: 15, request: 0.01 },
  "sonar-reasoning-pro": { input: 2, output: 8, request: 0.01 },
};

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model] ?? PRICING.sonar!;
  return (tokensIn / 1_000_000) * p.input +
    (tokensOut / 1_000_000) * p.output +
    p.request;
}

function extractSources(citations: unknown): GroundedSource[] {
  if (!Array.isArray(citations)) return [];
  const sources: GroundedSource[] = [];
  const seen = new Set<string>();
  for (const citation of citations) {
    const value = typeof citation === "string"
      ? { url: citation }
      : citation as { url?: string; title?: string; snippet?: string };
    if (!value?.url || seen.has(value.url)) continue;
    seen.add(value.url);
    sources.push({ url: value.url, title: value.title, snippet: value.snippet });
  }
  return sources;
}

export class PerplexityProvider implements Provider {
  readonly id = "perplexity" as const;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: { apiKey?: string; fetch?: FetchLike } = {}) {
    const apiKey = opts.apiKey ?? process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      throw {
        kind: "auth",
        message: "PERPLEXITY_API_KEY is not set. Add it to your environment or .env file.",
        raw: null,
      } satisfies ProviderError;
    }
    this.apiKey = apiKey;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async query(args: ProviderQueryArgs): Promise<ProviderResult> {
    const start = Date.now();
    try {
      const response = await this.fetchImpl(
        "https://api.perplexity.ai/chat/completions",
        {
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
        },
      );
      const body = await parseResponseBody(response);
      if (!response.ok) {
        throw classifyHttpError({
          providerName: "Perplexity",
          envVar: "PERPLEXITY_API_KEY",
          status: response.status,
          message: responseErrorMessage(body, response.statusText),
          headers: response.headers,
          raw: body,
        });
      }
      const data = body as PerplexityResponse;
      const responseText = requireResponseText(
        "Perplexity",
        data.choices?.[0]?.message?.content ?? "",
        body,
      );
      const tokensIn = data.usage?.prompt_tokens ?? 0;
      const tokensOut = data.usage?.completion_tokens ??
        Math.max(0, (data.usage?.total_tokens ?? 0) - tokensIn);
      return {
        response_text: responseText,
        search_results: extractSources(data.citations),
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cost_usd: data.usage?.cost?.total_cost ??
          estimateCost(args.model, tokensIn, tokensOut),
        latency_ms: Date.now() - start,
      };
    } catch (error) {
      throw normalizeProviderFailure(error);
    }
  }
}
