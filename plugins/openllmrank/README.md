# OpenLLMRank plugin

AI visibility for your agent: how often ChatGPT, Claude, Gemini, Perplexity and Grok recommend your brand versus competitors, whether AI crawlers can reach your site, and what to change.

The plugin bundles the OpenLLMRank MCP server (`https://openllmrank.io/api/mcp`, no account needed) with three skills:

| Skill | What it does | Cost |
| --- | --- | --- |
| `ai-crawlability-check` | Checks robots.txt access for OAI-SearchBot, Claude-SearchBot, PerplexityBot and search engines, crawls the site for unreachable pages, and fixes what can be fixed in code | Free |
| `ai-visibility-audit` | Starts with a free quick check (one question on ChatGPT, Perplexity and Gemini), then the full report: five assistants, repeated samples, measured against competitors | Quick check free; report price confirmed before paying |
| `fix-citation-gaps` | Compares the competitor page the AI cited with yours and writes (or applies) specific page changes | Free (uses a report) |

## Install

**Claude Code**

```
/plugin marketplace add foodaka/openllmrank
/plugin install openllmrank@openllmrank
```

**Codex CLI**

```
codex plugin marketplace add foodaka/openllmrank
codex plugin add openllmrank@openllmrank
```

**Any agent that reads `SKILL.md` files**

```
npx skills add foodaka/openllmrank
```

**MCP only (no skills)**

```
claude mcp add --transport http --scope user openllmrank https://openllmrank.io/api/mcp
```

## Try it

- "Can ChatGPT and Perplexity crawl example.com? Fix what's blocking them."
- "How visible is my company in AI answers compared to Acme and Globex?"
- "Why does AI recommend my competitor instead of us? Tell me what to change."

Tool reference: [docs/AGENT_API.md](../../docs/AGENT_API.md). Prefer to run everything locally with your own API keys? Use the open-source CLI in [packages/cli](../../packages/cli).
