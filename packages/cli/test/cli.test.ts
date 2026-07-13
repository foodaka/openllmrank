import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  finishRun,
  insertCall,
  insertCitations,
  openDb,
  startRun,
  upsertPrompt,
} from "../src/core/db";
import { suggestCmd } from "../src/cli/suggest";

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
    const configPath = join(tmp, "openllmrank.config.json");
    const envPath = join(tmp, ".env.example");
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(envPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.brand).toMatchObject({
      website: "https://acme.com",
      category: "AI search visibility tools",
    });
    expect(config.providers).toContainEqual({ id: "openai", model: "gpt-5.4-mini" });
    const envExample = readFileSync(envPath, "utf8");
    for (const key of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GOOGLE_API_KEY",
      "PERPLEXITY_API_KEY",
      "XAI_API_KEY",
    ]) {
      expect(envExample).toContain(`${key}=`);
    }
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

describe("CLI: suggest defaults", () => {
  test("uses the current low-cost suggestion model", () => {
    const args = suggestCmd.args as { model?: { default?: string } };
    expect(args.model?.default).toBe("gpt-5.4-mini");
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

  test("--html carries website, prompt models, and failed calls into coverage disclosure", async () => {
    await runCli(["init"], tmp);
    const dbPath = join(tmp, "report.db");
    const outputPath = join(tmp, "report.html");
    const db = openDb(dbPath);
    startRun(db, "r-report", "config-hash");
    upsertPrompt(
      db,
      "p-report",
      "best AI search visibility tools",
      "gpt-5.4-mini",
      "openai",
      "{}",
    );
    insertCall(db, {
      run_id: "r-report",
      prompt_id: "p-report",
      sample_index: 0,
      response_text: "Globex is frequently recommended.",
      search_results_json: "[]",
      latency_ms: 10,
      tokens_in: 10,
      tokens_out: 20,
      cost_usd: 0.01,
      error_code: null,
      error_message: null,
    });
    insertCitations(db, "r-report", "p-report", 0, [
      { brand: "Globex", matched_text: "Globex", kind: "name" },
      {
        brand: "Globex",
        matched_text: "https://example.com/globex-review",
        kind: "grounded_source",
      },
    ]);
    insertCall(db, {
      run_id: "r-report",
      prompt_id: "p-report",
      sample_index: 1,
      response_text: "",
      search_results_json: "[]",
      latency_ms: 10,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      error_code: "transient",
      error_message: "upstream unavailable",
    });
    finishRun(db, "r-report");
    db.close();

    const result = await runCli([
      "report",
      "--html",
      "--db",
      dbPath,
      "--output",
      outputPath,
    ], tmp);
    expect(result.code).toBe(0);
    const html = readFileSync(outputPath, "utf8");
    expect(html).toContain("50% (1/2)");
    expect(html).toContain("1 of 2 planned calls failed");
    expect(html).toContain("openai: gpt-5.4-mini");
    expect(html).toContain("on acme.com");
    expect(html).toContain("https://example.com/globex-review");
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
