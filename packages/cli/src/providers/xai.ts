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

type XaiResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{ type?: string; url?: string; title?: string }>;
    }>;
  }>;
  citations?: string[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

const PRICING: Record<string, { input: number; output: number }> = {
  "grok-4.3": { input: 1.25, output: 2.5 },
  "grok-4.5": { input: 2, output: 6 },
  "grok-4.5-latest": { input: 2, output: 6 },
};

function extractText(data: XaiResponse): string {
  if (data.output_text) return data.output_text;
  return (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text ?? "")
    .join("\n");
}

function extractSources(data: XaiResponse): GroundedSource[] {
  const sources: GroundedSource[] = [];
  const seen = new Set<string>();
  const add = (url: string | undefined, title?: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    sources.push({ url, title });
  };
  for (const url of data.citations ?? []) add(url);
  for (const item of data.output ?? []) {
    for (const content of item.content ?? []) {
      for (const annotation of content.annotations ?? []) {
        if (annotation.type === "url_citation") add(annotation.url, annotation.title);
      }
    }
  }
  return sources;
}

export class XaiProvider implements Provider {
  readonly id = "xai" as const;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: { apiKey?: string; fetch?: FetchLike } = {}) {
    const apiKey = opts.apiKey ?? process.env.XAI_API_KEY;
    if (!apiKey) {
      throw {
        kind: "auth",
        message: "XAI_API_KEY is not set. Add it to your environment or .env file.",
        raw: null,
      } satisfies ProviderError;
    }
    this.apiKey = apiKey;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async query(args: ProviderQueryArgs): Promise<ProviderResult> {
    const start = Date.now();
    try {
      const response = await this.fetchImpl("https://api.x.ai/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: args.model,
          input: [{ role: "user", content: args.prompt }],
          tools: [{ type: "web_search" }],
        }),
        signal: args.signal,
      });
      const body = await parseResponseBody(response);
      if (!response.ok) {
        throw classifyHttpError({
          providerName: "xAI",
          envVar: "XAI_API_KEY",
          status: response.status,
          message: responseErrorMessage(body, response.statusText),
          headers: response.headers,
          raw: body,
        });
      }
      const data = body as XaiResponse;
      const responseText = requireResponseText("xAI", extractText(data), body);
      const tokensIn = data.usage?.input_tokens ?? 0;
      const tokensOut = data.usage?.output_tokens ?? 0;
      const searchCalls = (data.output ?? []).filter(
        (item) => item.type === "web_search_call",
      ).length;
      const pricing = PRICING[args.model] ?? PRICING["grok-4.3"]!;
      return {
        response_text: responseText,
        search_results: extractSources(data),
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cost_usd: (tokensIn / 1_000_000) * pricing.input +
          (tokensOut / 1_000_000) * pricing.output +
          searchCalls * 0.005,
        latency_ms: Date.now() - start,
      };
    } catch (error) {
      throw normalizeProviderFailure(error);
    }
  }
}
