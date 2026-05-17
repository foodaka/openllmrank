import { describe, expect, test } from "bun:test";
import {
  ConfigSchema,
  HostedConfigSchema,
  HOSTED_CAPS,
} from "../src/config";

const validBase = {
  brand: { name: "Acme", aliases: [] },
  competitors: [{ name: "Beta", aliases: [] }],
  prompts: ["best CRM for sales teams"],
  providers: [{ id: "openai" as const, model: "gpt-4o-mini" }],
  samples_per_prompt: 3,
  concurrency_per_provider: 4,
};

describe("ConfigSchema", () => {
  test("accepts a minimal valid config", () => {
    const parsed = ConfigSchema.parse(validBase);
    expect(parsed.brand.name).toBe("Acme");
  });

  test("rejects empty prompts array", () => {
    const r = ConfigSchema.safeParse({ ...validBase, prompts: [] });
    expect(r.success).toBe(false);
  });

  test("rejects empty providers array", () => {
    const r = ConfigSchema.safeParse({ ...validBase, providers: [] });
    expect(r.success).toBe(false);
  });

  test("CLI mode does NOT enforce hosted caps", () => {
    // CLI users are bring-your-own-key — they can run 50 prompts × 5 samples × 4 providers
    const huge = {
      ...validBase,
      prompts: Array.from({ length: 50 }, (_, i) => `prompt ${i}`),
      samples_per_prompt: 5,
      providers: [
        { id: "openai" as const, model: "gpt-4o-mini" },
        { id: "anthropic" as const, model: "claude-3-5-sonnet" },
      ],
    };
    expect(ConfigSchema.safeParse(huge).success).toBe(true);
  });
});

describe("HostedConfigSchema (wizard cap enforcement)", () => {
  test("accepts a config within all caps", () => {
    expect(HostedConfigSchema.safeParse(validBase).success).toBe(true);
  });

  test(`rejects > ${HOSTED_CAPS.max_prompts} prompts`, () => {
    const tooMany = {
      ...validBase,
      prompts: Array.from(
        { length: HOSTED_CAPS.max_prompts + 1 },
        (_, i) => `p${i}`,
      ),
    };
    expect(HostedConfigSchema.safeParse(tooMany).success).toBe(false);
  });

  test(`rejects samples_per_prompt > ${HOSTED_CAPS.max_samples_per_prompt}`, () => {
    const r = HostedConfigSchema.safeParse({
      ...validBase,
      samples_per_prompt: HOSTED_CAPS.max_samples_per_prompt + 1,
    });
    expect(r.success).toBe(false);
  });

  test(`rejects > ${HOSTED_CAPS.max_providers} providers`, () => {
    const tooMany = {
      ...validBase,
      providers: [
        { id: "openai" as const, model: "gpt-4o-mini" },
        { id: "anthropic" as const, model: "claude-3-5-sonnet" },
        { id: "google" as const, model: "gemini-pro" },
      ],
    };
    expect(HostedConfigSchema.safeParse(tooMany).success).toBe(false);
  });

  test("accepts boundary values (exactly at cap)", () => {
    const atCap = {
      ...validBase,
      prompts: Array.from(
        { length: HOSTED_CAPS.max_prompts },
        (_, i) => `p${i}`,
      ),
      samples_per_prompt: HOSTED_CAPS.max_samples_per_prompt,
      providers: [
        { id: "openai" as const, model: "gpt-4o-mini" },
        { id: "anthropic" as const, model: "claude-3-5-sonnet" },
      ],
    };
    expect(HostedConfigSchema.safeParse(atCap).success).toBe(true);
  });
});
