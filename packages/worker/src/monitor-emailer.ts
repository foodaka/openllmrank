// Monitor email rendering + send. One email per monitor crawl; the KIND is
// decided by packages/crawl's classifyMonitorEmail (baseline / changes /
// all_clear / still_issues / unreachable / state_note) so the honesty rules
// (no all-clear from failed/partial crawls) live in one tested place.
//
// Templates follow the report-email pattern in emailer.ts: same editorial
// tokens inlined (email clients get no external CSS).

import {
  describeFinding,
  type Finding,
  type FindingsDiff,
  type MonitorEmailKind,
} from "@openllmrank/crawl";
import { sendRawEmail, type EmailResult } from "./emailer";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const SUBJECTS: Record<MonitorEmailKind, (domain: string) => string> = {
  baseline: (d) => `Monitoring started for ${d} — your baseline crawl report`,
  changes: (d) => `⚠ Crawl health changed on ${d}`,
  all_clear: (d) => `✓ ${d}: crawled and healthy`,
  still_issues: (d) => `${d}: weekly check — known issues persist`,
  unreachable: (d) => `⚠ ${d} was unreachable during this week's crawl`,
  state_note: (d) => `${d}: weekly crawl was incomplete`,
};

function findingList(title: string, findings: Finding[]): string {
  if (findings.length === 0) return "";
  const items = findings
    .map((f) => `<li>${escapeHtml(describeFinding(f))}</li>`)
    .join("");
  return `<p><strong>${escapeHtml(title)}</strong></p><ul>${items}</ul>`;
}

export function renderMonitorEmail(args: {
  kind: MonitorEmailKind;
  domain: string;
  pagesCrawled: number;
  currentFindings: Finding[];
  diff: FindingsDiff | null;
  reportUrl: string;
  portalUrl: string;
}): { subject: string; html: string; text: string } {
  const { kind, domain, pagesCrawled, currentFindings, diff } = args;
  const headline = currentFindings.filter((f) => f.tier === "headline");

  let body = "";
  switch (kind) {
    case "baseline":
      body =
        `<p>Your first monitored crawl of <strong>${escapeHtml(domain)}</strong> is done — ${pagesCrawled} pages checked. This is your starting point; from next week we'll tell you what CHANGED.</p>` +
        (headline.length > 0
          ? findingList(`Starting with ${headline.length} crawl-path finding${headline.length === 1 ? "" : "s"}:`, headline)
          : "<p>No crawl-path findings — your crawl paths are healthy today.</p>");
      break;
    case "changes":
      body =
        `<p>This week's crawl of <strong>${escapeHtml(domain)}</strong> (${pagesCrawled} pages) found changes:</p>` +
        findingList("New problems:", diff?.appeared ?? []) +
        findingList("Resolved since last week:", diff?.resolved ?? []) +
        findingList("Still present:", diff?.ongoing ?? []);
      break;
    case "all_clear":
      body = `<p><strong>${escapeHtml(domain)}</strong> crawled clean this week — ${pagesCrawled} pages, every sitemap page reachable, no crawler locked out. Nothing changed since last week.</p>`;
      break;
    case "still_issues":
      body =
        `<p>This week's crawl of <strong>${escapeHtml(domain)}</strong> (${pagesCrawled} pages) found no NEW problems, but earlier findings are still present:</p>` +
        findingList("Still present:", headline);
      break;
    case "unreachable":
      body = `<p>Our crawler could not reach <strong>${escapeHtml(domain)}</strong> this week. If the site is up for you, it may be blocking data-center traffic — which can also hide it from AI crawlers. We'll try again next week; you can also open the report and re-check now.</p>`;
      break;
    case "state_note":
      body = `<p>This week's crawl of <strong>${escapeHtml(domain)}</strong> was incomplete (${pagesCrawled} pages before hitting a limit), so we won't claim anything appeared or resolved. The report has the partial detail.</p>`;
      break;
  }

  const subject = SUBJECTS[kind](domain);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
<style>
body{margin:0;background:#fbf8f0;color:#241f19;font-family:"DM Sans",-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.55}
.wrap{max-width:600px;margin:0 auto;padding:48px 28px}
.kicker{font-size:12px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:#376b5b}
h1{font-family:"Fraunces",Georgia,serif;font-size:30px;font-weight:500;line-height:1.1;margin:12px 0 20px;letter-spacing:-0.01em}
p{font-size:16px;color:#241f19;margin:0 0 16px}
ul{margin:0 0 16px;padding-left:20px}
li{margin-bottom:6px}
.button{display:inline-block;background:#376b5b;color:#fbf8f0;text-decoration:none;border-radius:7px;padding:14px 22px;font-weight:700;margin:10px 0 18px}
.url,.muted{word-break:break-all;font-size:13px;color:#756c60}
hr{border:0;border-top:1px solid #e3d8c6;margin:32px 0}
.sig{font-family:"Fraunces",Georgia,serif;font-style:italic;color:#756c60}
</style></head>
<body><div class="wrap">
<span class="kicker">Crawl monitoring</span>
<h1>${escapeHtml(subject)}</h1>
${body}
<p><a class="button" href="${escapeHtml(args.reportUrl)}">Open the full report</a></p>
<p class="url">${escapeHtml(args.reportUrl)}</p>
<hr>
<p class="muted">Manage or cancel your subscription any time: <a href="${escapeHtml(args.portalUrl)}">billing portal</a> (sign in with this email address).</p>
<p class="sig">— openllmrank</p>
</div></body></html>`;

  const text = `${subject}

Full report: ${args.reportUrl}

Manage or cancel: ${args.portalUrl} (sign in with this email address)

— openllmrank`;

  return { subject, html, text };
}

export async function sendMonitorEmail(args: {
  monitorId: string;
  to: string;
  rendered: { subject: string; html: string; text: string };
}): Promise<EmailResult> {
  return await sendRawEmail({
    to: args.to,
    subject: args.rendered.subject,
    htmlBody: args.rendered.html,
    textBody: args.rendered.text,
    tag: "monitor",
    refId: args.monitorId,
  });
}
