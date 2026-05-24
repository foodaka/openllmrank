import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "ollm-cli-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const CLI = join(import.meta.dir, "..", "src", "cli", "index.ts");

async function runCli(args: string[], cwd: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd,
    env: { ...process.env, ...env, OPENAI_API_KEY: env.OPENAI_API_KEY ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { code, stdout, stderr };
}

describe("CLI: init", () => {
  test("creates config and .env.example", async () => {
    const r = await runCli(["init"], tmp);
    expect(r.code).toBe(0);
    expect(existsSync(join(tmp, "openllmrank.config.json"))).toBe(true);
    expect(existsSync(join(tmp, ".env.example"))).toBe(true);
    const env = readFileSync(join(tmp, ".env.example"), "utf8");
    expect(env).toContain("OPENAI_API_KEY=");
    expect(env).toContain("ANTHROPIC_API_KEY=");
    expect(env).toContain("GOOGLE_API_KEY=");
    expect(env).toContain("PERPLEXITY_API_KEY=");
  });

  test("warns when config already exists without --force", async () => {
    await runCli(["init"], tmp);
    const r = await runCli(["init"], tmp);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("already exists");
  });

  test("--force overwrites", async () => {
    await runCli(["init"], tmp);
    const before = readFileSync(join(tmp, "openllmrank.config.json"), "utf8");
    const r = await runCli(["init", "--force"], tmp);
    expect(r.code).toBe(0);
    const after = readFileSync(join(tmp, "openllmrank.config.json"), "utf8");
    expect(after.length).toBe(before.length);
  });
});

describe("CLI: report with no data", () => {
  test("writes 'No data yet' report", async () => {
    await runCli(["init"], tmp);
    const r = await runCli(["report"], tmp);
    expect(r.code).toBe(0);
    const md = readFileSync(join(tmp, "gap-report.md"), "utf8");
    expect(md).toContain("No data yet");
  });

  test("--html writes a self-contained HTML report", async () => {
    await runCli(["init"], tmp);
    const r = await runCli(["report", "--html"], tmp);
    expect(r.code).toBe(0);
    const html = readFileSync(join(tmp, "gap-report.html"), "utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('data-testid="hero-score"');
    expect(html).not.toContain("https://cdn");
  });
});

describe("CLI: run with missing API key", () => {
  test("exits non-zero with friendly error", async () => {
    await runCli(["init"], tmp);
    const r = await runCli(["run"], tmp, { OPENAI_API_KEY: "" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("OPENAI_API_KEY");
  });
});

describe("CLI: run without config", () => {
  test("exits non-zero when config missing", async () => {
    const r = await runCli(["run"], tmp, { OPENAI_API_KEY: "fake" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not found");
  });
});

describe("CLI: run with invalid config JSON", () => {
  test("exits non-zero with parse error", async () => {
    await Bun.write(join(tmp, "openllmrank.config.json"), "not json");
    const r = await runCli(["run"], tmp, { OPENAI_API_KEY: "fake" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not valid JSON");
  });
});

describe("CLI: run with malformed config (schema)", () => {
  test("exits non-zero with validation errors", async () => {
    await Bun.write(
      join(tmp, "openllmrank.config.json"),
      JSON.stringify({ brand: { name: "" }, prompts: [], providers: [] }),
    );
    const r = await runCli(["run"], tmp, { OPENAI_API_KEY: "fake" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("failed validation");
  });
});

describe("CLI: export with no data", () => {
  test("succeeds and emits nothing", async () => {
    await runCli(["init"], tmp);
    const r = await runCli(["export"], tmp);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });
});
