import OpenAI from "openai";
import type {
  GroundedSource,
  Provider,
  ProviderError,
  ProviderQueryArgs,
  ProviderResult,
} from "../core/types";

type PricingEntry = {
  input_per_1m: number;
  output_per_1m: number;
  search_call_cost: number;
};

const PRICING: Record<string, PricingEntry> = {
  "chat-latest": { input_per_1m: 5, output_per_1m: 30, search_call_cost: 0.025 },
  "gpt-5.6-luna": { input_per_1m: 1, output_per_1m: 6, search_call_cost: 0.025 },
  "gpt-5.5": { input_per_1m: 5, output_per_1m: 30, search_call_cost: 0.025 },
  "gpt-5.4-mini": { input_per_1m: 0.75, output_per_1m: 4.5, search_call_cost: 0.025 },
  "gpt-5-mini": { input_per_1m: 0.25, output_per_1m: 2, search_call_cost: 0.025 },
  "gpt-4o-mini": { input_per_1m: 0.15, output_per_1m: 0.6, search_call_cost: 0.025 },
  "gpt-4o": { input_per_1m: 2.5, output_per_1m: 10.0, search_call_cost: 0.025 },
  "gpt-4.1-mini": { input_per_1m: 0.4, output_per_1m: 1.6, search_call_cost: 0.025 },
  "gpt-4.1": { input_per_1m: 2.0, output_per_1m: 8.0, search_call_cost: 0.025 },
};

function estimateCost(
  model: string,
  tokens_in: number,
  tokens_out: number,
  searchCalls: number,
): number {
  const p = PRICING[model] ?? PRICING["gpt-5.4-mini"]!;
  return (
    (tokens_in / 1_000_000) * p.input_per_1m +
    (tokens_out / 1_000_000) * p.output_per_1m +
    searchCalls * p.search_call_cost
  );
}

type ApiErrorLike = InstanceType<typeof OpenAI.APIError>;

function extractRequestId(err: ApiErrorLike): string | undefined {
  const headers = err.headers as Record<string, string> | undefined;
  const headerId = headers?.["x-request-id"] ?? headers?.["X-Request-Id"];
  if (headerId) return headerId;
  const match = /req_[a-f0-9]+/.exec(err.message);
  return match?.[0];
}

function withRequestId(err: ApiErrorLike, message: string): string {
  const id = extractRequestId(err);
  return id ? `${message} [request_id=${id}]` : message;
}

function classifyError(err: unknown): ProviderError {
  if (err instanceof OpenAI.APIError) {
    const status = err.status ?? 0;
    if (status === 401 || status === 403) {
      return {
        kind: "auth",
        message: withRequestId(
          err,
          "OpenAI rejected the API key. Set OPENAI_API_KEY to a valid key.",
        ),
        http_status: status,
        raw: err,
      };
    }
    if (status === 429) {
      const retryAfter = (err.headers as Record<string, string> | undefined)?.["retry-after"];
      const retry_after_ms = retryAfter ? Math.max(0, Number(retryAfter) * 1000) : undefined;
      const isQuota = /quota|billing|insufficient/i.test(err.message);
      return {
        kind: isQuota ? "auth" : "rate_limit",
        message: withRequestId(
          err,
          isQuota
            ? "OpenAI account has no credit. Add billing at https://platform.openai.com/settings/organization/billing/overview"
            : err.message,
        ),
        retry_after_ms,
        http_status: status,
        raw: err,
      };
    }
    if (status >= 500 && status < 600) {
      return {
        kind: "transient",
        message: withRequestId(err, err.message),
        http_status: status,
        raw: err,
      };
    }
    if (status === 400 || status === 404 || status === 422) {
      return {
        kind: "bad_request",
        message: withRequestId(err, err.message),
        http_status: status,
        raw: err,
      };
    }
    return {
      kind: "unknown",
      message: withRequestId(err, err.message),
      http_status: status,
      raw: err,
    };
  }
  if (err instanceof OpenAI.APIConnectionError || err instanceof OpenAI.APIConnectionTimeoutError) {
    return { kind: "transient", message: err.message, raw: err };
  }
  return {
    kind: "unknown",
    message: err instanceof Error ? err.message : String(err),
    raw: err,
  };
}

type ResponsesCreateParams = Parameters<OpenAI["responses"]["create"]>[0];

function extractText(response: unknown): string {
  const r = response as { output_text?: string; output?: unknown[] };
  if (typeof r.output_text === "string" && r.output_text.length > 0) return r.output_text;
  const out = r.output;
  if (!Array.isArray(out)) return "";
  const parts: string[] = [];
  for (const item of out) {
    if (typeof item !== "object" || item === null) continue;
    const i = item as { type?: string; content?: unknown };
    if (i.type === "message" && Array.isArray(i.content)) {
      for (const c of i.content) {
        if (typeof c === "object" && c !== null) {
          const cc = c as { type?: string; text?: string };
          if (cc.type === "output_text" && typeof cc.text === "string") parts.push(cc.text);
        }
      }
    }
  }
  return parts.join("\n");
}

function extractSearchResults(response: unknown): GroundedSource[] {
  const out = (response as { output?: unknown[] }).output;
  if (!Array.isArray(out)) return [];
  const sources: GroundedSource[] = [];
  const seen = new Set<string>();
  for (const item of out) {
    if (typeof item !== "object" || item === null) continue;
    const i = item as { type?: string; content?: unknown };
    if (i.type === "message" && Array.isArray(i.content)) {
      for (const c of i.content) {
        if (typeof c !== "object" || c === null) continue;
        const cc = c as { annotations?: unknown };
        if (Array.isArray(cc.annotations)) {
          for (const ann of cc.annotations) {
            if (typeof ann !== "object" || ann === null) continue;
            const a = ann as { type?: string; url?: string; title?: string };
            if (a.type === "url_citation" && typeof a.url === "string") {
              if (!seen.has(a.url)) {
                seen.add(a.url);
                sources.push({ url: a.url, title: a.title });
              }
            }
          }
        }
      }
    }
  }
  return sources;
}

function extractUsage(response: unknown): { input: number; output: number } {
  const u = (response as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  return {
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
  };
}

function countSearchCalls(response: unknown): number {
  const output = (response as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return 0;
  return output.filter((item) =>
    typeof item === "object" && item !== null &&
    (item as { type?: string }).type === "web_search_call"
  ).length;
}

export class OpenAIProvider implements Provider {
  readonly id = "openai" as const;
  private client: OpenAI;

  constructor(opts: { apiKey?: string; client?: OpenAI } = {}) {
    if (opts.client) {
      this.client = opts.client;
    } else {
      const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
      if (!apiKey) {
        const err: ProviderError = {
          kind: "auth",
          message: "OPENAI_API_KEY is not set. Add it to your environment or .env file.",
          raw: null,
        };
        throw err;
      }
      this.client = new OpenAI({ apiKey });
    }
  }

  async query(args: ProviderQueryArgs): Promise<ProviderResult> {
    const start = Date.now();
    try {
      const params: ResponsesCreateParams = {
        model: args.model,
        input: args.prompt,
        tools: [{ type: "web_search" } as never],
      };
      const response = await this.client.responses.create(params, {
        signal: args.signal,
      });
      const latency_ms = Date.now() - start;
      const response_text = extractText(response);
      const search_results = extractSearchResults(response);
      const usage = extractUsage(response);
      return {
        response_text,
        search_results,
        tokens_in: usage.input,
        tokens_out: usage.output,
        cost_usd: estimateCost(
          args.model,
          usage.input,
          usage.output,
          countSearchCalls(response),
        ),
        latency_ms,
      };
    } catch (err) {
      throw classifyError(err);
    }
  }
}
