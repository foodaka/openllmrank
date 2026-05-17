import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { executeRun, type PlanItem } from "../src/core/runner";
import { migrate, startRun, upsertPrompt, computePromptId } from "../src/core/db";
import type { Provider, ProviderError, ProviderId } from "../src/core/types";

function memDb() {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

function buildPlan(prompt_text: string, samples: number, provider_id: ProviderId, db: Database): PlanItem[] {
  const model = "gpt-4o-mini";
  const prompt_id = computePromptId(prompt_text, model, provider_id, {});
  upsertPrompt(db, prompt_id, prompt_text, model, provider_id, "{}");
  return Array.from({ length: samples }, (_, i) => ({
    prompt_id,
    prompt_text,
    model,
    provider_id,
    sample_index: i,
  }));
}

class StubProvider implements Provider {
  id: ProviderId = "openai";
  calls = 0;
  constructor(private behavior: () => Promise<{
    response_text: string;
    search_results: never[];
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    latency_ms: number;
  }>) {}
  async query() {
    this.calls += 1;
    return this.behavior();
  }
}

class FlakyProvider implements Provider {
  id: ProviderId = "openai";
  calls = 0;
  constructor(private failuresBeforeSuccess: number, private errorKind: ProviderError["kind"] = "transient") {}
  async query() {
    this.calls += 1;
    if (this.calls <= this.failuresBeforeSuccess) {
      const err: ProviderError = {
        kind: this.errorKind,
        message: `simulated ${this.errorKind}`,
        raw: null,
        retry_after_ms: 1,
      };
      throw err;
    }
    return {
      response_text: "Acme is great",
      search_results: [],
      tokens_in: 10,
      tokens_out: 20,
      cost_usd: 0.001,
      latency_ms: 100,
    };
  }
}

describe("executeRun", () => {
  test("happy path: all calls succeed and citations recorded", async () => {
    const db = memDb();
    const run_id = "r1";
    startRun(db, run_id, "h");
    const plan = buildPlan("best ai tools", 3, "openai", db);
    const provider = new StubProvider(async () => ({
      response_text: "Acme leads.",
      search_results: [],
      tokens_in: 5,
      tokens_out: 10,
      cost_usd: 0.0005,
      latency_ms: 50,
    }));
    const summary = await executeRun({
      db,
      run_id,
      plan,
      providers: new Map([["openai", provider]]),
      brand: { name: "Acme", aliases: [] },
      competitors: [],
      concurrency_per_provider: 4,
    });
    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(3);
    expect(summary.failed).toBe(0);
    expect(summary.cost_usd_total).toBeCloseTo(0.0015);
    const cit = db.query("SELECT COUNT(*) as n FROM citations WHERE brand = 'Acme'").get() as { n: number };
    expect(cit.n).toBe(3);
  });

  test("transient errors trigger retry and eventually succeed", async () => {
    const db = memDb();
    const run_id = "r1";
    startRun(db, run_id, "h");
    const plan = buildPlan("x", 1, "openai", db);
    const provider = new FlakyProvider(2, "transient");
    const summary = await executeRun({
      db,
      run_id,
      plan,
      providers: new Map([["openai", provider]]),
      brand: { name: "Acme", aliases: [] },
      competitors: [],
      concurrency_per_provider: 1,
    });
    expect(summary.succeeded).toBe(1);
    expect(provider.calls).toBe(3);
  });

  test("rate_limit retries with retry_after honored", async () => {
    const db = memDb();
    const run_id = "r1";
    startRun(db, run_id, "h");
    const plan = buildPlan("x", 1, "openai", db);
    const provider = new FlakyProvider(1, "rate_limit");
    const summary = await executeRun({
      db,
      run_id,
      plan,
      providers: new Map([["openai", provider]]),
      brand: { name: "Acme", aliases: [] },
      competitors: [],
      concurrency_per_provider: 1,
    });
    expect(summary.succeeded).toBe(1);
    expect(provider.calls).toBe(2);
  });

  test("auth error throws and aborts the run", async () => {
    const db = memDb();
    const run_id = "r1";
    startRun(db, run_id, "h");
    const plan = buildPlan("x", 3, "openai", db);
    const provider: Provider = {
      id: "openai",
      async query() {
        const err: ProviderError = {
          kind: "auth",
          message: "Set OPENAI_API_KEY",
          raw: null,
        };
        throw err;
      },
    };
    let threw = false;
    try {
      await executeRun({
        db,
        run_id,
        plan,
        providers: new Map([["openai", provider]]),
        brand: { name: "Acme", aliases: [] },
        competitors: [],
        concurrency_per_provider: 1,
      });
    } catch (e) {
      threw = true;
      expect((e as Error).name).toBe("FatalAuthError");
    }
    expect(threw).toBe(true);
  });

  test("bad_request fails immediately without retries", async () => {
    const db = memDb();
    const run_id = "r1";
    startRun(db, run_id, "h");
    const plan = buildPlan("x", 1, "openai", db);
    const provider = new FlakyProvider(99, "bad_request");
    const summary = await executeRun({
      db,
      run_id,
      plan,
      providers: new Map([["openai", provider]]),
      brand: { name: "Acme", aliases: [] },
      competitors: [],
      concurrency_per_provider: 1,
    });
    expect(summary.succeeded).toBe(0);
    expect(summary.failed).toBe(1);
    expect(provider.calls).toBe(1);
  });

  test("transient errors give up after MAX_RETRIES and write an error record", async () => {
    const db = memDb();
    const run_id = "r1";
    startRun(db, run_id, "h");
    const plan = buildPlan("x", 1, "openai", db);
    const provider = new FlakyProvider(99, "transient");
    const summary = await executeRun({
      db,
      run_id,
      plan,
      providers: new Map([["openai", provider]]),
      brand: { name: "Acme", aliases: [] },
      competitors: [],
      concurrency_per_provider: 1,
    });
    expect(summary.succeeded).toBe(0);
    expect(summary.failed).toBe(1);
    expect(provider.calls).toBe(6);
    const row = db
      .query("SELECT error_code FROM calls WHERE prompt_id = ? AND sample_index = ?")
      .get(plan[0]!.prompt_id, 0) as { error_code: string };
    expect(row.error_code).toBe("transient");
  });

  test("progress callback fires for each completed task", async () => {
    const db = memDb();
    const run_id = "r1";
    startRun(db, run_id, "h");
    const plan = buildPlan("x", 5, "openai", db);
    const provider = new StubProvider(async () => ({
      response_text: "ok",
      search_results: [],
      tokens_in: 1,
      tokens_out: 1,
      cost_usd: 0.0001,
      latency_ms: 10,
    }));
    let progressCalls = 0;
    let lastDone = 0;
    await executeRun({
      db,
      run_id,
      plan,
      providers: new Map([["openai", provider]]),
      brand: { name: "Acme", aliases: [] },
      competitors: [],
      concurrency_per_provider: 2,
      onProgress: (d) => {
        progressCalls += 1;
        lastDone = d;
      },
    });
    expect(progressCalls).toBe(5);
    expect(lastDone).toBe(5);
  });
});
