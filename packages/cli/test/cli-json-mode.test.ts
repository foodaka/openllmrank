import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests for the new --output-json and --config-from-stdin flags. These are the
// worker contract: when the hosted webapp's Railway worker spawns the CLI for
// a paid customer's job, it pipes JSON config to stdin, expects a structured
// JSON result on stdout, and treats stderr as opaque logging.

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "ollm-cli-json-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const CLI = join(import.meta.dir, "..", "src", "cli", "index.ts");

async function runCli(
  args: string[],
  cwd: string,
  opts: { env?: Record<string, string>; stdin?: string } = {},
) {
  const env = { ...process.env, ...(opts.env ?? {}) };
  if (opts.env && "OPENAI_API_KEY" in opts.env === false) {
    // Mirror cli.test.ts behavior: blank the key unless the test set one.
    env.OPENAI_API_KEY = "";
  }
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd,
    env,
    stdin: opts.stdin ? new TextEncoder().encode(opts.stdin) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { code, stdout, stderr };
}

function parseLastJsonLine(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split("\n").filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  return JSON.parse(last);
}

const validConfig = {
  brand: { name: "Acme", aliases: [] },
  competitors: [{ name: "Beta", aliases: [] }],
  prompts: ["best CRM for sales teams"],
  providers: [{ id: "openai", model: "gpt-4o-mini" }],
  samples_per_prompt: 3,
  concurrency_per_provider: 4,
};

describe("CLI --output-json: error contract", () => {
  test("config missing → stdout JSON {status:error, code:CONFIG_NOT_FOUND}", async () => {
    const r = await runCli(["run", "--output-json"], tmp, {
      env: { OPENAI_API_KEY: "fake" },
    });
    expect(r.code).toBe(1);
    const out = parseLastJsonLine(r.stdout);
    expect(out.status).toBe("error");
    expect(out.code).toBe("CONFIG_NOT_FOUND");
    expect(typeof out.message).toBe("string");
  });

  test("invalid JSON file → stdout JSON {code:CONFIG_INVALID_JSON}", async () => {
    await Bun.write(join(tmp, "openllmrank.config.json"), "not json");
    const r = await runCli(["run", "--output-json"], tmp, {
      env: { OPENAI_API_KEY: "fake" },
    });
    expect(r.code).toBe(1);
    const out = parseLastJsonLine(r.stdout);
    expect(out.code).toBe("CONFIG_INVALID_JSON");
  });

  test("schema-fail config → stdout JSON {code:CONFIG_SCHEMA_FAIL, detail:[...]}", async () => {
    await Bun.write(
      join(tmp, "openllmrank.config.json"),
      JSON.stringify({ brand: { name: "" }, prompts: [], providers: [] }),
    );
    const r = await runCli(["run", "--output-json"], tmp, {
      env: { OPENAI_API_KEY: "fake" },
    });
    expect(r.code).toBe(1);
    const out = parseLastJsonLine(r.stdout);
    expect(out.code).toBe("CONFIG_SCHEMA_FAIL");
    expect(Array.isArray(out.detail)).toBe(true);
    expect((out.detail as string[]).length).toBeGreaterThan(0);
  });

  test("missing OPENAI_API_KEY → stdout JSON {code:PROVIDER_AUTH}", async () => {
    await Bun.write(
      join(tmp, "openllmrank.config.json"),
      JSON.stringify(validConfig),
    );
    const r = await runCli(["run", "--output-json"], tmp, {
      env: { OPENAI_API_KEY: "" },
    });
    expect(r.code).toBe(1);
    const out = parseLastJsonLine(r.stdout);
    expect(out.code).toBe("PROVIDER_AUTH");
    expect(out.message).toContain("OPENAI_API_KEY");
  });

  test("bad --concurrency arg → stdout JSON {code:BAD_ARG}", async () => {
    await Bun.write(
      join(tmp, "openllmrank.config.json"),
      JSON.stringify(validConfig),
    );
    const r = await runCli(
      ["run", "--output-json", "--concurrency", "not-a-number"],
      tmp,
      { env: { OPENAI_API_KEY: "fake" } },
    );
    expect(r.code).toBe(1);
    const out = parseLastJsonLine(r.stdout);
    expect(out.code).toBe("BAD_ARG");
  });

  test("--output-json keeps human messages off stdout (stdout = JSON only)", async () => {
    // CONFIG_NOT_FOUND path. stdout must contain ONE JSON line and nothing
    // else; stderr is allowed to have anything (or nothing).
    const r = await runCli(["run", "--output-json"], tmp, {
      env: { OPENAI_API_KEY: "fake" },
    });
    const trimmedLines = r.stdout.trim().split("\n").filter(Boolean);
    expect(trimmedLines.length).toBe(1);
    // The single line is valid JSON
    expect(() => JSON.parse(trimmedLines[0]!)).not.toThrow();
  });
});

describe("CLI --config-from-stdin", () => {
  test("empty stdin → CONFIG_INVALID_JSON", async () => {
    const r = await runCli(
      ["run", "--config-from-stdin", "--output-json"],
      tmp,
      { env: { OPENAI_API_KEY: "fake" }, stdin: "" },
    );
    expect(r.code).toBe(1);
    const out = parseLastJsonLine(r.stdout);
    expect(out.code).toBe("CONFIG_INVALID_JSON");
    expect((out.message as string).toLowerCase()).toContain("stdin");
  });

  test("non-JSON stdin → CONFIG_INVALID_JSON", async () => {
    const r = await runCli(
      ["run", "--config-from-stdin", "--output-json"],
      tmp,
      { env: { OPENAI_API_KEY: "fake" }, stdin: "definitely not json" },
    );
    expect(r.code).toBe(1);
    const out = parseLastJsonLine(r.stdout);
    expect(out.code).toBe("CONFIG_INVALID_JSON");
  });

  test("schema-fail piped → CONFIG_SCHEMA_FAIL with detail", async () => {
    const bad = { brand: { name: "" }, prompts: [], providers: [] };
    const r = await runCli(
      ["run", "--config-from-stdin", "--output-json"],
      tmp,
      { env: { OPENAI_API_KEY: "fake" }, stdin: JSON.stringify(bad) },
    );
    expect(r.code).toBe(1);
    const out = parseLastJsonLine(r.stdout);
    expect(out.code).toBe("CONFIG_SCHEMA_FAIL");
    expect(Array.isArray(out.detail)).toBe(true);
  });

  test("valid stdin but no API key → reaches PROVIDER_AUTH (proves stdin parse worked)", async () => {
    const r = await runCli(
      ["run", "--config-from-stdin", "--output-json"],
      tmp,
      { env: { OPENAI_API_KEY: "" }, stdin: JSON.stringify(validConfig) },
    );
    expect(r.code).toBe(1);
    const out = parseLastJsonLine(r.stdout);
    expect(out.code).toBe("PROVIDER_AUTH");
  });

  test("--config-from-stdin without --output-json still works (human mode)", async () => {
    // Pipe valid config but without API key; should hit auth error path with
    // human-readable stderr message (not JSON).
    const r = await runCli(["run", "--config-from-stdin"], tmp, {
      env: { OPENAI_API_KEY: "" },
      stdin: JSON.stringify(validConfig),
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("OPENAI_API_KEY");
    // stdout should be empty in human mode for an error path
    expect(r.stdout.trim()).toBe("");
  });
});

describe("CLI default mode (no --output-json) — regression", () => {
  test("missing config still produces human stderr, not JSON", async () => {
    const r = await runCli(["run"], tmp, { env: { OPENAI_API_KEY: "fake" } });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not found");
    expect(r.stdout.trim()).toBe("");
  });
});
