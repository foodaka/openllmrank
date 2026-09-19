import { ServerClient as PostmarkClient } from "postmark";
import type { HostedConfig } from "@openllmrank/shared/config";
import { sendAccountInviteEmail } from "./account-invite";
import type { serviceClient } from "./supabase-server";

// Post-payment provisioning for a one-off report: account -> brand -> job
// with status='paid' -> confirmation emails. Every surface that takes a
// one-off payment calls this once the money is confirmed:
//
//   Stripe webhook   checkout.session.completed (wizard Checkout)
//   MCP connector    a PaymentIntent confirmed with a Shared Payment Token
//
// Nothing here talks to Stripe. The caller proves payment and passes the
// Stripe ids, which double as the duplicate-delivery backstop (both columns
// are unique on public.jobs).

type ServiceClient = ReturnType<typeof serviceClient>;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export async function findOrCreateAuthUser(
  supabase: ServiceClient,
  rawEmail: string,
): Promise<
  | { ok: true; userId: string; created: boolean }
  | { ok: false; detail: string }
> {
  // Normalize to lowercase so Alice@x.com and alice@x.com map to the same
  // auth.users row. Without this, listUsers.find compares lowercased while
  // createUser is case-sensitive, producing duplicate accounts on second
  // checkout. (P0 finding from /review on 2026-05-18.)
  const email = rawEmail.trim().toLowerCase();

  // Try create first.
  const { data: created, error: createErr } =
    await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { source: "checkout" },
    });
  if (created?.user) {
    return { ok: true, userId: created.user.id, created: true };
  }

  // Email exists or createUser failed — page through listUsers.
  for (let page = 1; page <= 10; page++) {
    const { data: list, error: listErr } =
      await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (listErr) break;
    const match = list.users.find(
      (u) => u.email?.toLowerCase() === email,
    );
    if (match) return { ok: true, userId: match.id, created: false };
    if (list.users.length < 200) break; // last page
  }

  return {
    ok: false,
    detail:
      createErr?.message ??
      "createUser failed and email not found in listUsers",
  };
}

// Fire-and-log "your report is being generated" email. Best-effort —
// failures get logged but don't block the webhook response (Stripe gets
// 200 either way; if email genuinely matters, the email-retry worker
// loop covers the final report email). The order-received email is short
// enough that we render inline here rather than going through the worker
// outbox. (Wiring fix from /review on 2026-05-18 — function existed in
// the worker but was never called.)
export async function sendOrderReceivedEmail(args: {
  to: string;
  brandName: string;
  competitorCount: number;
  promptCount: number;
}): Promise<void> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const postmarkMode = process.env.POSTMARK_MODE ?? "local_stub";
  if (postmarkMode === "local_stub" || !token) {
    console.log(
      `[order-received stub] to=${args.to} brand=${args.brandName} (POSTMARK_MODE=${postmarkMode})`,
    );
    return;
  }
  try {
    const brandName = escapeHtml(args.brandName);
    const client = new PostmarkClient(token);
    const fromAddr = process.env.POSTMARK_FROM ?? "reports@openllmrank.io";
    const fromName = process.env.POSTMARK_FROM_NAME ?? "openllmrank";
    await client.sendEmail({
      From: `${fromName} <${fromAddr}>`,
      To: args.to,
      Subject: `Your openllmrank report for ${singleLine(args.brandName)} is being generated`,
      HtmlBody: `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#fbf8f0;color:#241f19;padding:48px 24px;max-width:560px;margin:0 auto">
<p style="font-size:12px;letter-spacing:.11em;text-transform:uppercase;color:#376b5b;font-weight:700">Order received</p>
<h1 style="font-family:Georgia,serif;font-size:32px;line-height:1.05;margin:12px 0 24px;font-weight:500">Your report is being generated.</h1>
<p>Thanks for your order. We're now querying five grounded AI providers with the questions you gave us about <strong>${brandName}</strong> (${args.competitorCount} competitors, ${args.promptCount} prompts).</p>
<p>Estimated time: 10-15 minutes. Your report will land in this inbox when it's ready.</p>
<p style="font-family:Georgia,serif;font-style:italic;color:#756c60;margin-top:32px">— openllmrank</p>
</body></html>`,
      MessageStream: "outbound",
      Tag: "order-received",
    });
  } catch (e) {
    // Best-effort. Don't fail the webhook over an email send.
    console.error("[order-received] postmark send failed:", (e as Error).message);
  }
}

export const DEFAULT_REPORT_PRICE_CENTS = 7900;

/** Price of a one-off report, in cents. One definition for every surface. */
export function reportPriceCents(): number {
  const parsed = Number.parseInt(process.env.PRICE_CENTS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_REPORT_PRICE_CENTS;
}

export type ProvisionPaidReportInput = {
  email: string;
  config: HostedConfig;
  amountCents: number;
  /** Surface that took the order: 'web' | 'mcp'. Stored on jobs.source. */
  source: string;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
};

export type ProvisionPaidReportResult =
  | { ok: true; jobId: string; userId: string; brandId: string }
  | { ok: false; duplicate: true }
  | { ok: false; duplicate?: false; error: string; detail?: string };

export async function provisionPaidReport(
  supabase: ServiceClient,
  input: ProvisionPaidReportInput,
): Promise<ProvisionPaidReportResult> {
  const { config } = input;

  // 1. Provision auth user (or fetch existing).
  const userResult = await findOrCreateAuthUser(supabase, input.email);
  if (!userResult.ok) {
    return { ok: false, error: "Could not provision account", detail: userResult.detail };
  }
  const userId = userResult.userId;

  // 2. Insert the brand.
  const { data: brand, error: brandErr } = await supabase
    .from("brands")
    .insert({
      user_id: userId,
      name: config.brand.name,
      aliases: config.brand.aliases,
    })
    .select("id")
    .single();
  if (brandErr || !brand) {
    return { ok: false, error: "Could not save brand", detail: brandErr?.message };
  }

  // 3. Insert the job with status='paid' immediately. Worker picks it up
  //    next. The unique Stripe id columns are a backstop against a payment
  //    being provisioned twice.
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      user_id: userId,
      brand_id: brand.id,
      status: "paid",
      config_jsonb: config,
      amount_cents: input.amountCents,
      currency: "usd",
      email_to: input.email,
      source: input.source,
      stripe_checkout_session_id: input.stripeCheckoutSessionId ?? null,
      stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
    })
    .select("id")
    .single();
  if (jobErr || !job) {
    if (jobErr?.code === "23505") return { ok: false, duplicate: true };
    return { ok: false, error: "Could not create job", detail: jobErr?.message };
  }

  // 4. Fire the "order received" email so the customer has confirmation
  //    while the worker generates the report. Best-effort; failures log
  //    but don't block.
  void sendOrderReceivedEmail({
    to: input.email,
    brandName: config.brand.name,
    competitorCount: config.competitors.length,
    promptCount: config.prompts.length,
  });

  // Newly provisioned users have no password. Send the setup link alongside
  // the order receipt; existing users can continue using magic-link login.
  if (userResult.created) {
    await sendAccountInviteEmail({
      supabase,
      to: input.email,
      brandName: config.brand.name,
    });
  }

  return { ok: true, jobId: job.id, userId, brandId: brand.id };
}
