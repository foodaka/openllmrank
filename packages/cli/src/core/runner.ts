import pLimit from "p-limit";
import type { Database } from "bun:sqlite";
import { insertCall, insertCitations } from "./db";
import type { Brand, Provider, ProviderError, ProviderId } from "./types";
import { extractCitations } from "./citations";

export type PlanItem = {
  prompt_id: string;
  prompt_text: string;
  model: string;
  provider_id: ProviderId;
  sample_index: number;
};

export type RunOptions = {
  db: Database;
  run_id: string;
  plan: PlanItem[];
  providers: Map<ProviderId, Provider>;
  brand: Brand;
  competitors: Brand[];
  concurrency_per_provider: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, last_status?: string) => void;
};

export type RunSummary = {
  total: number;
  succeeded: number;
  failed: number;
  cost_usd_total: number;
  aborted: boolean;
};

const MAX_RETRIES_TRANSIENT = 5;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

function isProviderError(e: unknown): e is ProviderError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    typeof (e as { kind: unknown }).kind === "string"
  );
}

function backoffMs(attempt: number): number {
  const ms = BASE_BACKOFF_MS * Math.pow(2, attempt);
  const jittered = ms + Math.floor(Math.random() * 250);
  return Math.min(jittered, MAX_BACKOFF_MS);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

class FatalAuthError extends Error {
  constructor(public provider: ProviderId, message: string) {
    super(message);
    this.name = "FatalAuthError";
  }
}

async function executeWithRetry(
  provider: Provider,
  item: PlanItem,
  signal: AbortSignal | undefined,
): Promise<
  | { ok: true; result: Awaited<ReturnType<Provider["query"]>> }
  | { ok: false; error: ProviderError }
> {
  for (let attempt = 0; attempt <= MAX_RETRIES_TRANSIENT; attempt++) {
    if (signal?.aborted) {
      return {
        ok: false,
        error: { kind: "unknown", message: "aborted", raw: null },
      };
    }
    try {
      const result = await provider.query({
        prompt: item.prompt_text,
        model: item.model,
        signal,
      });
      return { ok: true, result };
    } catch (err) {
      const pe: ProviderError = isProviderError(err)
        ? err
        : { kind: "unknown", message: String(err), raw: err };

      if (pe.kind === "auth") {
        throw new FatalAuthError(provider.id, pe.message);
      }
      if (pe.kind === "bad_request") {
        return { ok: false, error: pe };
      }
      if (attempt === MAX_RETRIES_TRANSIENT) {
        return { ok: false, error: pe };
      }
      const wait = pe.retry_after_ms ?? backoffMs(attempt);
      try {
        await sleep(wait, signal);
      } catch {
        return {
          ok: false,
          error: { kind: "unknown", message: "aborted", raw: null },
        };
      }
    }
  }
  return {
    ok: false,
    error: { kind: "unknown", message: "exhausted retries", raw: null },
  };
}

export async function executeRun(opts: RunOptions): Promise<RunSummary> {
  const { db, run_id, plan, providers, brand, competitors, concurrency_per_provider, signal } =
    opts;

  const limiters = new Map<ProviderId, ReturnType<typeof pLimit>>();
  const total = plan.length;
  let done = 0;
  let succeeded = 0;
  let failed = 0;
  let cost_total = 0;
  let aborted = false;
  const allBrands = [brand, ...competitors];

  const tasks = plan.map((item) => {
    const provider = providers.get(item.provider_id);
    if (!provider) {
      throw new Error(`No provider registered for id=${item.provider_id}`);
    }
    if (!limiters.has(item.provider_id)) {
      limiters.set(item.provider_id, pLimit(concurrency_per_provider));
    }
    const limit = limiters.get(item.provider_id)!;
    return limit(async () => {
      if (signal?.aborted || aborted) {
        return;
      }
      const outcome = await executeWithRetry(provider, item, signal);
      if (outcome.ok) {
        const r = outcome.result;
        insertCall(db, {
          run_id,
          prompt_id: item.prompt_id,
          sample_index: item.sample_index,
          response_text: r.response_text,
          search_results_json: JSON.stringify(r.search_results),
          latency_ms: r.latency_ms,
          tokens_in: r.tokens_in,
          tokens_out: r.tokens_out,
          cost_usd: r.cost_usd,
          error_code: null,
          error_message: null,
        });
        const citations = extractCitations(r.response_text, allBrands, r.search_results);
        if (citations.length > 0) {
          insertCitations(db, run_id, item.prompt_id, item.sample_index, citations);
        }
        succeeded += 1;
        cost_total += r.cost_usd;
      } else {
        insertCall(db, {
          run_id,
          prompt_id: item.prompt_id,
          sample_index: item.sample_index,
          response_text: "",
          search_results_json: "[]",
          latency_ms: 0,
          tokens_in: 0,
          tokens_out: 0,
          cost_usd: 0,
          error_code: outcome.error.kind,
          error_message: outcome.error.message,
        });
        failed += 1;
      }
      done += 1;
      opts.onProgress?.(done, total, outcome.ok ? "ok" : outcome.error.kind);
    });
  });

  try {
    await Promise.all(tasks);
  } catch (err) {
    if (err instanceof FatalAuthError) {
      aborted = true;
      throw err;
    }
    throw err;
  }

  if (signal?.aborted) aborted = true;

  return { total, succeeded, failed, cost_usd_total: cost_total, aborted };
}
