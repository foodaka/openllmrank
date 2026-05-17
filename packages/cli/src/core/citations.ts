import type { Brand, Citation, GroundedSource } from "./types";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[A-Za-z0-9_]/.test(ch);
}

function findNameMatches(text: string, alias: string): { matched: string; index: number }[] {
  const out: { matched: string; index: number }[] = [];
  if (alias.length === 0) return out;
  const aliasLower = alias.toLowerCase();
  const textLower = text.toLowerCase();
  let i = 0;
  while (i <= textLower.length - aliasLower.length) {
    const idx = textLower.indexOf(aliasLower, i);
    if (idx === -1) break;
    const before = idx > 0 ? text[idx - 1] : undefined;
    const after = idx + alias.length < text.length ? text[idx + alias.length] : undefined;
    if (!isWordChar(before) && !isWordChar(after)) {
      out.push({ matched: text.slice(idx, idx + alias.length), index: idx });
    }
    i = idx + 1;
  }
  return out;
}

function findUrlMatches(text: string, alias: string): { matched: string; index: number }[] {
  if (!alias.includes(".")) return [];
  const out: { matched: string; index: number }[] = [];
  const re = new RegExp(escapeRegex(alias), "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ matched: m[0], index: m.index });
  }
  return out;
}

function isUrlAlias(alias: string): boolean {
  return /\.[a-z]{2,}/i.test(alias);
}

export function extractCitations(
  text: string,
  brands: Brand[],
  search_results: GroundedSource[] = [],
): Citation[] {
  if (!text && search_results.length === 0) return [];
  if (brands.length === 0) return [];

  const seen = new Set<string>();
  const out: Citation[] = [];

  const sortedBrands = [...brands].sort((a, b) => {
    const aMaxLen = Math.max(a.name.length, ...a.aliases.map((x) => x.length));
    const bMaxLen = Math.max(b.name.length, ...b.aliases.map((x) => x.length));
    return bMaxLen - aMaxLen;
  });

  for (const brand of sortedBrands) {
    const aliases = [brand.name, ...brand.aliases].sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      if (alias.length === 0) continue;

      if (isUrlAlias(alias)) {
        for (const m of findUrlMatches(text, alias)) {
          const key = `url|${brand.name}|${m.index}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ brand: brand.name, matched_text: m.matched, kind: "url" });
        }
      } else {
        for (const m of findNameMatches(text, alias)) {
          const key = `name|${brand.name}|${m.index}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ brand: brand.name, matched_text: m.matched, kind: "name" });
        }
      }
    }

    for (const src of search_results) {
      const haystack = `${src.url} ${src.title ?? ""} ${src.snippet ?? ""}`;
      let matched = false;
      for (const alias of aliases) {
        if (isUrlAlias(alias)) {
          if (haystack.toLowerCase().includes(alias.toLowerCase())) {
            matched = true;
            break;
          }
        } else if (findNameMatches(haystack, alias).length > 0) {
          matched = true;
          break;
        }
      }
      if (matched) {
        const key = `grounded|${brand.name}|${src.url}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ brand: brand.name, matched_text: src.url, kind: "grounded_source" });
        }
      }
    }
  }

  return out;
}
