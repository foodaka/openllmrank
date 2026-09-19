import { NextResponse } from "next/server";
import { HostedConfigSchema } from "@openllmrank/shared/config";
import { renderHtmlReport } from "openllmrank/src/core/render-html";
import { PRODUCT_VERSION } from "openllmrank/src/version";
import {
  reportLinkSecret,
  verifyReportToken,
} from "@openllmrank/shared/report-token";
import { loadReportData } from "../../../lib/report-data";
import { serviceClient, userClient } from "../../../lib/supabase-server";

// Access control (E2, D6/D10). A report resolves through four paths, in order:
//
//   1. ?t=<token> valid and unexpired            -> render, no session needed
//   2. session present and job.user_id = user.id -> render
//   3. bare UUID and report_link_expires_at > now -> render (legacy grace)
//   4. otherwise                                  -> 401 "Sign in to view"
//
// Tokens are stateless HMACs (packages/shared/src/report-token.ts). The
// legacy grace exists so report emails already sitting in inboxes keep
// working for 90 days after deploy; new emails carry a token.

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
  succeeded_count: number | null;
  failed_count: number | null;
  report_link_expires_at: string | null;
};

type ReportAccess =
  | { ok: true; via: "token" | "session" | "grace" }
  | { ok: false };

async function authorizeReportAccess(args: {
  token: string | null;
  jobId: string;
  jobUserId: string;
  expiresAt: string | null;
}): Promise<ReportAccess> {
  if (args.token) {
    const claims = verifyReportToken(args.token, reportLinkSecret());
    if (claims && claims.jobId === args.jobId) return { ok: true, via: "token" };
  }

  try {
    const supabase = await userClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user && user.id === args.jobUserId) return { ok: true, via: "session" };
  } catch {
    // No cookie store (e.g. called outside a request scope): fall through.
  }

  if (args.expiresAt && new Date(args.expiresAt).getTime() > Date.now()) {
    return { ok: true, via: "grace" };
  }
  return { ok: false };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: Request, context: RouteContext): Promise<Response> {
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
    .select("id,user_id,brand_id,status,config_jsonb,cli_run_id,succeeded_at,created_at,error_message,succeeded_count,failed_count,report_link_expires_at")
    .eq("id", id)
    .single();

  if (jobErr || !job) {
    return htmlResponse(renderStatusPage({
      kicker: "Report not found",
      title: "That report link did not match a report.",
      body: "Check that the full report URL from the email was opened.",
    }), 404);
  }

  const access = await authorizeReportAccess({
    token: new URL(req.url).searchParams.get("t"),
    jobId: id,
    jobUserId: (job as JobRow).user_id,
    expiresAt: (job as JobRow).report_link_expires_at,
  });
  if (!access.ok) {
    return htmlResponse(renderStatusPage({
      kicker: "Sign in to view",
      title: "This link has expired.",
      body: "Report links from email work for 90 days. Sign in to your dashboard to read every report you own.",
      link: { href: `/login?next=${encodeURIComponent(`/reports/${id}`)}`, label: "Sign in" },
    }), 401);
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
  const {
    cfg,
    competitorNames,
    rates,
    gaps,
    callRows,
    citationRows,
    runRows,
    promptRows,
  } = await loadReportData(supabase, job);

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
    project_version: PRODUCT_VERSION,
    brand_website: cfg.brand.website,
    prompts: promptRows,
    configured_models: cfg.providers.map((provider) => ({
      provider: provider.id,
      model: provider.model,
    })),
    expected_calls: (job.succeeded_count ?? callRows.length) + (job.failed_count ?? 0),
    failed_calls: job.failed_count ?? 0,
  });
}

function htmlResponse(html: string, status = 200): Response {
  return new NextResponse(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    },
  });
}

function renderStatusPage(args: {
  kicker: string;
  title: string;
  body: string;
  refreshSeconds?: number;
  link?: { href: string; label: string };
}): string {
  const refresh = args.refreshSeconds
    ? `<meta http-equiv="refresh" content="${args.refreshSeconds}">`
    : "";
  const link = args.link
    ? `<p class="action"><a href="${escapeHtml(args.link.href)}">${escapeHtml(args.link.label)}</a></p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="referrer" content="no-referrer">
${refresh}
<title>${escapeHtml(args.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500;600&display=swap">
<style>
:root{--paper:#fbf8f0;--ink:#241f19;--muted:#756c60;--line:#e3d8c6;--accent:#376b5b}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:"DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;line-height:1.55}.wrap{max-width:680px;margin:0 auto;padding:64px 28px}.kicker{font-size:12px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:var(--accent)}h1{font-family:"Fraunces",Georgia,"Times New Roman",serif;font-weight:500;font-size:42px;line-height:1.04;margin:12px 0 20px}p{font-size:17px;color:var(--muted);margin:0}.action{margin-top:28px}.action a{display:inline-block;background:var(--accent);color:#fff;padding:14px 22px;text-decoration:none;border-radius:6px;font-weight:600}
</style>
</head>
<body><main class="wrap">
<span class="kicker">${escapeHtml(args.kicker)}</span>
<h1>${escapeHtml(args.title)}</h1>
<p>${escapeHtml(args.body)}</p>
${link}
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
