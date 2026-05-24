import { describe, expect, test } from "bun:test";
import {
  buildProviders,
  getProviderDescriptor,
  listImplementedProviderDescriptors,
  ProviderRegistryError,
} from "../src/providers/registry";

function minimalConfig(providerIds: Array<"openai" | "anthropic" | "google" | "perplexity">) {
  return {
    brand: { name: "Acme", aliases: [] },
    competitors: [],
    prompts: ["best tools"],
    providers: providerIds.map((id) => ({ id, model: id === "anthropic" ? "claude-haiku-4-5" : "gpt-4o-mini" })),
    samples_per_prompt: 1,
    concurrency_per_provider: 1,
  };
}

describe("provider registry", () => {
  test("exposes implemented provider descriptors with env vars and defaults", () => {
    const descriptors = listImplementedProviderDescriptors();
    expect(descriptors.map((d) => d.id)).toEqual(["openai", "anthropic", "google", "perplexity"]);
    expect(getProviderDescriptor("openai")?.envVar).toBe("OPENAI_API_KEY");
    expect(getProviderDescriptor("anthropic")?.envVar).toBe("ANTHROPIC_API_KEY");
    expect(getProviderDescriptor("google")?.envVar).toBe("GOOGLE_API_KEY");
    expect(getProviderDescriptor("perplexity")?.envVar).toBe("PERPLEXITY_API_KEY");
    expect(getProviderDescriptor("openai")?.capabilities.groundedSearch).toBe(true);
  });

  test("buildProviders instantiates only requested implemented providers", () => {
    const providers = buildProviders(minimalConfig(["openai"]), {
      env: { OPENAI_API_KEY: "test-key" },
    });
    expect([...providers.keys()]).toEqual(["openai"]);
    expect(providers.get("openai")?.id).toBe("openai");
  });

  test("buildProviders instantiates Google and Perplexity when keys are present", () => {
    const providers = buildProviders(minimalConfig(["google", "perplexity"]), {
      env: { GOOGLE_API_KEY: "google-key", PERPLEXITY_API_KEY: "pplx-key" },
    });
    expect([...providers.keys()]).toEqual(["google", "perplexity"]);
    expect(providers.get("google")?.id).toBe("google");
    expect(providers.get("perplexity")?.id).toBe("perplexity");
  });

  test("buildProviders normalizes missing API keys as provider auth errors", () => {
    try {
      buildProviders(minimalConfig(["anthropic"]), { env: {} });
      throw new Error("expected buildProviders to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderRegistryError);
      expect((err as ProviderRegistryError).code).toBe("PROVIDER_AUTH");
      expect((err as Error).message).toContain("ANTHROPIC_API_KEY");
    }
  });
});
