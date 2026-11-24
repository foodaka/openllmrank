// llms.txt, rendered from the same registries as the site (blog posts,
// comparison pages) so a new post or /vs/ page is never missing here.
// Replaces the former static public/llms.txt. Edit HEAD and TAIL for the
// fixed prose; the lists in between are generated.

import { getAllPosts } from "../../lib/blog";
import { competitors } from "../../lib/compare";

const SITE_URL = "https://openllmrank.io";

export const dynamic = "force-static";

const HEAD = "# openllmrank\n\n> Privacy-friendly, open-source analytics for AI search visibility. We repeatedly query grounded provider APIs with buying questions, measure brand and competitor citations, and deliver a one-time $79 emailed report with evidence and prioritized actions, or weekly tracking with a dashboard for $49/month.\n\nopenllmrank is a hosted product plus an MIT-licensed CLI. Both support grounded OpenAI, Anthropic, Google Gemini, Perplexity, and xAI Grok APIs; the CLI uses bring-your-own API keys.\n\n## Core pages\n\n- [Home](https://openllmrank.io/): What the report measures, how it works, sample, FAQ, pricing.\n- [Sample report](https://openllmrank.io/sample-report.html): A real (anonymized) report so you can see exactly what gets delivered.\n- [Wizard — start a report](https://openllmrank.io/wizard/brand): Three-minute signup. Enter brand, competitors, and buying questions.\n- [Terms of Service](https://openllmrank.io/terms): Service terms, refund policy, AI-output disclaimer, governing law.\n- [Privacy Policy](https://openllmrank.io/privacy): What we collect, who we share it with, retention, user rights.";

const TAIL = "## How the report is generated\n\n- We run each buying-question prompt multiple times through grounded provider APIs with web search enabled.\n- Provider API results are a reproducible directional benchmark; they can differ from consumer apps because model versions, system instructions, rollouts, and personalization differ.\n- We capture every response, extract every brand citation, and compute citation rates per prompt per brand.\n- We compare your brand against the competitors you provided and surface the content gaps that explain the difference.\n- Reports are emailed within roughly fifteen minutes of payment. If we cannot generate a report, the charge is refunded automatically.\n\n## For AI agents (MCP)\n\n- [MCP endpoint](https://openllmrank.io/api/mcp): Streamable HTTP, no account needed. Tools: `discover_ai_questions` (free), `analyze_brand_visibility` (priced order), `pay_for_report` (Stripe Shared Payment Token), `get_report_status`, `get_visibility_report`, `check_ai_crawlability` and `get_crawlability_report` (free AI crawler access check).\n- [Agent plugin](https://github.com/foodaka/openllmrank/tree/main/plugins/openllmrank): The MCP server plus skills (`ai-crawlability-check`, `ai-visibility-audit`, `fix-citation-gaps`) for Claude Code (`/plugin marketplace add foodaka/openllmrank`), Codex, Cursor, or `npx skills add foodaka/openllmrank`.\n- [Agent API documentation](https://github.com/foodaka/openllmrank/blob/main/docs/AGENT_API.md): Tool schemas, the order and payment lifecycle, error codes.\n\n## Open source\n\n- [openllmrank on GitHub](https://github.com/foodaka/openllmrank): MIT-licensed monorepo. The CLI is published as `openllmrank` on npm.\n- [openllmrank on npm](https://www.npmjs.com/package/openllmrank): Install with `bun install -g openllmrank`, bring your own provider keys, and run the same analysis locally.\n\n## Contact\n\n- Reach us via the contact form on any page of openllmrank.io.";

export function renderLlmsTxt(): string {
  const tools = [
    "## Free tools and method",
    "",
    `- [Free AI visibility snapshot](${SITE_URL}/snapshot): Asks AI engines a few buying questions about your category and shows whether your brand makes the shortlist. No card.`,
    `- [Free AI crawler check](${SITE_URL}/check): Checks whether AI crawlers can fetch and read your pages.`,
    `- [Methodology](${SITE_URL}/methodology): Prompts, sample sizes, provider APIs, and the limits of what we measure.`,
  ];
  const compare = [
    "## Comparisons",
    "",
    `- [AI visibility tools compared](${SITE_URL}/alternatives): openllmrank against other AI visibility trackers on price, engines, and refresh cadence, from each vendor's own pricing page.`,
    ...competitors.map((c) => `- [${c.name} vs openllmrank](${SITE_URL}/vs/${c.slug}): ${c.description}`),
  ];
  const blog = [
    "## Blog",
    "",
    ...getAllPosts().map((p) => `- [${p.title}](${SITE_URL}/blog/${p.slug}): ${p.description}`),
  ];
  return [HEAD, tools.join("\n"), compare.join("\n"), blog.join("\n"), TAIL].join("\n\n") + "\n";
}

export function GET() {
  return new Response(renderLlmsTxt(), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
