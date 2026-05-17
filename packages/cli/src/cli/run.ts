import { createHash } from "node:crypto";
import { defineCommand } from "citty";
import cliProgress from "cli-progress";
import {
  computePromptId,
  finishRun,
  findFailedTuples,
  findLatestFinishedRun,
  findMissingTuples,
  findUnfinishedRun,
  openDb,
  startRun,
  upsertPrompt,
  type PlannedTuple,
} from "../core/db";
import { type Config, type Provider, type ProviderId } from "../core/types";
import { executeRun, type PlanItem } from "../core/runner";
import { OpenAIProvider } from "../providers/openai";
import { AnthropicProvider } from "../providers/anthropic";
import {
  ConfigLoadError,
  loadConfigFromFile,
  loadConfigFromStdin,
  loadEnvFile,
} from "./config-loader";

// ---------------------------------------------------------------------------
// CLI run command — two output modes
// ---------------------------------------------------------------------------
//
// Default mode: progress bar on stderr, human-friendly messages on
// stdout/stderr, errors call process.exit(1).
//
// --output-json mode (used by the hosted worker that subprocesses this CLI):
// stdout emits a single line of JSON on completion, stderr gets all human
// output, the progress bar is silenced. On error, stdout emits a structured
// error object and the process exits non-zero.
//
// Worker contract — success on stdout:
//   {"status":"ok","run_id":"...","succeeded":N,"failed":N,"cost_usd_total":N,"aborted":false}
//
// Worker contract — error on stdout (then exit non-zero):
//   {"status":"error","code":"PROVIDER_AUTH","message":"...","detail":[...]?}
//
// Error codes:
//   CONFIG_NOT_FOUND | CONFIG_INVALID_JSON | CONFIG_SCHEMA_FAIL
//   PROVIDER_AUTH    | PROVIDER_UNSUPPORTED
//   BAD_ARG          | NO_FINISHED_RUN_TO_RETRY
//   CONFIG_HASH_MISMATCH_ON_RESUME
//   INTERRUPTED      | UNKNOWN
// ---------------------------------------------------------------------------

type ErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_INVALID_JSON"
  | "CONFIG_SCHEMA_FAIL"
  | "PROVIDER_AUTH"
  | "PROVIDER_UNSUPPORTED"
  | "BAD_ARG"
  | "NO_FINISHED_RUN_TO_RETRY"
  | "CONFIG_HASH_MISMATCH_ON_RESUME"
  | "INTERRUPTED"
  | "UNKNOWN";

class CliRunError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "CliRunError";
  }
}

function emitJsonError(err: CliRunError | ConfigLoadError): void {
  const payload: Record<string, unknown> = {
    status: "error",
    code: err instanceof ConfigLoadError ? err.info.code : err.code,
    message: err.message,
  };
  const detail =
    err instanceof ConfigLoadError ? err.info.detail : err.detail;
  if (detail !== undefined) payload.detail = detail;
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function buildProviders(cfg: Config): Map<ProviderId, Provider> {
  const map = new Map<ProviderId, Provider>();
  const wantedIds = new Set(cfg.providers.map((p) => p.id));
  const tryRegister = (id: ProviderId, factory: () => Provider) => {
    try {
      map.set(id, factory());
    } catch (e) {
      const err = e as { kind?: string; message?: string };
      throw new CliRunError(
        "PROVIDER_AUTH",
        err.message ?? String(e),
      );
    }
  };
  if (wantedIds.has("openai")) tryRegister("openai", () => new OpenAIProvider());
  if (wantedIds.has("anthropic")) tryRegister("anthropic", () => new AnthropicProvider());
  for (const id of wantedIds) {
    if (id !== "openai" && id !== "anthropic") {
      throw new CliRunError(
        "PROVIDER_UNSUPPORTED",
        `Provider '${id}' is not implemented yet. v0.2 supports OpenAI + Anthropic. Gemini and Perplexity coming.`,
      );
    }
  }
  return map;
}

function configHash(cfg: Config): string {
  return createHash("sha256").update(JSON.stringify(cfg)).digest("hex").slice(0, 16);
}

function buildPlan(
  cfg: Config,
  db: ReturnType<typeof openDb>,
  samplesOverride?: number,
): PlanItem[] {
  const plan: PlanItem[] = [];
  const samples = samplesOverride ?? cfg.samples_per_prompt;
  for (const provCfg of cfg.providers) {
    for (const prompt_text of cfg.prompts) {
      const prompt_id = computePromptId(prompt_text, provCfg.model, provCfg.id, {
        tools: ["web_search"],
      });
      upsertPrompt(
        db,
        prompt_id,
        prompt_text,
        provCfg.model,
        provCfg.id,
        JSON.stringify({ tools: ["web_search"] }),
      );
      for (let i = 0; i < samples; i++) {
        plan.push({
          prompt_id,
          prompt_text,
          model: provCfg.model,
          provider_id: provCfg.id,
          sample_index: i,
        });
      }
    }
  }
  return plan;
}

export const runCmd = defineCommand({
  meta: {
    name: "run",
    description: "Query providers for each configured prompt and persist results",
  },
  args: {
    config: { type: "string", default: "openllmrank.config.json" },
    "config-from-stdin": { type: "boolean", default: false },
    db: { type: "string", default: "data/openllmrank.db" },
    concurrency: { type: "string" },
    samples: { type: "string" },
    resume: { type: "boolean", default: false },
    "retry-failed": { type: "boolean", default: false },
    "output-json": { type: "boolean", default: false },
  },
  async run({ args }) {
    const jsonMode = args["output-json"] as boolean;
    const human = (line: string) => {
      if (jsonMode) process.stderr.write(line + "\n");
      else console.log(line);
    };
    const warn = (line: string) => process.stderr.write(line + "\n");

    const failFast = (err: CliRunError | ConfigLoadError): never => {
      if (jsonMode) {
        emitJsonError(err);
      } else if (err instanceof ConfigLoadError) {
        warn(`! ${err.info.message}`);
        if (err.info.code === "CONFIG_SCHEMA_FAIL") {
          for (const issue of (err.info.detail as string[]) ?? []) {
            warn(`    ${issue}`);
          }
        }
      } else {
        warn(`! ${err.message}`);
      }
      process.exit(1);
    };

    try {
      loadEnvFile();

      let cfg: Config;
      try {
        cfg = args["config-from-stdin"]
          ? await loadConfigFromStdin()
          : loadConfigFromFile(args.config);
      } catch (e) {
        if (e instanceof ConfigLoadError) failFast(e);
        throw e;
      }

      const parsePositiveInt = (
        raw: string | undefined,
        flag: string,
      ): number | undefined => {
        if (raw === undefined) return undefined;
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n <= 0 || String(n) !== raw.trim()) {
          failFast(
            new CliRunError(
              "BAD_ARG",
              `--${flag} must be a positive integer, got '${raw}'.`,
            ),
          );
        }
        return n;
      };
      const concurrency =
        parsePositiveInt(args.concurrency, "concurrency") ?? cfg.concurrency_per_provider;
      const samples = parsePositiveInt(args.samples, "samples");

      const db = openDb(args.db);

      let providers: Map<ProviderId, Provider>;
      try {
        providers = buildProviders(cfg);
      } catch (e) {
        if (e instanceof CliRunError) failFast(e);
        throw e;
      }
      const cfg_hash = configHash(cfg);
      const plan = buildPlan(cfg, db, samples);

      let run_id: string;
      let toExecute: PlanItem[];
      if (args["retry-failed"]) {
        const latest = findLatestFinishedRun(db);
        if (!latest) {
          failFast(
            new CliRunError(
              "NO_FINISHED_RUN_TO_RETRY",
              "No finished run to retry against. Run 'openllmrank run' first.",
            ),
          );
        }
        run_id = latest!;
        const failed = findFailedTuples(db, run_id);
        const failedKeys = new Set(failed.map((f) => `${f.prompt_id}|${f.sample_index}`));
        toExecute = plan.filter((p) => failedKeys.has(`${p.prompt_id}|${p.sample_index}`));
        if (toExecute.length === 0) {
          if (jsonMode) {
            process.stdout.write(
              JSON.stringify({
                status: "ok",
                run_id,
                succeeded: 0,
                failed: 0,
                cost_usd_total: 0,
                aborted: false,
                note: "no_failed_rows",
              }) + "\n",
            );
          } else {
            console.log(
              `No failed rows in latest run (${run_id}). Nothing to retry.`,
            );
          }
          return;
        }
        human(`Retrying ${toExecute.length} failed rows from run ${run_id}.`);
      } else if (args.resume) {
        const existing = findUnfinishedRun(db);
        if (!existing) {
          warn("! No unfinished run to resume. Starting a new run instead.");
          run_id = new Date().toISOString().replace(/[:.]/g, "-");
          startRun(db, run_id, cfg_hash);
          toExecute = plan;
        } else if (existing.config_hash !== cfg_hash) {
          failFast(
            new CliRunError(
              "CONFIG_HASH_MISMATCH_ON_RESUME",
              `The unfinished run ${existing.run_id} was started with a different config (hash mismatch). Resuming would mix old + new config. Either revert your config edits and re-run --resume, or run without --resume to start a fresh run with the current config.`,
            ),
          );
          return; // unreachable; satisfies TS
        } else {
          run_id = existing.run_id;
          const planned: PlannedTuple[] = plan.map((p) => ({
            prompt_id: p.prompt_id,
            sample_index: p.sample_index,
          }));
          const missing = findMissingTuples(db, run_id, planned);
          const missingKeys = new Set(missing.map((m) => `${m.prompt_id}|${m.sample_index}`));
          toExecute = plan.filter((p) =>
            missingKeys.has(`${p.prompt_id}|${p.sample_index}`),
          );
          human(
            `Resuming run ${run_id}: ${toExecute.length} of ${plan.length} calls remaining.`,
          );
        }
      } else {
        run_id = new Date().toISOString().replace(/[:.]/g, "-");
        startRun(db, run_id, cfg_hash);
        toExecute = plan;
      }

      if (toExecute.length === 0) {
        if (jsonMode) {
          process.stdout.write(
            JSON.stringify({
              status: "ok",
              run_id,
              succeeded: 0,
              failed: 0,
              cost_usd_total: 0,
              aborted: false,
              note: "already_complete",
            }) + "\n",
          );
        } else {
          console.log("Nothing to do. Run already complete.");
        }
        finishRun(db, run_id);
        return;
      }

      const ctrl = new AbortController();
      const onSigint = () => {
        warn("\n! Interrupted. Finalizing partial run; resume with --resume.");
        ctrl.abort();
      };
      process.on("SIGINT", onSigint);

      const bar = jsonMode
        ? null
        : new cliProgress.SingleBar(
            {
              format: "  {bar} | {value}/{total} | ok={ok} fail={fail} | ${cost_usd}",
              hideCursor: true,
              stream: process.stderr,
            },
            cliProgress.Presets.shades_classic,
          );
      if (bar) bar.start(toExecute.length, 0, { ok: 0, fail: 0, cost_usd: "0.0000" });

      let ok = 0;
      let fail = 0;
      let cost = 0;

      try {
        const summary = await executeRun({
          db,
          run_id,
          plan: toExecute,
          providers,
          brand: cfg.brand,
          competitors: cfg.competitors,
          concurrency_per_provider: concurrency,
          signal: ctrl.signal,
          onProgress: (done, _total, status) => {
            if (status === "ok") ok += 1;
            else if (status) fail += 1;
            if (bar) bar.update(done, { ok, fail, cost_usd: cost.toFixed(4) });
          },
        });
        cost = summary.cost_usd_total;
        if (bar) {
          bar.update(toExecute.length, {
            ok: summary.succeeded,
            fail: summary.failed,
            cost_usd: cost.toFixed(4),
          });
          bar.stop();
        }

        if (!summary.aborted) {
          finishRun(db, run_id);
        }

        if (jsonMode) {
          process.stdout.write(
            JSON.stringify({
              status: "ok",
              run_id,
              succeeded: summary.succeeded,
              failed: summary.failed,
              cost_usd_total: summary.cost_usd_total,
              aborted: summary.aborted,
            }) + "\n",
          );
        } else {
          console.log(
            `\nDone. ${summary.succeeded} succeeded, ${summary.failed} failed. Cost: $${summary.cost_usd_total.toFixed(4)}.`,
          );
          console.log(`Next: openllmrank report`);
        }
      } catch (e) {
        if (bar) bar.stop();
        const err = e as { name?: string; message?: string };
        if (err.name === "FatalAuthError") {
          failFast(
            new CliRunError(
              "PROVIDER_AUTH",
              err.message ?? "auth failed",
            ),
          );
        }
        throw e;
      } finally {
        process.off("SIGINT", onSigint);
      }
    } catch (e) {
      if (e instanceof CliRunError) failFast(e);
      if (e instanceof ConfigLoadError) failFast(e);
      // Unknown error — print in human mode, emit UNKNOWN in JSON mode
      if (jsonMode) {
        emitJsonError(
          new CliRunError("UNKNOWN", (e as Error).message ?? String(e)),
        );
        process.exit(1);
      }
      throw e;
    }
  },
});
