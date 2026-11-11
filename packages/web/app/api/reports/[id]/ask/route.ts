import { z } from "zod";
import { authorizeReportAccess, REPORT_ID_RE } from "../../../../../lib/report-access";
import {
  askReport,
  buildChatContext,
  reportChatModel,
  ReportChatError,
} from "../../../../../lib/report-chat";
import { loadReportData, loadRunMetrics } from "../../../../../lib/report-data";
import { checkRateLimit, getClientIp } from "../../../../../lib/rate-limit";
import { serviceClient } from "../../../../../lib/supabase-server";

// POST /api/reports/[id]/ask — ask a question about one completed report.
//
// Same readers as the report page (lib/report-access.ts): a valid signed
// link, the owner's session, or the legacy grace window. The signed link
// can be forwarded, so questions are capped per report per day (counted in
// report_questions, which survives restarts and instances) and per IP.
//
// Response: NDJSON, one event per line:
//   {"type":"delta","text":"..."}   streamed answer text
//   {"type":"done","remaining":N}   answer finished and saved
//   {"type":"error","message":"..."} the model failed mid-answer
// Errors before streaming starts are plain JSON with an HTTP status.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_DAILY_LIMIT = 30;
const IP_LIMIT_PER_MINUTE = 8;

const AskInput = z.object({
  question: z.string().trim().min(1).max(1000),
  token: z.string().max(512).nullish(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(6000) }))
    .max(12)
    .default([]),
});

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type JobRow = {
  id: string;
  user_id: string;
  status: string;
  origin?: string | null;
  config_jsonb: unknown;
  cli_run_id: string | null;
  failed_count: number | null;
  report_link_expires_at: string | null;
};

function dailyQuestionLimit(): number {
  const raw = Number(process.env.REPORT_CHAT_DAILY_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DAILY_LIMIT;
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  if (!REPORT_ID_RE.test(id)) return json({ error: "Report not found." }, 404);

  let input: z.infer<typeof AskInput>;
  try {
    input = AskInput.parse(await req.json());
  } catch {
    return json({ error: "Send a question between 1 and 1000 characters." }, 400);
  }

  const supabase = serviceClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id,user_id,status,origin,config_jsonb,cli_run_id,failed_count,report_link_expires_at")
    .eq("id", id)
    .maybeSingle();
  if (!job) return json({ error: "Report not found." }, 404);
  const jobRow = job as JobRow;

  const access = await authorizeReportAccess({
    token: input.token ?? null,
    jobId: id,
    jobUserId: jobRow.user_id,
    expiresAt: jobRow.report_link_expires_at,
  });
  if (!access.ok) return json({ error: "This link has expired. Sign in to ask about this report." }, 401);

  // A free snapshot shows only part of its run; the chat would reveal the rest.
  if (jobRow.origin === "snapshot") return json({ error: "Questions are available on full reports." }, 403);
  if (jobRow.status !== "completed" || !jobRow.cli_run_id) {
    return json({ error: "This report is still being generated." }, 409);
  }

  if (!process.env.OPENAI_API_KEY) return json({ error: "Questions are not available right now." }, 503);

  const ip = checkRateLimit(`report-ask:${getClientIp(req)}`, IP_LIMIT_PER_MINUTE, 60_000);
  if (!ip.allowed) return json({ error: "Too many questions at once. Wait a minute and try again." }, 429);

  const limit = dailyQuestionLimit();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count, error: countErr } = await supabase
    .from("report_questions")
    .select("id", { count: "exact", head: true })
    .eq("job_id", id)
    .gte("created_at", since);
  if (countErr) {
    console.error("[report-ask] quota read failed", { job_id: id, message: countErr.message });
    return json({ error: "Questions are not available right now." }, 503);
  }
  const used = count ?? 0;
  if (used >= limit) {
    return json({ error: `This report has reached its ${limit} questions for today. Try again tomorrow.` }, 429);
  }

  let ctx: ReturnType<typeof buildChatContext>;
  try {
    const data = await loadReportData(supabase, jobRow);
    const metrics = await loadRunMetrics(supabase, id);
    ctx = buildChatContext({ data, metrics, failedCalls: jobRow.failed_count ?? 0 });
  } catch (e) {
    console.error("[report-ask] report load failed", { job_id: id, message: (e as Error).message });
    return json({ error: "We could not load this report." }, 500);
  }

  const model = reportChatModel();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of askReport({
          ctx,
          history: input.history,
          question: input.question,
          model,
        })) {
          if (event.type === "delta") {
            send(event);
            continue;
          }
          const { error } = await supabase.from("report_questions").insert({
            job_id: id,
            user_id: jobRow.user_id,
            question: input.question,
            answer: event.answer,
            access_via: access.via,
            model,
            tokens_in: event.usage.tokens_in,
            tokens_out: event.usage.tokens_out,
            tool_calls: event.usage.tool_calls,
          });
          if (error) console.error("[report-ask] save failed", { job_id: id, message: error.message });
          send({ type: "done", remaining: Math.max(0, limit - used - 1) });
        }
      } catch (e) {
        const message = e instanceof ReportChatError ? e.message : (e as Error).message;
        console.error("[report-ask] answer failed", { job_id: id, message });
        send({ type: "error", message: "The answer failed partway. Try asking again." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
