import { env } from "./env";

// Admin alerts. Logs to stderr always; optionally POSTs to a Discord webhook
// if ADMIN_ALERT_DISCORD_WEBHOOK is set. Used for terminal failures the
// worker can't recover from on its own (e.g., refund retry exhausted,
// email retry exhausted, CLI crashed in an unexpected way).

export type AlertLevel = "info" | "warn" | "error";

export async function alert(
  level: AlertLevel,
  message: string,
  context: Record<string, unknown> = {},
): Promise<void> {
  const prefix =
    level === "error" ? "!!" : level === "warn" ? "! " : "i ";
  const line = `${prefix} ${message} ${JSON.stringify(context)}`;
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");

  if (!env.adminWebhook) return;

  try {
    const body = {
      content: `**[${level.toUpperCase()}]** ${message}\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``,
    };
    await fetch(env.adminWebhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // Don't let an alert delivery failure break the worker.
    process.stderr.write(
      `!! alert delivery failed: ${(e as Error).message}\n`,
    );
  }
}
