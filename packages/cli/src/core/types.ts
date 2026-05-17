// CLI-internal types. Shared schemas (ConfigSchema, BrandSchema, etc.) live in
// @openllmrank/shared so the hosted webapp uses the exact same validation as
// the CLI subprocess it spawns. The re-exports below keep existing CLI imports
// intact; new code that needs the wizard cap-enforced variant should reach for
// @openllmrank/shared directly.

export {
  PROVIDER_IDS,
  BrandSchema,
  ProviderConfigSchema,
  ConfigSchema,
} from "@openllmrank/shared/config";
export type {
  ProviderId,
  Brand,
  ProviderConfig,
  Config,
} from "@openllmrank/shared/config";

export type ProviderErrorKind =
  | "transient"
  | "rate_limit"
  | "auth"
  | "bad_request"
  | "unknown";

export type ProviderError = {
  kind: ProviderErrorKind;
  retry_after_ms?: number;
  http_status?: number;
  message: string;
  raw: unknown;
};

export type GroundedSource = {
  url: string;
  title?: string;
  snippet?: string;
};

export type ProviderResult = {
  response_text: string;
  search_results: GroundedSource[];
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
};

export type ProviderQueryArgs = {
  prompt: string;
  model: string;
  signal?: AbortSignal;
};

import type { ProviderId } from "@openllmrank/shared/config";

export interface Provider {
  id: ProviderId;
  query(args: ProviderQueryArgs): Promise<ProviderResult>;
}

export type CitationKind = "name" | "url" | "grounded_source";

export type Citation = {
  brand: string;
  matched_text: string;
  kind: CitationKind;
};

export type CallRecord = {
  run_id: string;
  prompt_id: string;
  sample_index: number;
  ts: string;
  response_text: string;
  search_results_json: string;
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  error_code: string | null;
  error_message: string | null;
};

export type PromptRecord = {
  prompt_id: string;
  prompt_text: string;
  model: string;
  provider: ProviderId;
  config_blob: string;
  created_at: string;
};
