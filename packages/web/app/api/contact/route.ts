import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

// POST /api/contact
//
// Receives the contact-modal form, validates it, and forwards the message
// to a Telegram chat via the Bot API. Set TELEGRAM_BOT_TOKEN and
// TELEGRAM_CHAT_ID in env. If either is missing, the route logs the
// message to stderr and returns success so the form still works in dev.

const BodySchema = z.object({
  email: z.string().email().max(254),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  // Honeypot — must be empty. Hidden field that real users don't fill.
  hp: z.string().max(0).optional().or(z.literal("")),
});

// Tighter than checkout: 3 messages per minute per IP. Contact form is
// rarer than checkout in normal use, and the upside of being noisy is low.
const RATE_LIMIT_REQUESTS = 3;
const RATE_LIMIT_WINDOW_MS = 60_000;

function escapeMarkdown(text: string): string {
  // Telegram MarkdownV2 reserved chars. We use plain text mode (no
  // parse_mode) to avoid this headache entirely, but kept here in case
  // we switch later.
  return text;
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const limit = checkRateLimit(ip, RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a minute." },
      {
        status: 429,
        headers: {
          "Retry-After": Math.ceil((limit.resetAt - Date.now()) / 1000).toString(),
        },
      },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON" },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please fill in email, subject, and message." },
      { status: 400 },
    );
  }

  const { email, subject, body } = parsed.data;

  const text =
    `📨 New contact form\n` +
    `\n` +
    `From: ${escapeMarkdown(email)}\n` +
    `Subject: ${escapeMarkdown(subject)}\n` +
    `\n` +
    `${escapeMarkdown(body)}`;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    // Dev fallback: log and accept. Lets the wizard run before Telegram
    // creds are wired up.
    console.warn(
      "[contact] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — message logged only:",
      { email, subject, body },
    );
    return NextResponse.json({ ok: true, mode: "logged" });
  }

  try {
    const tgRes = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
      },
    );
    if (!tgRes.ok) {
      const tgErr = (await tgRes.json().catch(() => null)) as
        | { description?: string }
        | null;
      console.error("[contact] Telegram API error:", tgRes.status, tgErr);
      return NextResponse.json(
        { error: "Could not deliver the message. Try again shortly." },
        { status: 502 },
      );
    }
  } catch (e) {
    console.error("[contact] Telegram fetch failed:", (e as Error).message);
    return NextResponse.json(
      { error: "Could not deliver the message. Try again shortly." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, mode: "telegram" });
}
