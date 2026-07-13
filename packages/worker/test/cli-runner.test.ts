import { afterEach, describe, expect, test } from "bun:test";
import type { HostedConfig } from "@openllmrank/shared/config";

const runtime = Bun as unknown as {
  spawn: (command: unknown, options?: unknown) => unknown;
};
const originalSpawn = runtime.spawn;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalCliTimeout = process.env.CLI_RUN_TIMEOUT_MS;

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  runtime.spawn = originalSpawn;
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey);
  restoreEnv("CLI_RUN_TIMEOUT_MS", originalCliTimeout);
});

describe("runCliJob provider environment", () => {
  test("forwards configured provider keys without leaking worker secrets", async () => {
    let capturedEnv: Record<string, string> | undefined;
    runtime.spawn = ((_command: unknown, options?: unknown) => {
      capturedEnv = (options as { env?: Record<string, string> } | undefined)?.env;
      return {
        exited: Promise.resolve(1),
        stdout: new Response('{"status":"error","code":"TEST","message":"stop"}\n').body,
        stderr: new Response("").body,
        kill() {},
      };
    });

    process.env.DATABASE_URL = "postgresql://worker-secret";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    process.env.CLI_RUN_TIMEOUT_MS = "1000";
    const { runCliJob } = await import("../src/cli-runner");
    const config = {
      brand: { name: "Acme", aliases: [] },
      competitors: [{ name: "Globex", aliases: [] }],
      prompts: ["best tools"],
      providers: [{ id: "google", model: "gemini-3.5-flash" }],
      samples_per_prompt: 1,
      concurrency_per_provider: 1,
    } satisfies HostedConfig;

    const result = await runCliJob({
      config,
      openaiKey: "openai-key",
      anthropicKey: "anthropic-key",
      googleKey: "google-key",
      perplexityKey: "perplexity-key",
      xaiKey: "xai-key",
    });
    result.cleanup();

    expect(capturedEnv).toMatchObject({
      OPENAI_API_KEY: "openai-key",
      ANTHROPIC_API_KEY: "anthropic-key",
      GOOGLE_API_KEY: "google-key",
      PERPLEXITY_API_KEY: "perplexity-key",
      XAI_API_KEY: "xai-key",
    });
    expect(capturedEnv).not.toHaveProperty("DATABASE_URL");
    expect(capturedEnv).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
  });
});
