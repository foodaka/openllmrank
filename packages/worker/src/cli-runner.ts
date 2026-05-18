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

// Module-level handle to the running CLI subprocess (if any). Exposed so
// the worker's signal handler can kill the child during graceful shutdown.
// Single-concurrency worker → one active proc at most. (Fix from /review
// 2026-05-18: without this, SIGTERM during Railway deploy left the child
// running until Bun's process tree was SIGKILLed, with a stuck job in
// 'running' state until the 30-min lease reclaim.)
let _activeProc: Bun.Subprocess | null = null;
let _shutdownRequested = false;

export function killActiveSubprocess(): void {
  _shutdownRequested = true;
  if (_activeProc) {
    try {
      _activeProc.kill("SIGTERM");
    } catch {
      // Best effort; the proc may have just exited
    }
  }
}

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

  // Explicit env allowlist instead of spreading process.env. Keeps
  // DATABASE_URL / SUPABASE_SERVICE_ROLE_KEY / STRIPE_SECRET_KEY /
  // POSTMARK_SERVER_TOKEN out of the CLI subprocess in case a future
  // CLI dependency (or compromised npm transitive) reads process.env to
  // exfiltrate. (P0 finding from /review on 2026-05-18.)
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    OPENAI_API_KEY: args.openaiKey,
    ANTHROPIC_API_KEY: args.anthropicKey,
  };
  // Preserve a handful of runtime envs that affect Bun/Node bootstrap
  // (NOT secrets).
  for (const k of ["BUN_INSTALL", "NODE_ENV", "TZ", "LANG", "LC_ALL"]) {
    if (process.env[k]) childEnv[k] = process.env[k]!;
  }

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
      env: childEnv,
      stdin: new TextEncoder().encode(JSON.stringify(args.config)),
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  _activeProc = proc;

  // Race the subprocess against the configured timeout. Track whether WE
  // killed it — distinguishes a real timeout from a shutdown-induced kill
  // initiated by the worker's signal handler.
  let weKilledForTimeout = false;
  const timeoutHandle = setTimeout(() => {
    weKilledForTimeout = true;
    proc.kill("SIGKILL");
  }, env.cliRunTimeoutMs);

  let exitCode: number | null;
  try {
    exitCode = await proc.exited;
  } finally {
    clearTimeout(timeoutHandle);
    _activeProc = null;
  }

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

  // Killed by the worker's shutdown handler? Treat as INTERRUPTED so the
  // job stays in 'running' for the stale-lease reclaim to pick up. Same
  // applies to signal-coded exits (137 = SIGKILL, 143 = SIGTERM) — those
  // mean SOMETHING killed us, not that the CLI itself failed.
  if (_shutdownRequested || exitCode === null || exitCode === 137 || exitCode === 143) {
    return {
      ok: false,
      code: "INTERRUPTED",
      message: `CLI subprocess interrupted (exitCode=${exitCode}, shutdown=${_shutdownRequested})`,
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
