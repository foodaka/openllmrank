import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import type { Config, Provider, ProviderId } from "../core/types";

export type ProviderCapability = {
  groundedSearch: boolean;
  suggestions: boolean;
};

export type ProviderDescriptor = {
  id: ProviderId;
  displayName: string;
  envVar: string;
  defaultModel: string;
  supportedModels: string[];
  capabilities: ProviderCapability;
  status: "implemented" | "planned";
  create?: (opts: { apiKey?: string }) => Provider;
};

export type ProviderRegistryErrorCode = "PROVIDER_AUTH" | "PROVIDER_UNSUPPORTED";

export class ProviderRegistryError extends Error {
  constructor(
    public code: ProviderRegistryErrorCode,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "ProviderRegistryError";
  }
}

const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    envVar: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
    supportedModels: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    capabilities: { groundedSearch: true, suggestions: true },
    status: "implemented",
    create: ({ apiKey }) => new OpenAIProvider({ apiKey }),
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    defaultModel: "claude-haiku-4-5",
    supportedModels: [
      "claude-haiku-4-5",
      "claude-haiku-4-5-20251001",
      "claude-3-5-haiku-latest",
      "claude-sonnet-4-6",
      "claude-opus-4-7",
    ],
    capabilities: { groundedSearch: true, suggestions: false },
    status: "implemented",
    create: ({ apiKey }) => new AnthropicProvider({ apiKey }),
  },
  {
    id: "google",
    displayName: "Google Gemini",
    envVar: "GOOGLE_API_KEY",
    defaultModel: "gemini-2.0-flash",
    supportedModels: ["gemini-2.0-flash", "gemini-1.5-pro"],
    capabilities: { groundedSearch: true, suggestions: false },
    status: "planned",
  },
  {
    id: "perplexity",
    displayName: "Perplexity",
    envVar: "PERPLEXITY_API_KEY",
    defaultModel: "sonar",
    supportedModels: ["sonar", "sonar-pro"],
    capabilities: { groundedSearch: true, suggestions: false },
    status: "planned",
  },
];

const DESCRIPTORS_BY_ID = new Map(PROVIDER_DESCRIPTORS.map((d) => [d.id, d]));

export function listProviderDescriptors(): readonly ProviderDescriptor[] {
  return PROVIDER_DESCRIPTORS;
}

export function listImplementedProviderDescriptors(): readonly ProviderDescriptor[] {
  return PROVIDER_DESCRIPTORS.filter((d) => d.status === "implemented");
}

export function getProviderDescriptor(id: ProviderId): ProviderDescriptor | undefined {
  return DESCRIPTORS_BY_ID.get(id);
}

export function buildProviders(
  cfg: Config,
  opts: { env?: Record<string, string | undefined> } = {},
): Map<ProviderId, Provider> {
  const env = opts.env ?? process.env;
  const explicitEnv = opts.env !== undefined;
  const map = new Map<ProviderId, Provider>();
  const wantedIds = new Set(cfg.providers.map((p) => p.id));

  for (const id of wantedIds) {
    const descriptor = getProviderDescriptor(id);
    if (!descriptor || descriptor.status !== "implemented" || !descriptor.create) {
      throw new ProviderRegistryError(
        "PROVIDER_UNSUPPORTED",
        `Provider '${id}' is not implemented yet. v0.2 supports OpenAI + Anthropic. Gemini and Perplexity coming.`,
      );
    }

    try {
      const apiKey = Object.prototype.hasOwnProperty.call(env, descriptor.envVar)
        ? env[descriptor.envVar]
        : explicitEnv
          ? ""
          : undefined;
      map.set(id, descriptor.create({ apiKey }));
    } catch (e) {
      const err = e as { kind?: string; message?: string };
      throw new ProviderRegistryError(
        "PROVIDER_AUTH",
        err.message ?? String(e),
      );
    }
  }

  return map;
}
