// Founder pings over Telegram. Best-effort: no-ops without config, never
// throws, and gives up after 3 seconds so a slow Telegram never holds up a
// visitor's request.
//
//   TELEGRAM_BOT_TOKEN  from @BotFather
//   TELEGRAM_CHAT_ID    your chat with the bot (message it once, then read
//                       https://api.telegram.org/bot<token>/getUpdates)

export function telegramConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

/** Escape text for Telegram's HTML parse mode. */
export function escapeTelegram(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function notifyTelegram(
  html: string,
  deps: { env?: Record<string, string | undefined>; fetch?: typeof fetch } = {},
): Promise<boolean> {
  const env = deps.env ?? process.env;
  if (!telegramConfigured(env)) return false;
  const doFetch = deps.fetch ?? fetch;
  try {
    const res = await doFetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(3_000),
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) console.error(`[telegram] sendMessage failed: HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error("[telegram] sendMessage failed:", (e as Error).message);
    return false;
  }
}
