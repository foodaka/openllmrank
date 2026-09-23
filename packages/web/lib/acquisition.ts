import { getAllPosts } from "./blog";

const publicPaths = new Set(["/", "/check", "/blog", "/methodology", "/sample-report.html", ...getAllPosts().map(p => `/blog/${p.slug}`)]);
export function publicLanding(path: unknown): string {
  return typeof path === "string" && publicPaths.has(path) ? path : "other";
}

const SOURCES = ["direct", "google", "bing", "chatgpt", "perplexity", "claude", "gemini", "other"] as const;
export type Acquisition = { landing: string; source: string };
export function referralSource(referrer: string): string {
  if (!referrer) return "direct";
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    const matches = (domain: string) => host === domain || host.endsWith(`.${domain}`);
    if (matches("chatgpt.com") || matches("chat.openai.com")) return "chatgpt";
    if (matches("perplexity.ai")) return "perplexity";
    if (matches("claude.ai")) return "claude";
    if (matches("gemini.google.com")) return "gemini";
    if (matches("bing.com")) return "bing";
    if (/^(www\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host)) return "google";
  } catch { /* No raw referrer is retained. */ }
  return "other";
}
export function sanitizeAcquisition(value: unknown): Acquisition {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { landing: publicLanding(data.landing), source: SOURCES.includes(data.source as typeof SOURCES[number]) ? String(data.source) : "other" };
}
export function acquisitionMetadata(value: unknown): Record<string, string> {
  const data = sanitizeAcquisition(value);
  return { acquisition_landing: data.landing, acquisition_source: data.source };
}
