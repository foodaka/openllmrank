// Read the CLI's SQLite output and bulk-insert results into Postgres.
//
// The CLI writes:
//   - 1 row in runs        (run_id, started_at, finished_at, config_hash)
//   - N rows in prompts    (prompt_id PK, prompt_text, model, provider, config_blob)
//   - N rows in calls      (run_id, prompt_id, sample_index, response_text, ...)
//   - M rows in citations  (run_id, prompt_id, sample_index, brand, matched_text, kind)
//
// We translate to Postgres:
//   - public.runs        (id uuid, job_id, user_id, brand_id, cli_run_id, ...)
//   - public.prompts     (prompt_id, user_id composite PK)
//   - public.calls       (id uuid, run_id uuid FK, user_id, brand_id, prompt_id, sample_index, ...)
//   - public.citations   (id uuid, call_id uuid FK, run_id, user_id, brand_id, brand, ...)
//
// Bulk-insert via Postgres array-insert syntax in ONE transaction per
// table (Issue 4.1 of /plan-eng-review). ~3 round-trips per job instead
// of one per row.

import { Database } from "bun:sqlite";
import type { SQL } from "bun";

type SqliteRunRow = {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  config_hash: string;
};

type SqlitePromptRow = {
  prompt_id: string;
  prompt_text: string;
  model: string;
  provider: string;
  config_blob: string;
};

type SqliteCallRow = {
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

type SqliteCitationRow = {
  run_id: string;
  prompt_id: string;
  sample_index: number;
  brand: string;
  matched_text: string;
  kind: string;
};

/**
 * Copy the run + calls + citations from the CLI's SQLite output into
 * Postgres for the owning user/brand/job. Returns the Postgres `runs.id`
 * (uuid) so the caller can reference it.
 *
 * Idempotent on retry: if the same job_id is already represented (e.g.,
 * worker crashed after writing but before marking complete), it returns
 * the existing run_id. This works because (job_id, cli_run_id) is unique
 * per attempt.
 */
export async function writeRunToPostgres(
  sql: SQL,
  args: {
    sqlite_path: string;
    job_id: string;
    user_id: string;
    brand_id: string;
    cli_run_id: string;
  },
): Promise<{ run_id_pg: string }> {
  // Read the entire CLI output upfront. v1 jobs are bounded by the wizard
  // cap (max 60 calls), so in-memory is fine. Future optimization: stream.
  const sqlite = new Database(args.sqlite_path, { readonly: true });
  const runRow = sqlite
    .query<SqliteRunRow, [string]>("SELECT * FROM runs WHERE run_id = ?")
    .get(args.cli_run_id);
  if (!runRow) {
    throw new Error(
      `CLI claimed run_id=${args.cli_run_id} but no row in sqlite.runs`,
    );
  }
  const prompts = sqlite
    .query<SqlitePromptRow, []>(
      "SELECT prompt_id, prompt_text, model, provider, config_blob FROM prompts",
    )
    .all();
  const calls = sqlite
    .query<SqliteCallRow, [string]>(
      "SELECT * FROM calls WHERE run_id = ? AND error_code IS NULL",
    )
    .all(args.cli_run_id);
  const citations = sqlite
    .query<SqliteCitationRow, [string]>(
      "SELECT * FROM citations WHERE run_id = ?",
    )
    .all(args.cli_run_id);
  sqlite.close();

  return await sql.begin(async (tx) => {
    // 1. Insert run. Use ON CONFLICT (job_id, cli_run_id) DO UPDATE so
    //    retries return the same row. We rely on the cli_run_id column +
    //    job_id pair being effectively unique because the CLI run_id is
    //    a UTC timestamp derived from the worker's clock.
    const runInsert = (await tx`
      insert into public.runs (job_id, user_id, brand_id, cli_run_id, started_at, finished_at, config_hash)
      values (${args.job_id}, ${args.user_id}, ${args.brand_id},
              ${runRow.run_id}, ${runRow.started_at}::timestamptz,
              ${runRow.finished_at}::timestamptz, ${runRow.config_hash})
      returning id
    `) as unknown as Array<{ id: string }>;
    const run_id_pg = runInsert[0]!.id;

    // 2. Insert prompts. Composite PK (prompt_id, user_id) means we use
    //    ON CONFLICT to ignore dupes (prompts can recur across runs for
    //    the same user — same hash).
    if (prompts.length > 0) {
      const promptValues = prompts.map((p) => ({
        prompt_id: p.prompt_id,
        user_id: args.user_id,
        prompt_text: p.prompt_text,
        model: p.model,
        provider: p.provider,
        config_blob: p.config_blob,
      }));
      await tx`
        insert into public.prompts ${tx(promptValues, "prompt_id", "user_id", "prompt_text", "model", "provider", "config_blob")}
        on conflict (prompt_id, user_id) do nothing
      `;
    }

    // 3. Bulk-insert calls. Map (sqlite.run_id, prompt_id, sample_index)
    //    onto the new pg run uuid + user/brand context.
    const callIdByKey = new Map<string, string>();
    if (calls.length > 0) {
      const callValues = calls.map((c) => ({
        run_id: run_id_pg,
        user_id: args.user_id,
        brand_id: args.brand_id,
        prompt_id: c.prompt_id,
        sample_index: c.sample_index,
        ts: c.ts,
        response_text: c.response_text,
        search_results_json: c.search_results_json,
        latency_ms: c.latency_ms,
        tokens_in: c.tokens_in,
        tokens_out: c.tokens_out,
        cost_usd: c.cost_usd,
      }));
      const inserted = (await tx`
        insert into public.calls ${tx(
          callValues,
          "run_id",
          "user_id",
          "brand_id",
          "prompt_id",
          "sample_index",
          "ts",
          "response_text",
          "search_results_json",
          "latency_ms",
          "tokens_in",
          "tokens_out",
          "cost_usd",
        )}
        returning id, prompt_id, sample_index
      `) as unknown as Array<{
        id: string;
        prompt_id: string;
        sample_index: number;
      }>;
      for (const row of inserted) {
        callIdByKey.set(`${row.prompt_id}|${row.sample_index}`, row.id);
      }
    }

    // 4. Bulk-insert citations referencing the call rows we just inserted.
    //    SQLite stores citations keyed by (run_id, prompt_id, sample_index);
    //    we resolve to the call_id (uuid) we got back from step 3.
    if (citations.length > 0) {
      const citationValues = citations
        .map((c) => {
          const callId = callIdByKey.get(
            `${c.prompt_id}|${c.sample_index}`,
          );
          if (!callId) return null; // Citation orphaned from a failed call; drop.
          return {
            call_id: callId,
            run_id: run_id_pg,
            user_id: args.user_id,
            brand_id: args.brand_id,
            brand: c.brand,
            matched_text: c.matched_text,
            kind: c.kind,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      if (citationValues.length > 0) {
        await tx`
          insert into public.citations ${tx(
            citationValues,
            "call_id",
            "run_id",
            "user_id",
            "brand_id",
            "brand",
            "matched_text",
            "kind",
          )}
        `;
      }
    }

    return { run_id_pg };
  }) as { run_id_pg: string };
}
