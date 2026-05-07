import { existsSync, readFileSync } from "node:fs";
import { ConfigSchema, type Config } from "../core/types";

export function loadConfig(path: string): Config {
  if (!existsSync(path)) {
    console.error(`! ${path} not found. Run 'openllmrank init' first.`);
    process.exit(1);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`! ${path} is not valid JSON: ${(e as Error).message}`);
    process.exit(1);
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`! ${path} failed validation:`);
    for (const issue of parsed.error.issues) {
      console.error(`    ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export function loadEnvFile(path = ".env"): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
