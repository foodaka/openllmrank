import { HostedConfigSchema, type HostedConfig } from "@openllmrank/shared/config";
import type {
  CallRow,
  CitationRow,
  PromptRow,
  RunRow,
} from "openllmrank/src/core/db";
import {
  computeGap,
  computeRates,
  type CitationRate,
  type GapRow,
} from "openllmrank/src/core/gap";
import type { serviceClient } from "./supabase-server";

// Loads one completed job's run out of Postgres and shapes it like the CLI's
// SQLite rows, so the CLI's own computeRates / computeGap / renderHtmlReport
// work on hosted data. Shared by the HTML report page and the agent-facing
// JSON report (lib/agent-report.ts): one loader, two renderings.
//
// Uses the service client. Callers authorize BEFORE calling this.

export type ReportJob = {
  id: string;
  user_id: string;
  config_jsonb: unknown;
  cli_run_id: string | null;
};

export type ReportData = {
  cfg: HostedConfig;
  brandName: string;
  competitorNames: string[];
  runRows: RunRow[];
  callRows: CallRow[];
  promptRows: PromptRow[];
  citationRows: CitationRow[];
  rates: CitationRate[];
  gaps: GapRow[];
};

type PgRunRow = {
  id: string;
  cli_run_id: string;
  started_at: string;
  finished_at: string | null;
  config_hash: string;
};

type PgCallRow = {
  id: string;
  run_id: string;
  prompt_id: string;
  sample_index: number;
  ts: string;
  response_text: string;
  search_results_json: unknown;
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: string | number;
  error_code: string | null;
  error_message: string | null;
};

type PgCitationRow = {
  call_id: string;
  run_id: string;
  brand: string;
  matched_text: string;
  kind: string;
};

export async function loadReportData(
  supabase: ReturnType<typeof serviceClient>,
  job: ReportJob,
): Promise<ReportData> {
  const cfg = HostedConfigSchema.parse(job.config_jsonb);
  const brandName = cfg.brand.name;
  const competitorNames = cfg.competitors.map((c) => c.name);

  const { data: pgRuns, error: runsErr } = await supabase
    .from("runs")
    .select("id,cli_run_id,started_at,finished_at,config_hash")
    .eq("job_id", job.id)
    .eq("cli_run_id", job.cli_run_id)
    .order("started_at", { ascending: true });
  if (runsErr) throw new Error(`runs: ${runsErr.message}`);

  const runs = (pgRuns ?? []) as PgRunRow[];
  if (runs.length === 0) throw new Error("run rows missing");

  const cliRunByPgRun = new Map(runs.map((run) => [run.id, run.cli_run_id]));
  const pgRunIds = runs.map((run) => run.id);
  const runRows: RunRow[] = runs.map((run) => ({
    run_id: run.cli_run_id,
    started_at: run.started_at,
    finished_at: run.finished_at,
    config_hash: run.config_hash,
  }));

  const { data: pgCalls, error: callsErr } = await supabase
    .from("calls")
    .select("id,run_id,prompt_id,sample_index,ts,response_text,search_results_json,latency_ms,tokens_in,tokens_out,cost_usd,error_code,error_message")
    .eq("user_id", job.user_id)
    .in("run_id", pgRunIds);
  if (callsErr) throw new Error(`calls: ${callsErr.message}`);

  const callRows = ((pgCalls ?? []) as PgCallRow[]).map((call): CallRow => ({
    run_id: cliRunByPgRun.get(call.run_id) ?? call.run_id,
    prompt_id: call.prompt_id,
    sample_index: call.sample_index,
    ts: call.ts,
    response_text: call.response_text,
    search_results_json:
      typeof call.search_results_json === "string"
        ? call.search_results_json
        : JSON.stringify(call.search_results_json ?? []),
    latency_ms: Number(call.latency_ms),
    tokens_in: Number(call.tokens_in),
    tokens_out: Number(call.tokens_out),
    cost_usd: Number(call.cost_usd),
    error_code: call.error_code,
    error_message: call.error_message,
  }));

  const promptIds = Array.from(new Set(callRows.map((call) => call.prompt_id)));
  let promptRows: PromptRow[] = [];
  if (promptIds.length > 0) {
    const { data: prompts, error: promptsErr } = await supabase
      .from("prompts")
      .select("prompt_id,prompt_text,model,provider,config_blob,created_at")
      .eq("user_id", job.user_id)
      .in("prompt_id", promptIds);
    if (promptsErr) throw new Error(`prompts: ${promptsErr.message}`);
    promptRows = (prompts ?? []) as PromptRow[];
  }

  const pgCallById = new Map(
    ((pgCalls ?? []) as PgCallRow[]).map((call) => [
      call.id,
      {
        prompt_id: call.prompt_id,
        sample_index: call.sample_index,
        run_id: cliRunByPgRun.get(call.run_id) ?? call.run_id,
      },
    ]),
  );

  const { data: pgCitations, error: citationsErr } = await supabase
    .from("citations")
    .select("call_id,run_id,brand,matched_text,kind")
    .eq("user_id", job.user_id)
    .in("run_id", pgRunIds);
  if (citationsErr) throw new Error(`citations: ${citationsErr.message}`);

  const citationRows = ((pgCitations ?? []) as PgCitationRow[])
    .map((citation): CitationRow | null => {
      const call = pgCallById.get(citation.call_id);
      if (!call) return null;
      return {
        run_id: call.run_id,
        prompt_id: call.prompt_id,
        sample_index: call.sample_index,
        brand: citation.brand,
        matched_text: citation.matched_text,
        kind: citation.kind,
      };
    })
    .filter((row): row is CitationRow => row !== null);

  const rates = computeRates(callRows, citationRows, promptRows, [
    brandName,
    ...competitorNames,
  ]);
  const gaps = computeGap(rates, brandName, competitorNames);

  return {
    cfg,
    brandName,
    competitorNames,
    runRows,
    callRows,
    promptRows,
    citationRows,
    rates,
    gaps,
  };
}
