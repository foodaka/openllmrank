// URL identity for set comparisons (orphan check, visited set).
//
// The rule (eng review decision 5A / Codex finding 3): www/apex, http/https,
// and /foo vs /foo/ are NOT inherently the same page. We only collapse
// variants when the site itself told us they are equivalent — via an observed
// redirect. `RedirectMap` accumulates those observations during the crawl;
// canonicalKey() resolves through them.
//
//   canonicalKey("https://a.com/x", map)      -> "https://a.com/x"
//   map.record("https://a.com/x", ".../x/")   (observed 301)
//   canonicalKey("https://a.com/x", map)      -> "https://a.com/x/"
//
// Cheap, safe normalizations that never change identity: lowercase scheme and
// host, drop default port, drop fragment.

export function normalizeUrl(raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }
  return url.href;
}

/** Observed redirects: source URL -> final URL (already normalized). */
export class RedirectMap {
  private map = new Map<string, string>();

  record(from: string, to: string): void {
    const f = normalizeUrl(from);
    const t = normalizeUrl(to);
    if (f && t && f !== t) this.map.set(f, t);
  }

  /** Resolve through observed redirects (bounded, cycle-safe). */
  resolve(url: string): string {
    let current = normalizeUrl(url) ?? url;
    for (let i = 0; i < 10; i++) {
      const next = this.map.get(current);
      if (!next || next === current) break;
      current = next;
    }
    return current;
  }
}

/** Identity used for visited-sets and the orphan diff. */
export function canonicalKey(url: string, redirects: RedirectMap): string {
  return redirects.resolve(url);
}

/** True when two URLs live on the host we are checking. Only the exact
 * hostname counts — www/apex equivalence must be observed via redirect
 * (the redirect map handles that at the key level). */
export function isSameHost(url: string, host: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/** Normalize user-typed domain input ("example.com", "https://example.com/")
 * into an origin URL, or null when it isn't a plausible public hostname. */
export function domainInputToOrigin(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 253) return null;
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  // Require a dot — bare TLDs and intranet names are not checkable sites.
  if (!url.hostname.includes(".")) return null;
  if (url.username || url.password || url.port !== "") return null;
  return `${url.protocol}//${url.hostname}`;
}
