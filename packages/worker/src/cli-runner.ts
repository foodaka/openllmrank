// Spawn the openllmrank CLI as a subprocess for a single job. The CLI is
// the same binary OSS users run (packages/cli) — this is the "subprocess
// architecture" decided in Issue 1.2 of /plan-eng-review.
//
// Flow:
//   1. Create a temp dir for THIS job (Issue 2.1c)
//   2. Spawn: bun run packages/cli/src/cli/index.ts run
//             --config-from-stdin --output-json
//             --db <tmpdir>/openllmrank.db
//   3. Pipe the customer's HostedConfig JSON into stdin
//   4. Wait for exit, parse stdout (a single JSON line)
//   5. If exit 0: return success with run_id + path to sqlite db
//   6. If exit non-0: return error with code + message from the parsed JSON
//   7. Whether success or error: caller is responsible for cleaning up
//      the tmpdir after reading the sqlite db (or on error)
//
// Errors we have to handle here:
//   - Subprocess takes longer than CLI_RUN_TIMEOUT_MS → kill, return TIMEOUT
//   - Subprocess crashes without emitting JSON → return UNKNOWN with stderr tail
//   - Subprocess emits invalid JSON → return UNKNOWN with raw stdout tail

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { HostedConfig } from "@openllmrank/shared/config";
import { env } from "./env";

// Locate the CLI entry point. Workspaces resolve `openllmrank` to
// packages/cli; we want the index.ts inside that package.
const CLI_ENTRY = resolve(
  import.meta.dir,
  "..",
  "..",
  "cli",
  "src",
  "cli",
  "index.ts",
);

export type CliRunSuccess = {
  ok: true;
  run_id: string;
  succeeded: number;
  failed: number;
  cost_usd_total: number;
  aborted: boolean;
  sqlite_path: string;
  cleanup: () => void;
};

export type CliRunError = {
  ok: false;
  code: string;
  message: string;
  detail?: unknown;
  cleanup: () => void;
};

export type CliRunResult = CliRunSuccess | CliRunError;

/**
 * Run the CLI for one job. Caller passes the customer's HostedConfig + the
 * shared API keys to inject as env vars. Returns either a success record
 * (with a path to the temp sqlite db to read from) or a structured error.
 *
 * Caller MUST call cleanup() after reading the sqlite db (or unconditionally
 * on error) to remove the tmpdir.
 */
export async function runCliJob(args: {
  config: HostedConfig;
  openaiKey: string;
  anthropicKey: string;
}): Promise<CliRunResult> {
  const dir = mkdtempSync(join(tmpdir(), "openllmrank-job-"));
  const sqlitePath = join(dir, "openllmrank.db");
  const cleanup = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort. Tmpdirs are reaped by the OS anyway.
    }
  };

  const proc = Bun.spawn(
    [
      "bun",
      "run",
      CLI_ENTRY,
      "run",
      "--config-from-stdin",
      "--output-json",
      "--db",
      sqlitePath,
    ],
    {
      env: {
        ...process.env,
        OPENAI_API_KEY: args.openaiKey,
        ANTHROPIC_API_KEY: args.anthropicKey,
      },
      stdin: new TextEncoder().encode(JSON.stringify(args.config)),
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  // Race the subprocess against the configured timeout. Track whether WE
  // killed it — distinguishes a real timeout from a shutdown-induced kill
  // initiated by the worker's signal handler.
  let weKilledForTimeout = false;
  const timeoutHandle = setTimeout(() => {
    weKilledForTimeout = true;
    proc.kill("SIGKILL");
  }, env.cliRunTimeoutMs);

  const exitCode = await proc.exited;
  clearTimeout(timeoutHandle);

  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();

  // Parse the LAST non-empty stdout line as JSON. The CLI emits exactly one
  // JSON object on stdout in --output-json mode; defensively pick the last
  // line in case anything else slipped through.
  const lines = stdoutText.trim().split("\n").filter(Boolean);
  const lastLine = lines[lines.length - 1] ?? "";

  let parsed: Record<string, unknown> | null = null;
  if (lastLine) {
    try {
      parsed = JSON.parse(lastLine);
    } catch {
      parsed = null;
    }
  }

  if (exitCode === 0 && parsed?.status === "ok") {
    return {
      ok: true,
      run_id: String(parsed.run_id ?? ""),
      succeeded: Number(parsed.succeeded ?? 0),
      failed: Number(parsed.failed ?? 0),
      cost_usd_total: Number(parsed.cost_usd_total ?? 0),
      aborted: Boolean(parsed.aborted ?? false),
      sqlite_path: sqlitePath,
      cleanup,
    };
  }

  // Our timeout fired?
  if (weKilledForTimeout) {
    return {
      ok: false,
      code: "TIMEOUT",
      message: `CLI subprocess exceeded ${Math.round(env.cliRunTimeoutMs / 1000)}s and was killed`,
      cleanup,
    };
  }

  // Killed by something else (e.g., the worker received SIGTERM and signaled
  // its children). Don't classify as a real failure; the job should be left
  // in 'running' state so the stale-lease reclaim picks it up.
  if (exitCode === null) {
    return {
      ok: false,
      code: "INTERRUPTED",
      message: "CLI subprocess was interrupted (likely worker shutdown)",
      cleanup,
    };
  }

  if (parsed?.status === "error") {
    return {
      ok: false,
      code: String(parsed.code ?? "UNKNOWN"),
      message: String(parsed.message ?? "(no message)"),
      detail: parsed.detail,
      cleanup,
    };
  }

  // Exit non-zero with no structured JSON. Surface stderr for debugging.
  const stderrTail = stderrText.split("\n").slice(-10).join("\n");
  return {
    ok: false,
    code: "UNKNOWN",
    message: `CLI exited ${exitCode} with no JSON output. Stderr tail:\n${stderrTail}`,
    cleanup,
  };
}
