import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Citation, ProviderId } from "./types";

export type PromptId = string;

export type PlannedTuple = {
  prompt_id: PromptId;
  sample_index: number;
};

export function computePromptId(
  prompt_text: string,
  model: string,
  provider: ProviderId,
  relevant_config: Record<string, unknown>,
): PromptId {
  const canonical = JSON.stringify({
    prompt_text,
    model,
    provider,
    config: relevant_config,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function openDb(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  // 5s wait on contention before reporting "database is locked". Two simultaneous
  // 'openllmrank run' invocations are rare but cheap to handle gracefully.
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompts (
      prompt_id   TEXT PRIMARY KEY,
      prompt_text TEXT NOT NULL,
      model       TEXT NOT NULL,
      provider    TEXT NOT NULL,
      config_blob TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      run_id      TEXT PRIMARY KEY,
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      config_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calls (
      run_id              TEXT NOT NULL,
      prompt_id           TEXT NOT NULL,
      sample_index        INTEGER NOT NULL,
      ts                  TEXT NOT NULL,
      response_text       TEXT NOT NULL DEFAULT '',
      search_results_json TEXT NOT NULL DEFAULT '[]',
      latency_ms          INTEGER NOT NULL DEFAULT 0,
      tokens_in           INTEGER NOT NULL DEFAULT 0,
      tokens_out          INTEGER NOT NULL DEFAULT 0,
      cost_usd            REAL NOT NULL DEFAULT 0,
      error_code          TEXT,
      error_message       TEXT,
      PRIMARY KEY (run_id, prompt_id, sample_index),
      FOREIGN KEY (run_id) REFERENCES runs(run_id),
      FOREIGN KEY (prompt_id) REFERENCES prompts(prompt_id)
    );

    CREATE TABLE IF NOT EXISTS citations (
      run_id       TEXT NOT NULL,
      prompt_id    TEXT NOT NULL,
      sample_index INTEGER NOT NULL,
      brand        TEXT NOT NULL,
      matched_text TEXT NOT NULL,
      kind         TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_calls_run        ON calls(run_id);
    CREATE INDEX IF NOT EXISTS idx_calls_prompt     ON calls(prompt_id);
    CREATE INDEX IF NOT EXISTS idx_citations_brand  ON citations(brand);
    CREATE INDEX IF NOT EXISTS idx_citations_prompt ON citations(prompt_id);
    CREATE INDEX IF NOT EXISTS idx_citations_run    ON citations(run_id);
  `);
}

export function upsertPrompt(
  db: Database,
  prompt_id: string,
  prompt_text: string,
  model: string,
  provider: ProviderId,
  config_blob: string,
): void {
  db.run(
    `INSERT OR IGNORE INTO prompts (prompt_id, prompt_text, model, provider, config_blob, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [prompt_id, prompt_text, model, provider, config_blob, new Date().toISOString()],
  );
}

export function startRun(db: Database, run_id: string, config_hash: string): void {
  db.run(
    `INSERT INTO runs (run_id, started_at, finished_at, config_hash) VALUES (?, ?, NULL, ?)`,
    [run_id, new Date().toISOString(), config_hash],
  );
}

export function finishRun(db: Database, run_id: string): void {
  db.run(`UPDATE runs SET finished_at = ? WHERE run_id = ?`, [new Date().toISOString(), run_id]);
}

export function findUnfinishedRun(db: Database): { run_id: string; config_hash: string } | null {
  const row = db
    .query<{ run_id: string; config_hash: string }, []>(
      `SELECT run_id, config_hash FROM runs WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    )
    .get();
  return row ?? null;
}

export function findLatestFinishedRun(db: Database): string | null {
  const row = db
    .query<{ run_id: string }, []>(
      `SELECT run_id FROM runs WHERE finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 1`,
    )
    .get();
  return row?.run_id ?? null;
}

export function findFailedTuples(
  db: Database,
  run_id: string,
): { prompt_id: string; sample_index: number }[] {
  return db
    .query<{ prompt_id: string; sample_index: number }, [string]>(
      `SELECT prompt_id, sample_index FROM calls WHERE run_id = ? AND error_code IS NOT NULL`,
    )
    .all(run_id);
}

export function findMissingTuples(
  db: Database,
  run_id: string,
  planned: PlannedTuple[],
): PlannedTuple[] {
  if (planned.length === 0) return [];
  const existing = db
    .query<{ prompt_id: string; sample_index: number }, [string]>(
      `SELECT prompt_id, sample_index FROM calls WHERE run_id = ? AND error_code IS NULL`,
    )
    .all(run_id);
  const have = new Set(existing.map((r) => `${r.prompt_id}|${r.sample_index}`));
  return planned.filter((p) => !have.has(`${p.prompt_id}|${p.sample_index}`));
}

export function insertCall(
  db: Database,
  args: {
    run_id: string;
    prompt_id: string;
    sample_index: number;
    response_text: string;
    search_results_json: string;
    latency_ms: number;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    error_code: string | null;
    error_message: string | null;
  },
): void {
  db.run(
    `INSERT OR REPLACE INTO calls
       (run_id, prompt_id, sample_index, ts, response_text, search_results_json,
        latency_ms, tokens_in, tokens_out, cost_usd, error_code, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      args.run_id,
      args.prompt_id,
      args.sample_index,
      new Date().toISOString(),
      args.response_text,
      args.search_results_json,
      args.latency_ms,
      args.tokens_in,
      args.tokens_out,
      args.cost_usd,
      args.error_code,
      args.error_message,
    ],
  );
}

export function insertCitations(
  db: Database,
  run_id: string,
  prompt_id: string,
  sample_index: number,
  citations: Citation[],
): void {
  const stmt = db.prepare(
    `INSERT INTO citations (run_id, prompt_id, sample_index, brand, matched_text, kind)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((list: Citation[]) => {
    for (const c of list) {
      stmt.run(run_id, prompt_id, sample_index, c.brand, c.matched_text, c.kind);
    }
  });
  tx(citations);
}

export type CallRow = {
  run_id: string;
  prompt_id: string;
  sample_index: number;
  ts: string;
  response_text: string;
  search_results_json: string;
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  error_code: string | null;
  error_message: string | null;
};

export type CitationRow = {
  run_id: string;
  prompt_id: string;
  sample_index: number;
  brand: string;
  matched_text: string;
  kind: string;
};

export type PromptRow = {
  prompt_id: string;
  prompt_text: string;
  model: string;
  provider: string;
  config_blob: string;
  created_at: string;
};

export type RunRow = {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  config_hash: string;
};

export function getCallsSince(db: Database, since_iso: string): CallRow[] {
  return db
    .query<CallRow, [string]>(
      `SELECT * FROM calls WHERE ts >= ? AND error_code IS NULL ORDER BY ts`,
    )
    .all(since_iso);
}

export function getAllCallsSince(db: Database, since_iso: string): CallRow[] {
  return db
    .query<CallRow, [string]>(
      `SELECT * FROM calls WHERE ts >= ? ORDER BY ts`,
    )
    .all(since_iso);
}

export function getCitationsSince(db: Database, since_iso: string): CitationRow[] {
  return db
    .query<CitationRow, [string]>(
      `SELECT c.* FROM citations c
       JOIN calls k ON k.run_id = c.run_id AND k.prompt_id = c.prompt_id AND k.sample_index = c.sample_index
       WHERE k.ts >= ? AND k.error_code IS NULL`,
    )
    .all(since_iso);
}

export function getPrompts(db: Database, prompt_ids: string[]): PromptRow[] {
  if (prompt_ids.length === 0) return [];
  const placeholders = prompt_ids.map(() => "?").join(",");
  return db
    .query<PromptRow, string[]>(`SELECT * FROM prompts WHERE prompt_id IN (${placeholders})`)
    .all(...prompt_ids);
}

export function getRunsForCalls(db: Database, run_ids: string[]): RunRow[] {
  if (run_ids.length === 0) return [];
  const placeholders = run_ids.map(() => "?").join(",");
  return db
    .query<RunRow, string[]>(`SELECT * FROM runs WHERE run_id IN (${placeholders}) ORDER BY started_at`)
    .all(...run_ids);
}
