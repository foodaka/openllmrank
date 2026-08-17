// The openllmrank blog registry.
//
// Traffic-acquisition strategy: rank for the emerging "AEO / AI-search
// visibility" category while it is still under-covered, and — because that is
// literally what this product measures — write each post to be the source an
// LLM quotes. Every post ships Article + FAQPage JSON-LD, an extractable
// opening definition, question-shaped H2s, and a structured comparison table.
//
// To add a post: append an entry here (newest last is fine — the index sorts
// by date), create app/blog/<slug>/page.tsx, and wire related slugs below.
//
// Roadmap (not yet written — add as they ship):
//   - how-chatgpt-picks-brands   "How does ChatGPT decide which brands to recommend?"
//   - llms-txt-explained         "llms.txt explained: does it actually work?"
//   - state-of-ai-search-2026    original-research / data post (run via the CLI)

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO YYYY-MM-DD
  dateModified?: string;
  readingTime: string;
  tags: string[];
  keywords: string[];
}

export const posts: BlogPost[] = [
  {
    slug: "state-of-ai-search-2026",
    title:
      "State of AI Search 2026: We Asked 5 AI Engines to Recommend Software",
    description:
      "We ran 10 buying questions through ChatGPT, Claude, Gemini, Perplexity, and Grok — 3 times each, 150 grounded answers — and counted every brand they named. Every category had a locked shortlist, well-known challengers flickered, and 11 real brands were never named once.",
    date: "2026-07-16",
    dateModified: "2026-07-16",
    readingTime: "11 min read",
    tags: ["Data", "AI Search", "Research", "AEO"],
    keywords: [
      "state of ai search",
      "ai search visibility study",
      "what does chatgpt recommend",
      "ai brand recommendations data",
      "which brands does ai recommend",
      "ai search benchmark",
      "chatgpt vs perplexity recommendations",
      "generative engine optimization research",
    ],
  },
  {
    slug: "which-sources-do-ai-engines-cite",
    title: "Which Sources Do AI Engines Cite When Recommending Software?",
    description:
      "Across 150 grounded AI answers, we logged every source the engines cited. The pattern is clear: AI recommendations run downstream of review sites, listicles, and niche blogs — not your own homepage. Here are the domains that get cited most.",
    date: "2026-07-16",
    dateModified: "2026-07-16",
    readingTime: "7 min read",
    tags: ["Data", "Sources", "AI Search", "AEO"],
    keywords: [
      "what sources does ai cite",
      "ai citations sources",
      "which websites does chatgpt cite",
      "perplexity sources",
      "get cited by ai",
      "g2 ai citations",
      "ai search sources study",
      "how ai picks sources",
    ],
  },
  {
    slug: "what-is-aeo",
    title: "What Is AEO (Answer Engine Optimization)?",
    description:
      "AEO is the practice of getting your brand recommended inside AI answers from ChatGPT, Perplexity, Gemini, and other answer engines. Here's what it is, how it differs from SEO, and how to start.",
    date: "2026-07-16",
    dateModified: "2026-07-16",
    readingTime: "9 min read",
    tags: ["AEO", "AI Search", "GEO", "Fundamentals"],
    keywords: [
      "aeo",
      "answer engine optimization",
      "what is aeo",
      "aeo vs seo",
      "generative engine optimization",
      "geo",
      "ai search visibility",
      "get cited by chatgpt",
      "brand visibility in ai",
    ],
  },
  {
    slug: "geo-vs-seo-vs-aeo",
    title: "GEO vs SEO vs AEO: What's the Difference?",
    description:
      "SEO earns a ranking, AEO earns a citation, and GEO is another name for the same thing. Here's a plain-English breakdown of how the three overlap, where they diverge, and which to invest in.",
    date: "2026-07-16",
    dateModified: "2026-07-16",
    readingTime: "8 min read",
    tags: ["GEO", "SEO", "AEO", "Fundamentals"],
    keywords: [
      "geo vs seo",
      "aeo vs seo",
      "geo vs aeo",
      "seo vs aeo vs geo",
      "generative engine optimization vs seo",
      "difference between seo and aeo",
      "answer engine optimization vs seo",
    ],
  },
  {
    slug: "how-to-get-mentioned-in-chatgpt",
    title: "How to Get Your Brand Mentioned in ChatGPT",
    description:
      "A practical, step-by-step guide to getting ChatGPT to recommend and cite your brand — how it retrieves and chooses sources, the content that gets quoted, and how to measure whether it's working.",
    date: "2026-07-16",
    dateModified: "2026-07-16",
    readingTime: "10 min read",
    tags: ["ChatGPT", "AEO", "How-to", "AI Search"],
    keywords: [
      "how to get mentioned in chatgpt",
      "get cited by chatgpt",
      "rank in chatgpt",
      "chatgpt brand recommendations",
      "appear in chatgpt answers",
      "chatgpt seo",
      "how to show up in chatgpt",
      "optimize for chatgpt",
    ],
  },
  {
    slug: "best-ai-search-visibility-tools",
    title: "Best AI Search Visibility Tools (2026)",
    description:
      "A candid comparison of AI search visibility and AEO tools — Profound, Athena HQ, Brand Radar, openllmrank, and the DIY spreadsheet approach — with the trade-offs on price, depth, and who each is for.",
    date: "2026-07-16",
    dateModified: "2026-07-16",
    readingTime: "9 min read",
    tags: ["Tools", "Comparison", "AEO", "AI Search"],
    keywords: [
      "best ai search visibility tools",
      "ai visibility tracking tools",
      "aeo tools",
      "geo tools",
      "profound vs athena",
      "brand visibility ai tools",
      "ai brand monitoring",
      "chatgpt visibility tracker",
    ],
  },
  {
    slug: "discovered-currently-not-indexed",
    title:
      "Discovered — Currently Not Indexed: The Silent Cause Nobody Checks",
    description:
      "Our blog sat invisible in Google for months with every post stuck at \"Discovered — currently not indexed.\" The cause wasn't content quality or crawl budget — it was broken internal links severing the crawl paths. Here's how to diagnose it in 60 seconds, and why the same failure hides you from AI crawlers too.",
    date: "2026-08-15",
    dateModified: "2026-08-15",
    readingTime: "8 min read",
    tags: ["Technical SEO", "Indexing", "Crawlability", "AEO"],
    keywords: [
      "discovered currently not indexed",
      "discovered not indexed fix",
      "google not indexing my pages",
      "blog posts not indexed",
      "broken internal links seo",
      "orphan pages seo",
      "internal linking crawl paths",
      "site not showing up in google",
      "crawled currently not indexed vs discovered",
      "ai crawlers blocked",
    ],
  },
];

export function getPostBySlug(slug: string): BlogPost | undefined {
  return posts.find((p) => p.slug === slug);
}

// Newest first for the index. Stable for equal dates (preserves array order).
export function getAllPosts(): BlogPost[] {
  return [...posts].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
}

// Curated related links per post. Unknown slugs are filtered out, so it is safe
// to reference posts before they exist — they simply won't render until added.
const RELATED: Record<string, string[]> = {
  "state-of-ai-search-2026": [
    "which-sources-do-ai-engines-cite",
    "how-to-get-mentioned-in-chatgpt",
    "best-ai-search-visibility-tools",
  ],
  "which-sources-do-ai-engines-cite": [
    "state-of-ai-search-2026",
    "how-to-get-mentioned-in-chatgpt",
    "what-is-aeo",
  ],
  "what-is-aeo": [
    "state-of-ai-search-2026",
    "geo-vs-seo-vs-aeo",
    "how-to-get-mentioned-in-chatgpt",
  ],
  "geo-vs-seo-vs-aeo": [
    "what-is-aeo",
    "how-to-get-mentioned-in-chatgpt",
    "best-ai-search-visibility-tools",
  ],
  "how-to-get-mentioned-in-chatgpt": [
    "what-is-aeo",
    "geo-vs-seo-vs-aeo",
    "best-ai-search-visibility-tools",
  ],
  "best-ai-search-visibility-tools": [
    "what-is-aeo",
    "how-to-get-mentioned-in-chatgpt",
    "geo-vs-seo-vs-aeo",
  ],
  "discovered-currently-not-indexed": [
    "how-to-get-mentioned-in-chatgpt",
    "which-sources-do-ai-engines-cite",
    "what-is-aeo",
  ],
};

export function getRelatedPosts(slug: string): BlogPost[] {
  return (RELATED[slug] || [])
    .map((s) => posts.find((p) => p.slug === s))
    .filter((p): p is BlogPost => Boolean(p));
}
