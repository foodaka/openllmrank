import { describe, expect, test } from "bun:test";
import {
  buildProviders,
  getProviderDescriptor,
  listImplementedProviderDescriptors,
  ProviderRegistryError,
} from "../src/providers/registry";

function minimalConfig(providerIds: Array<"openai" | "anthropic" | "google" | "perplexity" | "xai">) {
  const models = {
    openai: "gpt-5.4-mini",
    anthropic: "claude-haiku-4-5",
    google: "gemini-3.5-flash",
    perplexity: "sonar",
    xai: "grok-4.3",
  } as const;
  return {
    brand: { name: "Acme", aliases: [] },
    competitors: [],
    prompts: ["best tools"],
    providers: providerIds.map((id) => ({ id, model: models[id] })),
    samples_per_prompt: 1,
    concurrency_per_provider: 1,
  };
}

describe("provider registry", () => {
  test("exposes implemented provider descriptors with env vars and defaults", () => {
    const descriptors = listImplementedProviderDescriptors();
    expect(descriptors.map((d) => d.id)).toEqual([
      "openai",
      "anthropic",
      "google",
      "perplexity",
      "xai",
    ]);
    expect(getProviderDescriptor("openai")?.envVar).toBe("OPENAI_API_KEY");
    expect(getProviderDescriptor("anthropic")?.envVar).toBe("ANTHROPIC_API_KEY");
    expect(getProviderDescriptor("google")?.envVar).toBe("GOOGLE_API_KEY");
    expect(getProviderDescriptor("perplexity")?.envVar).toBe("PERPLEXITY_API_KEY");
    expect(getProviderDescriptor("xai")?.envVar).toBe("XAI_API_KEY");
    expect(getProviderDescriptor("openai")?.capabilities.groundedSearch).toBe(true);
  });

  test("buildProviders instantiates only requested implemented providers", () => {
    const providers = buildProviders(minimalConfig(["openai"]), {
      env: { OPENAI_API_KEY: "test-key" },
    });
    expect([...providers.keys()]).toEqual(["openai"]);
    expect(providers.get("openai")?.id).toBe("openai");
  });

  test("buildProviders instantiates every supported provider", () => {
    const providers = buildProviders(
      minimalConfig(["google", "perplexity", "xai"]),
      {
        env: {
          GOOGLE_API_KEY: "google-test",
          PERPLEXITY_API_KEY: "perplexity-test",
          XAI_API_KEY: "xai-test",
        },
      },
    );
    expect([...providers.keys()]).toEqual(["google", "perplexity", "xai"]);
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
