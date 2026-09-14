import { ServerClient as PostmarkClient } from "postmark";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_SITE_ORIGIN = "http://localhost:3000";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function siteOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_ORIGIN;
  if (!configured && process.env.NODE_ENV === "production") {
    // A missing origin would put http://localhost:3000 in a customer's
    // password-setup email. Fail loudly instead.
    throw new Error("NEXT_PUBLIC_SITE_ORIGIN is required in production");
  }
  return (configured ?? DEFAULT_SITE_ORIGIN).replace(/\/+$/, "");
}

export function accountInviteRedirectUrl(): string {
  return `${siteOrigin()}/auth/set-password`;
}

export function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function generateAccountInviteLink(
  supabase: SupabaseClient,
  email: string,
): Promise<string> {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email: normalizeAccountEmail(email),
    options: { redirectTo: accountInviteRedirectUrl() },
  });

  if (error || !data?.properties?.action_link) {
    throw new Error(error?.message ?? "Supabase did not return an invite link");
  }

  return data.properties.action_link;
}

export async function sendAccountInviteEmail(args: {
  supabase: SupabaseClient;
  to: string;
  brandName?: string;
}): Promise<{ sent: boolean; actionLink: string | null }> {
  let actionLink: string;
  try {
    actionLink = await generateAccountInviteLink(args.supabase, args.to);
  } catch (error) {
    console.error(
      `[account-invite] could not generate link for ${args.to}:`,
      (error as Error).message,
    );
    return { sent: false, actionLink: null };
  }

  const token = process.env.POSTMARK_SERVER_TOKEN;
  const postmarkMode = process.env.POSTMARK_MODE ?? "local_stub";
  if (postmarkMode === "local_stub" || !token) {
    // The local Supabase stack has no production mail provider. Logging the
    // generated link keeps the flow testable without sending real email.
    console.log(`[account-invite stub] to=${args.to} link=${actionLink}`);
    return { sent: false, actionLink };
  }

  try {
    const client = new PostmarkClient(token);
    const fromAddr = process.env.POSTMARK_FROM ?? "reports@openllmrank.io";
    const fromName = process.env.POSTMARK_FROM_NAME ?? "openllmrank";
    const brandLine = args.brandName
      ? ` for ${escapeHtml(args.brandName)}`
      : "";

    await client.sendEmail({
      From: `${fromName} <${fromAddr}>`,
      To: normalizeAccountEmail(args.to),
      Subject: "Finish setting up your openllmrank account",
      HtmlBody: `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#fbf8f0;color:#241f19;padding:48px 24px;max-width:560px;margin:0 auto">
<p style="font-size:12px;letter-spacing:.11em;text-transform:uppercase;color:#376b5b;font-weight:700">Your account is ready</p>
<h1 style="font-family:Georgia,serif;font-size:32px;line-height:1.05;margin:12px 0 24px;font-weight:500">Set your password and sign in.</h1>
<p>Your openllmrank account${brandLine} is ready. Set a password once, then sign in anytime to follow your AI-search visibility.</p>
<p><a href="${escapeHtml(actionLink)}" style="display:inline-block;background:#376b5b;color:#fff;padding:14px 22px;text-decoration:none;border-radius:6px;font-weight:600">Set your password</a></p>
<p style="color:#756c60;font-size:14px">This link expires in an hour. If you did not place this order, you can ignore this email.</p>
<p style="font-family:Georgia,serif;font-style:italic;color:#756c60;margin-top:32px">- openllmrank</p>
</body></html>`,
      MessageStream: "outbound",
      Tag: "account-invite",
    });
    return { sent: true, actionLink };
  } catch (error) {
    console.error(
      "[account-invite] postmark send failed:",
      (error as Error).message,
    );
    return { sent: false, actionLink };
  }
}
