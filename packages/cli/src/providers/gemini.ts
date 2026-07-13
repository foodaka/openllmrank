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

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      webSearchQueries?: string[];
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

const PRICING: Record<string, { input: number; output: number; search: number }> = {
  "gemini-3.5-flash": { input: 1.5, output: 9, search: 0.014 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5, search: 0.014 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, search: 0.035 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4, search: 0.035 },
};

function estimateCost(
  model: string,
  tokensIn: number,
  tokensOut: number,
  searchQueries: number,
): number {
  const p = PRICING[model] ?? PRICING["gemini-3.5-flash"]!;
  return (tokensIn / 1_000_000) * p.input +
    (tokensOut / 1_000_000) * p.output +
    searchQueries * p.search;
}

function extractText(data: GeminiResponse): string {
  return (data.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text)
    .filter((text): text is string => Boolean(text))
    .join("\n");
}

function extractSources(data: GeminiResponse): GroundedSource[] {
  const sources: GroundedSource[] = [];
  const seen = new Set<string>();
  for (const candidate of data.candidates ?? []) {
    for (const chunk of candidate.groundingMetadata?.groundingChunks ?? []) {
      const url = chunk.web?.uri;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      sources.push({ url, title: chunk.web?.title });
    }
  }
  return sources;
}

function countSearchQueries(data: GeminiResponse, sources: GroundedSource[]): number {
  const queries = new Set(
    (data.candidates ?? []).flatMap(
      (candidate) => candidate.groundingMetadata?.webSearchQueries ?? [],
    ),
  );
  return queries.size || (sources.length > 0 ? 1 : 0);
}

export class GeminiProvider implements Provider {
  readonly id = "google" as const;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: { apiKey?: string; fetch?: FetchLike } = {}) {
    const apiKey = opts.apiKey ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw {
        kind: "auth",
        message: "GOOGLE_API_KEY is not set. Add it to your environment or .env file.",
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
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: args.prompt }] }],
            tools: [{ google_search: {} }],
          }),
          signal: args.signal,
        },
      );
      const body = await parseResponseBody(response);
      if (!response.ok) {
        throw classifyHttpError({
          providerName: "Google Gemini",
          envVar: "GOOGLE_API_KEY",
          status: response.status,
          message: responseErrorMessage(body, response.statusText),
          headers: response.headers,
          raw: body,
        });
      }
      const data = body as GeminiResponse;
      const sources = extractSources(data);
      const responseText = requireResponseText("Google Gemini", extractText(data), body);
      const tokensIn = data.usageMetadata?.promptTokenCount ?? 0;
      const tokensOut = data.usageMetadata?.candidatesTokenCount ??
        Math.max(0, (data.usageMetadata?.totalTokenCount ?? 0) - tokensIn);
      return {
        response_text: responseText,
        search_results: sources,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cost_usd: estimateCost(
          args.model,
          tokensIn,
          tokensOut,
          countSearchQueries(data, sources),
        ),
        latency_ms: Date.now() - start,
      };
    } catch (error) {
      throw normalizeProviderFailure(error);
    }
  }
}
