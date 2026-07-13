import { z } from "zod";

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "perplexity"
  | "xai";

export const PROVIDER_IDS: ProviderId[] = [
  "openai",
  "anthropic",
  "google",
  "perplexity",
  "xai",
];

export const BrandSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  website: z.string().url().optional(),
  category: z.string().min(2).max(120).optional(),
});
export type Brand = z.infer<typeof BrandSchema>;

export const ProviderConfigSchema = z.object({
  id: z.enum(["openai", "anthropic", "google", "perplexity", "xai"]),
  model: z.string().min(1),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ConfigSchema = z.object({
  brand: BrandSchema,
  competitors: z.array(BrandSchema).default([]),
  prompts: z.array(z.string().min(1)).min(1),
  providers: z.array(ProviderConfigSchema).min(1),
  samples_per_prompt: z.number().int().positive().default(3),
  concurrency_per_provider: z.number().int().positive().default(4),
});
export type Config = z.infer<typeof ConfigSchema>;

export const HOSTED_CAPS = {
  max_prompts: 10,
  max_samples_per_prompt: 3,
  max_providers: 2,
} as const;

export const HostedConfigSchema = ConfigSchema.extend({
  prompts: z.array(z.string().min(1)).min(1).max(HOSTED_CAPS.max_prompts),
  samples_per_prompt: z
    .number()
    .int()
    .positive()
    .max(HOSTED_CAPS.max_samples_per_prompt)
    .default(3),
  providers: z
    .array(ProviderConfigSchema)
    .min(1)
    .max(HOSTED_CAPS.max_providers),
});
export type HostedConfig = z.infer<typeof HostedConfigSchema>;
