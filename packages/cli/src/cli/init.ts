import { existsSync, writeFileSync } from "node:fs";
import { defineCommand } from "citty";

const SAMPLE_CONFIG = {
  brand: { name: "Acme", aliases: ["acme.com"] },
  competitors: [
    { name: "Globex", aliases: ["globex.com"] },
    { name: "Initech", aliases: ["initech.io"] },
  ],
  prompts: [
    "best AI search rank tracking tools",
    "open source alternatives to Ahrefs",
    "alternatives to Profound for AI visibility",
    "how do I rank in ChatGPT answers",
    "best tools for tracking brand mentions in AI search",
  ],
  providers: [
    { id: "openai", model: "gpt-4o-mini" },
    // Uncomment after adding ANTHROPIC_API_KEY to .env:
    // { id: "anthropic", model: "claude-haiku-4-5" },
    // Uncomment after adding GOOGLE_API_KEY to .env:
    // { id: "google", model: "gemini-2.0-flash" },
    // Uncomment after adding PERPLEXITY_API_KEY to .env:
    // { id: "perplexity", model: "sonar" },
  ],
  samples_per_prompt: 3,
  concurrency_per_provider: 4,
};

const SAMPLE_ENV = `# openllmrank API keys
# At least one provider key is required.

# OpenAI: https://platform.openai.com/api-keys
OPENAI_API_KEY=

# Anthropic: https://console.anthropic.com/settings/keys
# ANTHROPIC_API_KEY=

# Google Gemini: https://aistudio.google.com/app/apikey
# GOOGLE_API_KEY=

# Perplexity: https://www.perplexity.ai/settings/api
# PERPLEXITY_API_KEY=
`;

export const initCmd = defineCommand({
  meta: {
    name: "init",
    description: "Create openllmrank.config.json and .env.example in the current directory",
  },
  args: {
    force: { type: "boolean", description: "Overwrite existing config", default: false },
  },
  async run({ args }) {
    const configPath = "openllmrank.config.json";
    const envPath = ".env.example";

    if (existsSync(configPath) && !args.force) {
      console.error(`! ${configPath} already exists. Pass --force to overwrite.`);
    } else {
      writeFileSync(configPath, JSON.stringify(SAMPLE_CONFIG, null, 2) + "\n");
      console.log(`+ Wrote ${configPath}`);
    }
    if (existsSync(envPath) && !args.force) {
      console.error(`! ${envPath} already exists. Pass --force to overwrite.`);
    } else {
      writeFileSync(envPath, SAMPLE_ENV);
      console.log(`+ Wrote ${envPath}`);
    }

    console.log(`
Next:
  1. Edit ${configPath} with your brand, competitors, and prompts
  2. Copy ${envPath} to .env and add at least one provider key
  3. Run: openllmrank run
`);
  },
});
