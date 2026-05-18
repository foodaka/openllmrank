// Email sending via Postmark, with a local_stub mode that writes the email
// HTML to ./outbox/<id>.html so you can preview it in a browser without a
// Postmark account.
//
// Two emails fire per successful job:
//   1. order-received — sent right after the webhook flips status='paid',
//                       so the customer has confirmation while the worker
//                       generates the report. Short, plain note.
//   2. report          — sent after the run completes, containing the full
//                       HTML report rendered by packages/cli's
//                       render-html.ts as the email body.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as postmark from "postmark";
import { env, isPostmarkStub } from "./env";

export type EmailResult =
  | { ok: true; message_id: string; mode: "local_stub" | "live" }
  | { ok: false; code: string; message: string };

const OUTBOX_DIR = resolve(import.meta.dir, "..", "outbox");

let _client: postmark.ServerClient | null = null;
function client(): postmark.ServerClient {
  if (_client) return _client;
  if (!env.postmarkToken) {
    throw new Error("POSTMARK_SERVER_TOKEN required when POSTMARK_MODE=live");
  }
  _client = new postmark.ServerClient(env.postmarkToken);
  return _client;
}

async function sendOrStub(args: {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  tag: "order-received" | "report" | "refund";
  jobId: string;
}): Promise<EmailResult> {
  if (isPostmarkStub()) {
    try {
      mkdirSync(OUTBOX_DIR, { recursive: true });
      const filename = `${Date.now()}-${args.tag}-${args.jobId}.html`;
      const path = resolve(OUTBOX_DIR, filename);
      const header = `<!--
  STUB EMAIL (not actually sent)
  to:      ${args.to}
  from:    ${env.postmarkFrom}
  subject: ${args.subject}
  tag:     ${args.tag}
  job:     ${args.jobId}
-->`;
      writeFileSync(path, header + "\n" + args.htmlBody, "utf8");
      console.log(`[postmark stub] wrote ${path}`);
      return { ok: true, message_id: `stub_${args.jobId}_${args.tag}`, mode: "local_stub" };
    } catch (e) {
      return {
        ok: false,
        code: "STUB_WRITE_FAILED",
        message: (e as Error).message,
      };
    }
  }

  try {
    const response = await client().sendEmail({
      From: `${env.postmarkFromName} <${env.postmarkFrom}>`,
      To: args.to,
      Subject: args.subject,
      HtmlBody: args.htmlBody,
      TextBody: args.textBody ?? "",
      Tag: args.tag,
      MessageStream: "outbound",
      Metadata: { job_id: args.jobId },
    });
    return {
      ok: true,
      message_id: response.MessageID,
      mode: "live",
    };
  } catch (e) {
    const err = e as { code?: number; message?: string };
    return {
      ok: false,
      code: err.code !== undefined ? `POSTMARK_${err.code}` : "POSTMARK_UNKNOWN",
      message: err.message ?? String(e),
    };
  }
}

// --- order-received template -------------------------------------------------

export function renderOrderReceivedHtml(args: {
  brand_name: string;
  competitor_count: number;
  prompt_count: number;
  email: string;
}): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your openllmrank report is being generated</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500;600&display=swap">
<style>
body{margin:0;background:#fbf8f0;color:#241f19;font-family:"DM Sans",-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.55}
.wrap{max-width:560px;margin:0 auto;padding:48px 28px}
.kicker{font-size:12px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:#376b5b}
h1{font-family:"Fraunces",Georgia,serif;font-size:36px;font-weight:500;line-height:1.05;margin:12px 0 24px;letter-spacing:-0.01em}
p{font-size:16px;color:#241f19;margin:0 0 16px}
.muted{color:#756c60}
.summary{background:#f2eadc;border:1px solid #e3d8c6;border-radius:7px;padding:20px;margin:24px 0;font-size:15px}
.summary dt{font-size:11px;text-transform:uppercase;letter-spacing:.11em;color:#756c60;margin-top:8px}
.summary dt:first-child{margin-top:0}
.summary dd{margin:2px 0 0 0;font-weight:500}
hr{border:0;border-top:1px solid #e3d8c6;margin:32px 0}
.sig{font-family:"Fraunces",Georgia,serif;font-style:italic;color:#756c60}
</style></head>
<body><div class="wrap">
<span class="kicker">Order received</span>
<h1>Your report is being generated.</h1>
<p>Thanks for your order. We're now asking ChatGPT and Claude the questions you gave us, watching what they recommend, and compiling your visibility report.</p>
<dl class="summary">
<dt>Brand</dt><dd>${args.brand_name}</dd>
<dt>Competitors tracked</dt><dd>${args.competitor_count}</dd>
<dt>Prompts</dt><dd>${args.prompt_count}</dd>
<dt>Estimated time</dt><dd>10–15 minutes</dd>
</dl>
<p>Your report will land in this inbox (<span class="muted">${args.email}</span>) when it's ready.</p>
<hr>
<p class="sig">— openllmrank</p>
</div></body></html>`;
}

export function renderOrderReceivedText(args: {
  brand_name: string;
  competitor_count: number;
  prompt_count: number;
}): string {
  return `Your openllmrank report is being generated.

Thanks for your order. We're now asking ChatGPT and Claude the questions
you gave us and compiling your visibility report.

Brand: ${args.brand_name}
Competitors tracked: ${args.competitor_count}
Prompts: ${args.prompt_count}
Estimated time: 10-15 minutes

Your report will land in your inbox when it's ready.

— openllmrank`;
}

export async function sendOrderReceived(args: {
  jobId: string;
  to: string;
  brand_name: string;
  competitor_count: number;
  prompt_count: number;
}): Promise<EmailResult> {
  return await sendOrStub({
    to: args.to,
    subject: `Your openllmrank report for ${args.brand_name} is being generated`,
    htmlBody: renderOrderReceivedHtml({
      brand_name: args.brand_name,
      competitor_count: args.competitor_count,
      prompt_count: args.prompt_count,
      email: args.to,
    }),
    textBody: renderOrderReceivedText({
      brand_name: args.brand_name,
      competitor_count: args.competitor_count,
      prompt_count: args.prompt_count,
    }),
    tag: "order-received",
    jobId: args.jobId,
  });
}

// --- report template ---------------------------------------------------------

export async function sendReport(args: {
  jobId: string;
  to: string;
  brand_name: string;
  htmlBody: string; // pre-rendered by packages/cli's render-html.ts
}): Promise<EmailResult> {
  return await sendOrStub({
    to: args.to,
    subject: `Your openllmrank visibility report for ${args.brand_name}`,
    htmlBody: args.htmlBody,
    tag: "report",
    jobId: args.jobId,
  });
}

// --- refund-notification template -------------------------------------------

export function renderRefundHtml(args: {
  brand_name: string;
  amount_cents: number;
  currency: string;
  error_message: string;
}): string {
  const amount = (args.amount_cents / 100).toFixed(2);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>openllmrank: your order has been refunded</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=DM+Sans:wght@400;500&display=swap">
<style>
body{margin:0;background:#fbf8f0;color:#241f19;font-family:"DM Sans",-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.55}
.wrap{max-width:560px;margin:0 auto;padding:48px 28px}
.kicker{font-size:12px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:#9f3a21}
h1{font-family:"Fraunces",Georgia,serif;font-size:32px;font-weight:500;line-height:1.05;margin:12px 0 24px;letter-spacing:-0.01em}
p{font-size:16px;margin:0 0 16px}
.muted{color:#756c60;font-size:14px}
hr{border:0;border-top:1px solid #e3d8c6;margin:32px 0}
.sig{font-family:"Fraunces",Georgia,serif;font-style:italic;color:#756c60}
</style></head>
<body><div class="wrap">
<span class="kicker">Refund processed</span>
<h1>We couldn't generate your report.</h1>
<p>Something went wrong while running your openllmrank order for <strong>${args.brand_name}</strong>. We've refunded the full $${amount} ${args.currency.toUpperCase()} to your card. It should appear within 5-10 business days.</p>
<p>If you'd like to try again, reply to this email and we'll look into what happened.</p>
<p class="muted">Technical detail: ${args.error_message}</p>
<hr>
<p class="sig">— openllmrank</p>
</div></body></html>`;
}

export async function sendRefundNotice(args: {
  jobId: string;
  to: string;
  brand_name: string;
  amount_cents: number;
  currency: string;
  error_message: string;
}): Promise<EmailResult> {
  return await sendOrStub({
    to: args.to,
    subject: `openllmrank: your order for ${args.brand_name} has been refunded`,
    htmlBody: renderRefundHtml({
      brand_name: args.brand_name,
      amount_cents: args.amount_cents,
      currency: args.currency,
      error_message: args.error_message,
    }),
    tag: "refund",
    jobId: args.jobId,
  });
}
