import Anthropic from "@anthropic-ai/sdk";
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
  "claude-haiku-4-5": { input_per_1m: 1.0, output_per_1m: 5.0, search_call_cost: 0.01 },
  "claude-haiku-4-5-20251001": { input_per_1m: 1.0, output_per_1m: 5.0, search_call_cost: 0.01 },
  "claude-3-5-haiku-latest": { input_per_1m: 0.8, output_per_1m: 4.0, search_call_cost: 0.01 },
  "claude-sonnet-4-6": { input_per_1m: 3.0, output_per_1m: 15.0, search_call_cost: 0.01 },
  "claude-opus-4-7": { input_per_1m: 15.0, output_per_1m: 75.0, search_call_cost: 0.01 },
};

function estimateCost(model: string, tokens_in: number, tokens_out: number): number {
  const p = PRICING[model] ?? PRICING["claude-haiku-4-5"]!;
  return (
    (tokens_in / 1_000_000) * p.input_per_1m +
    (tokens_out / 1_000_000) * p.output_per_1m +
    p.search_call_cost
  );
}

type AnthropicErrorLike = InstanceType<typeof Anthropic.APIError>;

function extractRequestId(err: AnthropicErrorLike): string | undefined {
  const headers = err.headers as unknown;
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") {
    const h = headers as Headers;
    return h.get("request-id") ?? h.get("x-request-id") ?? undefined;
  }
  const rec = headers as Record<string, string>;
  return rec["request-id"] ?? rec["x-request-id"];
}

function withRequestId(err: AnthropicErrorLike, message: string): string {
  const id = extractRequestId(err);
  return id ? `${message} [request_id=${id}]` : message;
}

function classifyError(err: unknown): ProviderError {
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    if (status === 401 || status === 403) {
      return {
        kind: "auth",
        message: withRequestId(
          err,
          "Anthropic rejected the API key. Set ANTHROPIC_API_KEY to a valid key.",
        ),
        http_status: status,
        raw: err,
      };
    }
    if (status === 429) {
      const isQuota = /credit|billing|insufficient|quota/i.test(err.message);
      return {
        kind: isQuota ? "auth" : "rate_limit",
        message: withRequestId(
          err,
          isQuota
            ? "Anthropic account has no credit. Add billing at https://console.anthropic.com/settings/billing"
            : err.message,
        ),
        http_status: status,
        raw: err,
      };
    }
    if (status >= 500 && status < 600) {
      return { kind: "transient", message: withRequestId(err, err.message), http_status: status, raw: err };
    }
    if (status === 400 || status === 404 || status === 422) {
      return { kind: "bad_request", message: withRequestId(err, err.message), http_status: status, raw: err };
    }
    return { kind: "unknown", message: withRequestId(err, err.message), http_status: status, raw: err };
  }
  if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.APIConnectionTimeoutError) {
    return { kind: "transient", message: err.message, raw: err };
  }
  return {
    kind: "unknown",
    message: err instanceof Error ? err.message : String(err),
    raw: err,
  };
}

function extractText(response: unknown): string {
  const r = response as { content?: unknown[] };
  const parts: string[] = [];
  if (!Array.isArray(r.content)) return "";
  for (const block of r.content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as { type?: string; text?: string };
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("\n");
}

function extractSearchResults(response: unknown): GroundedSource[] {
  const r = response as { content?: unknown[] };
  if (!Array.isArray(r.content)) return [];
  const out: GroundedSource[] = [];
  const seen = new Set<string>();
  for (const block of r.content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as { type?: string; citations?: unknown; content?: unknown };
    if (Array.isArray(b.citations)) {
      for (const cit of b.citations) {
        if (typeof cit !== "object" || cit === null) continue;
        const c = cit as { type?: string; url?: string; title?: string; cited_text?: string };
        if (c.url && !seen.has(c.url)) {
          seen.add(c.url);
          out.push({ url: c.url, title: c.title, snippet: c.cited_text });
        }
      }
    }
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const item of b.content) {
        if (typeof item !== "object" || item === null) continue;
        const i = item as { url?: string; title?: string; snippet?: string };
        if (i.url && !seen.has(i.url)) {
          seen.add(i.url);
          out.push({ url: i.url, title: i.title, snippet: i.snippet });
        }
      }
    }
  }
  return out;
}

function extractUsage(response: unknown): { input: number; output: number } {
  const u = (response as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  return {
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
  };
}

export class AnthropicProvider implements Provider {
  readonly id = "anthropic" as const;
  private client: Anthropic;
  private maxTokens: number;

  constructor(opts: { apiKey?: string; client?: Anthropic; maxTokens?: number } = {}) {
    this.maxTokens = opts.maxTokens ?? 1024;
    if (opts.client) {
      this.client = opts.client;
    } else {
      const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        const err: ProviderError = {
          kind: "auth",
          message: "ANTHROPIC_API_KEY is not set. Add it to your environment or .env file.",
          raw: null,
        };
        throw err;
      }
      this.client = new Anthropic({ apiKey });
    }
  }

  async query(args: ProviderQueryArgs): Promise<ProviderResult> {
    const start = Date.now();
    try {
      const response = await this.client.messages.create(
        {
          model: args.model,
          max_tokens: this.maxTokens,
          messages: [{ role: "user", content: args.prompt }],
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
              max_uses: 5,
            } as never,
          ],
        },
        { signal: args.signal },
      );
      const latency_ms = Date.now() - start;
      const response_text = extractText(response);
      const search_results = extractSearchResults(response);
      const usage = extractUsage(response);
      return {
        response_text,
        search_results,
        tokens_in: usage.input,
        tokens_out: usage.output,
        cost_usd: estimateCost(args.model, usage.input, usage.output),
        latency_ms,
      };
    } catch (err) {
      throw classifyError(err);
    }
  }
}
