import { existsSync, readFileSync } from "node:fs";
import { ConfigSchema, type Config } from "../core/types";

export type LoadConfigError = {
  code: "CONFIG_NOT_FOUND" | "CONFIG_INVALID_JSON" | "CONFIG_SCHEMA_FAIL";
  message: string;
  detail?: unknown;
};

export class ConfigLoadError extends Error {
  constructor(public info: LoadConfigError) {
    super(info.message);
    this.name = "ConfigLoadError";
  }
}

function parseAndValidate(raw: unknown, source: string): Config {
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new ConfigLoadError({
      code: "CONFIG_SCHEMA_FAIL",
      message: `${source} failed validation`,
      detail: issues,
    });
  }
  return parsed.data;
}

/**
 * Load config from a file path. Returns the parsed Config or throws
 * ConfigLoadError. Callers in CLI command handlers translate the throw into
 * either a `process.exit(1)` (human mode) or a structured JSON error
 * (`--output-json` mode).
 */
export function loadConfigFromFile(path: string): Config {
  if (!existsSync(path)) {
    throw new ConfigLoadError({
      code: "CONFIG_NOT_FOUND",
      message: `${path} not found. Run 'openllmrank init' first.`,
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new ConfigLoadError({
      code: "CONFIG_INVALID_JSON",
      message: `${path} is not valid JSON: ${(e as Error).message}`,
    });
  }
  return parseAndValidate(raw, path);
}

/**
 * Load config from stdin. Used by the hosted worker which pipes a JSON config
 * to `openllmrank run --config-from-stdin --output-json` for each job.
 */
export async function loadConfigFromStdin(): Promise<Config> {
  const chunks: Uint8Array[] = [];
  // Bun's process.stdin is an async iterable of chunks; Node-compatible.
  for await (const chunk of process.stdin as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text.length === 0) {
    throw new ConfigLoadError({
      code: "CONFIG_INVALID_JSON",
      message: "stdin was empty; expected a JSON config object",
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ConfigLoadError({
      code: "CONFIG_INVALID_JSON",
      message: `stdin is not valid JSON: ${(e as Error).message}`,
    });
  }
  return parseAndValidate(raw, "stdin");
}

/**
 * Backward-compatible wrapper: loadConfig(path) — preserves the existing CLI
 * behavior of `process.exit(1)` with human messages on error. New code paths
 * (run.ts when --output-json is set) should call loadConfigFromFile and handle
 * the throw themselves.
 */
export function loadConfig(path: string): Config {
  try {
    return loadConfigFromFile(path);
  } catch (e) {
    if (e instanceof ConfigLoadError) {
      if (e.info.code === "CONFIG_SCHEMA_FAIL") {
        console.error(`! ${e.info.message}:`);
        for (const issue of (e.info.detail as string[]) ?? []) {
          console.error(`    ${issue}`);
        }
      } else {
        console.error(`! ${e.info.message}`);
      }
      process.exit(1);
    }
    throw e;
  }
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
