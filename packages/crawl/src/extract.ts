// HTML extraction via Bun's built-in HTMLRewriter: streaming, spec-grade
// parsing, and the body string is discarded by the caller right after —
// bounded memory is a plan requirement, not an optimization.

import { normalizeUrl } from "./normalize";

export type PageExtract = {
  links: string[];
  canonical: string | null;
  noindex: boolean;
  titlePresent: boolean;
  descriptionPresent: boolean;
};

export async function extractFromHtml(html: string, baseUrl: string): Promise<PageExtract> {
  const links = new Set<string>();
  let canonical: string | null = null;
  let noindex = false;
  let titleHasText = false;
  let descriptionPresent = false;

  const rewriter = new HTMLRewriter()
    .on("a[href]", {
      element(el) {
        // Bounded memory: a hostile 2MB page packed with anchors must not
        // balloon the crawl queue — past this cap a page adds no diagnostic
        // value for a crawlability check.
        if (links.size >= 2000) return;
        const href = el.getAttribute("href");
        if (!href) return;
        const normalized = normalizeUrl(href, baseUrl);
        if (normalized) links.add(normalized);
      },
    })
    .on('link[rel="canonical"]', {
      element(el) {
        const href = el.getAttribute("href");
        if (href && canonical === null) canonical = normalizeUrl(href, baseUrl);
      },
    })
    .on("meta[name]", {
      element(el) {
        const name = el.getAttribute("name")?.toLowerCase();
        const content = el.getAttribute("content") ?? "";
        if (name === "robots" && /noindex/i.test(content)) noindex = true;
        if (name === "description" && content.trim().length > 0) descriptionPresent = true;
      },
    })
    .on("title", {
      text(chunk) {
        if (chunk.text.trim().length > 0) titleHasText = true;
      },
    });

  // transform() is lazy — draining the Response is what runs the handlers.
  await rewriter.transform(new Response(html)).text();

  return {
    links: [...links],
    canonical,
    noindex,
    titlePresent: titleHasText,
    descriptionPresent,
  };
}
