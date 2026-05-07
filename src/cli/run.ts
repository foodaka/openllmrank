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
import { loadConfig, loadEnvFile } from "./config-loader";

function buildProviders(cfg: Config): Map<ProviderId, Provider> {
  const map = new Map<ProviderId, Provider>();
  const wantedIds = new Set(cfg.providers.map((p) => p.id));
  const tryRegister = (id: ProviderId, factory: () => Provider) => {
    try {
      map.set(id, factory());
    } catch (e) {
      const err = e as { kind?: string; message?: string };
      console.error(`! ${err.message ?? e}`);
      process.exit(1);
    }
  };
  if (wantedIds.has("openai")) tryRegister("openai", () => new OpenAIProvider());
  if (wantedIds.has("anthropic")) tryRegister("anthropic", () => new AnthropicProvider());
  for (const id of wantedIds) {
    if (id !== "openai" && id !== "anthropic") {
      console.error(
        `! Provider '${id}' is not implemented yet. v0.2 supports OpenAI + Anthropic. Gemini and Perplexity coming.`,
      );
      process.exit(1);
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
    db: { type: "string", default: "data/openllmrank.db" },
    concurrency: { type: "string" },
    samples: { type: "string" },
    resume: { type: "boolean", default: false },
    "retry-failed": { type: "boolean", default: false },
  },
  async run({ args }) {
    loadEnvFile();
    const cfg = loadConfig(args.config);
    const parsePositiveInt = (raw: string | undefined, flag: string): number | undefined => {
      if (raw === undefined) return undefined;
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0 || String(n) !== raw.trim()) {
        console.error(`! --${flag} must be a positive integer, got '${raw}'.`);
        process.exit(1);
      }
      return n;
    };
    const concurrency =
      parsePositiveInt(args.concurrency, "concurrency") ?? cfg.concurrency_per_provider;
    const samples = parsePositiveInt(args.samples, "samples");

    const db = openDb(args.db);
    const providers = buildProviders(cfg);
    const cfg_hash = configHash(cfg);
    const plan = buildPlan(cfg, db, samples);

    let run_id: string;
    let toExecute: PlanItem[];
    if (args["retry-failed"]) {
      const latest = findLatestFinishedRun(db);
      if (!latest) {
        console.error("! No finished run to retry against. Run 'openllmrank run' first.");
        process.exit(1);
      }
      run_id = latest;
      const failed = findFailedTuples(db, run_id);
      const failedKeys = new Set(failed.map((f) => `${f.prompt_id}|${f.sample_index}`));
      toExecute = plan.filter((p) => failedKeys.has(`${p.prompt_id}|${p.sample_index}`));
      if (toExecute.length === 0) {
        console.log(`No failed rows in latest run (${run_id}). Nothing to retry.`);
        return;
      }
      console.log(`Retrying ${toExecute.length} failed rows from run ${run_id}.`);
    } else if (args.resume) {
      const existing = findUnfinishedRun(db);
      if (!existing) {
        console.error("! No unfinished run to resume. Starting a new run instead.");
        run_id = new Date().toISOString().replace(/[:.]/g, "-");
        startRun(db, run_id, cfg_hash);
        toExecute = plan;
      } else if (existing.config_hash !== cfg_hash) {
        console.error(
          `! The unfinished run ${existing.run_id} was started with a different config (hash mismatch).`,
        );
        console.error(
          `  Resuming would mix old + new config. Either revert your config edits and re-run --resume,`,
        );
        console.error(`  or run without --resume to start a fresh run with the current config.`);
        process.exit(1);
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
        console.log(
          `Resuming run ${run_id}: ${toExecute.length} of ${plan.length} calls remaining.`,
        );
      }
    } else {
      run_id = new Date().toISOString().replace(/[:.]/g, "-");
      startRun(db, run_id, cfg_hash);
      toExecute = plan;
    }

    if (toExecute.length === 0) {
      console.log("Nothing to do. Run already complete.");
      finishRun(db, run_id);
      return;
    }

    const ctrl = new AbortController();
    const onSigint = () => {
      console.error("\n! Interrupted. Finalizing partial run; resume with --resume.");
      ctrl.abort();
    };
    process.on("SIGINT", onSigint);

    const bar = new cliProgress.SingleBar(
      {
        format: "  {bar} | {value}/{total} | ok={ok} fail={fail} | ${cost_usd}",
        hideCursor: true,
        stream: process.stderr,
      },
      cliProgress.Presets.shades_classic,
    );
    bar.start(toExecute.length, 0, { ok: 0, fail: 0, cost_usd: "0.0000" });

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
        onProgress: (done, total, status) => {
          if (status === "ok") ok += 1;
          else if (status) fail += 1;
          bar.update(done, { ok, fail, cost_usd: cost.toFixed(4) });
        },
      });
      cost = summary.cost_usd_total;
      bar.update(toExecute.length, { ok: summary.succeeded, fail: summary.failed, cost_usd: cost.toFixed(4) });
      bar.stop();

      if (!summary.aborted) {
        finishRun(db, run_id);
      }
      console.log(
        `\nDone. ${summary.succeeded} succeeded, ${summary.failed} failed. Cost: $${summary.cost_usd_total.toFixed(4)}.`,
      );
      console.log(`Next: openllmrank report`);
    } catch (e) {
      bar.stop();
      const err = e as { name?: string; message?: string };
      if (err.name === "FatalAuthError") {
        console.error(`\n! Auth failed: ${err.message}`);
        console.error(`  Set OPENAI_API_KEY (in your environment or a .env file).`);
        process.exit(1);
      }
      throw e;
    } finally {
      process.off("SIGINT", onSigint);
    }
  },
});
