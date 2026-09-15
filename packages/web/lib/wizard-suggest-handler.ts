import { normalizeWebsite, SuggestionError, type WebsiteSuggestions } from "./website-suggestions";
import { checkRateLimit } from "./rate-limit";

type Dependencies = {
  userId: () => Promise<string | null>;
  configured: () => boolean;
  suggest: (website: string) => Promise<WebsiteSuggestions>;
};

export async function handleWizardSuggest(req: Request, deps: Dependencies): Promise<Response> {
  const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
  try {
    const userId = await deps.userId();
    if (!userId) return json({ error: "Sign in to get AI suggestions for your website." }, 401);
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) return json({ error: "Please request suggestions from the wizard." }, 403);
    if (!req.headers.get("content-type")?.includes("application/json")) return json({ error: "Send a website as JSON." }, 400);
    // Bound streamed bodies too; Content-Length alone is client-controlled.
    const reader = req.body?.getReader();
    if (!reader) return json({ error: "Enter your website." }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) { await reader.cancel(); return json({ error: "The website address is too long." }, 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return json({ error: "Enter a valid website." }, 400); }
    const website = normalizeWebsite(body?.website);
    if (!deps.configured()) return json({ error: "AI suggestions are temporarily unavailable. You can still fill in the form yourself." }, 503);
    const limit = checkRateLimit(`wizard-suggest:${userId}`, 5, 10 * 60_000);
    if (!limit.allowed) return json({ error: "You’ve used your five drafts for now. Try again in a few minutes, or continue editing manually." }, 429, { "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))) });
    const suggestions = await deps.suggest(website);
    return json({ website, suggestions });
  } catch (error) {
    if (error instanceof SuggestionError) return json({ error: error.message }, error.status);
    return json({ error: "AI suggestions are unavailable right now. Please try again, or continue manually." }, 503);
  }
}
