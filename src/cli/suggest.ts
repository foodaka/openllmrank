import { writeFileSync } from "node:fs";
import { defineCommand } from "citty";
import OpenAI from "openai";
import { openDb } from "../core/db";
import { generateSuggestions, renderSuggestions } from "../core/suggest";
import { loadConfig, loadEnvFile } from "./config-loader";

export const suggestCmd = defineCommand({
  meta: {
    name: "suggest",
    description: "Suggest content improvements based on the latest run's losing prompts",
  },
  args: {
    config: { type: "string", default: "openllmrank.config.json" },
    db: { type: "string", default: "data/openllmrank.db" },
    top: { type: "string", default: "3" },
    prompt: { type: "string", description: "Filter to one prompt (substring match)" },
    output: { type: "string", default: "suggestions.md" },
    model: { type: "string", default: "gpt-4o-mini" },
  },
  async run({ args }) {
    loadEnvFile();
    const cfg = loadConfig(args.config);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("! OPENAI_API_KEY is not set. Add it to your environment or .env file.");
      process.exit(1);
    }
    const client = new OpenAI({ apiKey });
    const db = openDb(args.db);
    const topN = Math.max(1, Number.parseInt(args.top, 10));

    console.log(`Analyzing top ${topN} losing prompt(s)...`);
    let suggestions;
    try {
      suggestions = await generateSuggestions({
        db,
        config: cfg,
        client,
        model: args.model,
        topN,
        promptFilter: args.prompt,
      });
    } catch (e) {
      console.error(`! ${(e as Error).message ?? e}`);
      process.exit(1);
    }

    const md = renderSuggestions(suggestions, cfg.brand.name);
    writeFileSync(args.output, md);
    console.log(`+ Wrote ${args.output}`);

    const ok = suggestions.filter((s) => !s.error).length;
    const failed = suggestions.length - ok;
    console.log(`Generated ${ok} suggestion(s); ${failed} skipped due to fetch/LLM errors.`);
    if (failed > 0) {
      for (const s of suggestions.filter((s) => s.error)) {
        console.log(`  - "${s.prompt_text.slice(0, 50)}…": ${s.error}`);
      }
    }
  },
});
