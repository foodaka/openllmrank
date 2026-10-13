import { NextResponse } from "next/server";
import { z } from "zod";
import { reportLinkSecret, signReportToken } from "@openllmrank/shared/report-token";
import { serviceClient } from "./supabase-server";
import { checkRateLimit, getClientIp } from "./rate-limit";
import { hashIp } from "./crawl-check";
import { provisionPaidReport } from "./report-provisioning";
import { sanitizeAcquisition } from "./acquisition";
import { escapeTelegram, notifyTelegram } from "./telegram";
import {
  normalizeWebsite,
  readWebsiteContent,
  SuggestionError,
} from "./website-suggestions";
import {
  buildSnapshotConfig,
  checkSnapshotQuota,
  completeSnapshotSuggestions,
  parseSnapshotSuggestions,
  snapshotDailyCap,
  websiteDomain,
} from "./snapshot";

// POST /api/snapshot handler — the free, no-card AI visibility snapshot.
//
//   1. validate + abuse limits (per email, per domain, per IP, global cap)
//   2. record the lead FIRST, so we keep the email even if the site can't
//      be read
//   3. read the site and draft 3 questions + competitors (gpt-4o-mini)
//   4. provision account + brand + a free job (origin='snapshot'); the
//      worker runs it like any other job
//   5. ping Telegram with the outcome
//
// Returns the signed result URL; the page polls until the run finishes.

const BodySchema = z.object({
  website: z.string().max(2048),
  email: z.string().trim().toLowerCase().email().max(320),
  acquisition: z.unknown().optional(),
});

export type SnapshotDeps = {
  supabase: () => ReturnType<typeof serviceClient>;
  readSite: (website: string) => Promise<string>;
  complete: (content: string) => Promise<unknown>;
  notify: (html: string) => Promise<boolean>;
  configured: () => boolean;
};

const defaultDeps: SnapshotDeps = {
  supabase: serviceClient,
  readSite: (website) => readWebsiteContent(website),
  complete: completeSnapshotSuggestions,
  notify: (html) => notifyTelegram(html),
  configured: () => Boolean(process.env.OPENAI_API_KEY),
};

export async function handleSnapshot(req: Request, deps: SnapshotDeps = defaultDeps): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    return json({ error: "Start your snapshot from openllmrank.io." }, 403);
  }

  const ip = getClientIp(req);
  const burst = checkRateLimit(`snapshot:${ip}`, 5, 10 * 60_000);
  if (!burst.allowed) return json({ error: "Too many tries. Wait a few minutes and try again." }, 429);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Enter your website and email." }, 400);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    const emailIssue = parsed.error.issues.some((i) => i.path[0] === "email");
    return json({ error: emailIssue ? "Enter a valid email so we can send your snapshot." : "Enter your website, such as acme.com." }, 400);
  }
  const { email } = parsed.data;

  let website: string;
  try {
    website = normalizeWebsite(parsed.data.website);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
  if (!deps.configured()) return json({ error: "Free snapshots are temporarily unavailable." }, 503);

  const domain = websiteDomain(website);
  const ipHash = hashIp(ip);
  const acquisition = sanitizeAcquisition(parsed.data.acquisition);
  const supabase = deps.supabase();

  const quota = await checkSnapshotQuota(supabase, {
    email,
    domain,
    ipHash,
    dailyCap: snapshotDailyCap(),
  });
  if (!quota.ok) {
    if (quota.reason === "daily_cap" || quota.reason === "email") {
      // Still a warm lead worth knowing about.
      await deps.notify(
        `🔒 <b>Snapshot blocked</b> (${quota.reason})\n${escapeTelegram(email)} · ${escapeTelegram(domain)}`,
      );
    }
    return json({ error: quota.message, reason: quota.reason }, 429);
  }

  // Record the lead before anything that can fail, so the email is kept.
  // config_jsonb is a placeholder until the draft exists.
  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .insert({
      email,
      brand_name: domain,
      config_jsonb: { website },
      source: "snapshot",
      status: "started",
      website_domain: domain,
      requester_ip_hash: ipHash,
    })
    .select("id")
    .single();
  if (leadErr || !lead) {
    console.error("[snapshot] lead insert failed:", leadErr?.message);
    return json({ error: "Something went wrong. Try again." }, 500);
  }

  const leadLine = `${escapeTelegram(email)} · ${escapeTelegram(domain)}\nfrom ${escapeTelegram(acquisition.source)} via ${escapeTelegram(acquisition.landing)}`;

  let config;
  try {
    const content = await deps.readSite(website);
    config = buildSnapshotConfig(website, parseSnapshotSuggestions(await deps.complete(content)));
  } catch (e) {
    const message = e instanceof SuggestionError
      ? e.message
      : "We couldn’t read your site. Try your homepage, or a page that describes your product.";
    await deps.notify(`📭 <b>Snapshot lead</b> (site unreadable)\n${leadLine}\n<i>${escapeTelegram(message)}</i>`);
    return json({ error: message }, e instanceof SuggestionError ? e.status : 503);
  }

  await supabase
    .from("leads")
    .update({
      brand_name: config.brand.name,
      competitor_count: config.competitors.length,
      prompt_count: config.prompts.length,
      config_jsonb: config,
    })
    .eq("id", lead.id);

  const provisioned = await provisionPaidReport(supabase, {
    email,
    config,
    amountCents: 0,
    source: "web",
    origin: "snapshot",
    leadId: lead.id,
  });
  if (!provisioned.ok) {
    console.error("[snapshot] provisioning failed:", "error" in provisioned ? provisioned.detail ?? provisioned.error : "duplicate");
    await deps.notify(`⚠️ <b>Snapshot lead</b> (provisioning failed)\n${leadLine}`);
    return json({ error: "Something went wrong starting your snapshot. Try again." }, 500);
  }

  await supabase
    .from("leads")
    .update({ status: "converted", job_id: provisioned.jobId, converted_at: new Date().toISOString() })
    .eq("id", lead.id);

  await deps.notify(
    `🆕 <b>Snapshot lead</b>\n${leadLine}\n<b>${escapeTelegram(config.brand.name)}</b> vs ${escapeTelegram(config.competitors.map((c) => c.name).join(", "))}`,
  );

  const token = signReportToken(provisioned.jobId, reportLinkSecret());
  return json({ url: `/snapshot/${provisioned.jobId}?t=${encodeURIComponent(token)}` });
}
