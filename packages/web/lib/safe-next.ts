// Same-origin redirect targets only.
//
// `next` arrives from the query string on /login and /auth/callback. Anything
// that is not a plain path on this site turns the login page into an open
// redirect. "//evil.com" is the well-known case; "/\evil.com" is the one the
// naive check misses, because both the browser and `new URL()` treat a
// backslash after the leading slash as a second slash.

export function safeNext(
  raw: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!raw || raw.length > 2048) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (/^\/[\/\\]/.test(raw)) return fallback;
  if (/[\\\r\n\0]/.test(raw)) return fallback;
  let url: URL;
  try {
    url = new URL(raw, "http://x");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://x") return fallback;
  // Never bounce a fresh session back into the auth pages.
  if (url.pathname.startsWith("/login") || url.pathname.startsWith("/auth/")) {
    return fallback;
  }
  return url.pathname + url.search + url.hash;
}
