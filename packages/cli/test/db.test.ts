import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  computePromptId,
  finishRun,
  findMissingTuples,
  findUnfinishedRun,
  getAllCallsSince,
  getCallsSince,
  insertCall,
  insertCitations,
  migrate,
  startRun,
  upsertPrompt,
} from "../src/core/db";

function memDb() {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

describe("computePromptId", () => {
  test("same inputs produce same id", () => {
    const a = computePromptId("hello", "gpt-4o", "openai", { tools: ["web_search"] });
    const b = computePromptId("hello", "gpt-4o", "openai", { tools: ["web_search"] });
    expect(a).toBe(b);
  });

  test("different prompt_text produces different id", () => {
    const a = computePromptId("hello", "gpt-4o", "openai", {});
    const b = computePromptId("hello world", "gpt-4o", "openai", {});
    expect(a).not.toBe(b);
  });

  test("different model produces different id", () => {
    const a = computePromptId("hello", "gpt-4o", "openai", {});
    const b = computePromptId("hello", "gpt-4o-mini", "openai", {});
    expect(a).not.toBe(b);
  });

  test("different config slice produces different id", () => {
    const a = computePromptId("hello", "gpt-4o", "openai", { tools: ["web_search"] });
    const b = computePromptId("hello", "gpt-4o", "openai", { tools: [] });
    expect(a).not.toBe(b);
  });
});

describe("schema migrations", () => {
  test("migrate is idempotent", () => {
    const db = new Database(":memory:");
    migrate(db);
    migrate(db);
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all();
    const names = tables.map((t) => t.name);
    expect(names).toContain("prompts");
    expect(names).toContain("runs");
    expect(names).toContain("calls");
    expect(names).toContain("citations");
  });
});

describe("findMissingTuples", () => {
  test("returns all tuples when nothing recorded", () => {
    const db = memDb();
    startRun(db, "r1", "h");
    upsertPrompt(db, "p1", "x", "gpt-4o", "openai", "{}");
    const planned = [
      { prompt_id: "p1", sample_index: 0 },
      { prompt_id: "p1", sample_index: 1 },
    ];
    const missing = findMissingTuples(db, "r1", planned);
    expect(missing).toHaveLength(2);
  });

  test("excludes tuples already recorded successfully", () => {
    const db = memDb();
    startRun(db, "r1", "h");
    upsertPrompt(db, "p1", "x", "gpt-4o", "openai", "{}");
    insertCall(db, {
      run_id: "r1",
      prompt_id: "p1",
      sample_index: 0,
      response_text: "x",
      search_results_json: "[]",
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      error_code: null,
      error_message: null,
    });
    const planned = [
      { prompt_id: "p1", sample_index: 0 },
      { prompt_id: "p1", sample_index: 1 },
    ];
    const missing = findMissingTuples(db, "r1", planned);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.sample_index).toBe(1);
  });

  test("includes tuples that errored previously (for retry)", () => {
    const db = memDb();
    startRun(db, "r1", "h");
    upsertPrompt(db, "p1", "x", "gpt-4o", "openai", "{}");
    insertCall(db, {
      run_id: "r1",
      prompt_id: "p1",
      sample_index: 0,
      response_text: "",
      search_results_json: "[]",
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      error_code: "transient",
      error_message: "boom",
    });
    const planned = [{ prompt_id: "p1", sample_index: 0 }];
    const missing = findMissingTuples(db, "r1", planned);
    expect(missing).toHaveLength(1);
  });

  test("empty planned returns empty", () => {
    const db = memDb();
    startRun(db, "r1", "h");
    const missing = findMissingTuples(db, "r1", []);
    expect(missing).toEqual([]);
  });
});

describe("run lifecycle", () => {
  test("findUnfinishedRun returns latest unfinished run with config_hash", () => {
    const db = memDb();
    startRun(db, "r1", "h1");
    finishRun(db, "r1");
    startRun(db, "r2", "h2");
    const found = findUnfinishedRun(db);
    expect(found?.run_id).toBe("r2");
    expect(found?.config_hash).toBe("h2");
  });

  test("findUnfinishedRun returns null when all are finished", () => {
    const db = memDb();
    startRun(db, "r1", "h");
    finishRun(db, "r1");
    expect(findUnfinishedRun(db)).toBeNull();
  });
});

describe("insertCall conflict", () => {
  test("same (run_id, prompt_id, sample_index) replaces (resume safety)", () => {
    const db = memDb();
    startRun(db, "r1", "h");
    upsertPrompt(db, "p1", "x", "gpt-4o", "openai", "{}");
    insertCall(db, {
      run_id: "r1",
      prompt_id: "p1",
      sample_index: 0,
      response_text: "first",
      search_results_json: "[]",
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      error_code: "transient",
      error_message: null,
    });
    insertCall(db, {
      run_id: "r1",
      prompt_id: "p1",
      sample_index: 0,
      response_text: "second",
      search_results_json: "[]",
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      error_code: null,
      error_message: null,
    });
    const row = db
      .query<{ response_text: string; error_code: string | null }, [string]>(
        "SELECT response_text, error_code FROM calls WHERE run_id = ?",
      )
      .get("r1");
    expect(row?.response_text).toBe("second");
    expect(row?.error_code).toBeNull();
  });
});

describe("call reporting queries", () => {
  test("reports retain failed calls without widening the successful-call export contract", () => {
    const db = memDb();
    startRun(db, "r1", "h");
    upsertPrompt(db, "p1", "x", "chat-latest", "openai", "{}");
    for (const [sample_index, error_code] of [[0, null], [1, "transient"]] as const) {
      insertCall(db, {
        run_id: "r1",
        prompt_id: "p1",
        sample_index,
        response_text: error_code ? "" : "Acme",
        search_results_json: "[]",
        latency_ms: 0,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
        error_code,
        error_message: error_code ? "upstream unavailable" : null,
      });
    }

    const since = new Date(Date.now() - 60_000).toISOString();
    const reportRows = getAllCallsSince(db, since);
    expect(reportRows).toHaveLength(2);
    expect(reportRows.map((row) => row.error_code)).toEqual([null, "transient"]);
    expect(getCallsSince(db, since).map((row) => row.error_code)).toEqual([null]);
  });
});

describe("insertCitations", () => {
  test("transactionally inserts multiple citations", () => {
    const db = memDb();
    startRun(db, "r1", "h");
    upsertPrompt(db, "p1", "x", "gpt-4o", "openai", "{}");
    insertCitations(db, "r1", "p1", 0, [
      { brand: "Acme", matched_text: "Acme", kind: "name" },
      { brand: "Globex", matched_text: "Globex", kind: "name" },
    ]);
    const n = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM citations").get();
    expect(n?.n).toBe(2);
  });
});
