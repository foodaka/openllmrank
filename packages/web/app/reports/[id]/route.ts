import { NextResponse } from "next/server";
import { HostedConfigSchema } from "@openllmrank/shared/config";
import type {
  CallRow,
  CitationRow,
  PromptRow,
  RunRow,
} from "openllmrank/src/core/db";
import { computeGap, computeRates } from "openllmrank/src/core/gap";
import { renderHtmlReport } from "openllmrank/src/core/render-html";
import { serviceClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type JobRow = {
  id: string;
  user_id: string;
  brand_id: string;
  status: string;
  config_jsonb: unknown;
  cli_run_id: string | null;
  succeeded_at: string | null;
  created_at: string;
  error_message: string | null;
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return htmlResponse(renderStatusPage({
      kicker: "Report not found",
      title: "That report link is not valid.",
      body: "Check that the full report URL from the email was opened.",
    }), 404);
  }

  const supabase = serviceClient();
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id,user_id,brand_id,status,config_jsonb,cli_run_id,succeeded_at,created_at,error_message")
    .eq("id", id)
    .single();

  if (jobErr || !job) {
    return htmlResponse(renderStatusPage({
      kicker: "Report not found",
      title: "That report link did not match a report.",
      body: "Check that the full report URL from the email was opened.",
    }), 404);
  }

  const parsedConfig = HostedConfigSchema.safeParse((job as JobRow).config_jsonb);
  if (!parsedConfig.success) {
    return htmlResponse(renderStatusPage({
      kicker: "Report unavailable",
      title: "We could not read this report configuration.",
      body: "Reply to your report email and we will look into it.",
    }), 500);
  }

  const jobRow = job as JobRow;
  const brandName = parsedConfig.data.brand.name;

  if (jobRow.status === "failed") {
    return htmlResponse(renderStatusPage({
      kicker: "Report failed",
      title: `We could not generate the ${brandName} report.`,
      body: "The order should be refunded automatically. Reply to your email if you want us to investigate.",
    }), 500);
  }

  if (jobRow.status !== "completed" || !jobRow.cli_run_id) {
    return htmlResponse(renderStatusPage({
      kicker: "Report processing",
      title: `The ${brandName} report is still being generated.`,
      body: "This page will work as soon as the run completes. Most reports are ready within 10-15 minutes.",
      refreshSeconds: 30,
    }), 202);
  }

  try {
    const report = await renderReportForJob(supabase, jobRow, brandName);
    return htmlResponse(report);
  } catch (e) {
    console.error("[report-page] render failed", {
      job_id: jobRow.id,
      message: (e as Error).message,
    });
    return htmlResponse(renderStatusPage({
      kicker: "Report unavailable",
      title: "We could not render this report.",
      body: "Reply to your report email and we will look into it.",
    }), 500);
  }
}

async function renderReportForJob(
  supabase: ReturnType<typeof serviceClient>,
  job: JobRow,
  brandName: string,
): Promise<string> {
  const cfg = HostedConfigSchema.parse(job.config_jsonb);
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

  return renderHtmlReport({
    brand_name: brandName,
    competitor_names: competitorNames,
    rates,
    gaps,
    calls: callRows,
    citations: citationRows,
    runs: runRows,
    since_iso: job.succeeded_at ?? job.created_at,
    generated_at: new Date().toISOString(),
    project_version: "0.3.0",
  });
}

function htmlResponse(html: string, status = 200): Response {
  return new NextResponse(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function renderStatusPage(args: {
  kicker: string;
  title: string;
  body: string;
  refreshSeconds?: number;
}): string {
  const refresh = args.refreshSeconds
    ? `<meta http-equiv="refresh" content="${args.refreshSeconds}">`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh}
<title>${escapeHtml(args.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500;600&display=swap">
<style>
:root{--paper:#fbf8f0;--ink:#241f19;--muted:#756c60;--line:#e3d8c6;--accent:#376b5b}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:"DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;line-height:1.55}.wrap{max-width:680px;margin:0 auto;padding:64px 28px}.kicker{font-size:12px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:var(--accent)}h1{font-family:"Fraunces",Georgia,"Times New Roman",serif;font-weight:500;font-size:42px;line-height:1.04;margin:12px 0 20px}p{font-size:17px;color:var(--muted);margin:0}
</style>
</head>
<body><main class="wrap">
<span class="kicker">${escapeHtml(args.kicker)}</span>
<h1>${escapeHtml(args.title)}</h1>
<p>${escapeHtml(args.body)}</p>
</main></body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
