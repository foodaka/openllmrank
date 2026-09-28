---
name: teardown
description: Make a public AI-search teardown post for openllmrank's blog from a CLI run. Use when the user asks for a teardown, a data post about which brands AI engines recommend in a category, or to scout categories for one ("teardown on transactional email APIs", "scout these 5 categories").
---

# /teardown: one category in, one draft blog post out

A teardown is a data post: run a category's buyer questions through the 5 grounded
engines, find the one surprising finding, and publish it on openllmrank.io/blog with a
chart, quotes, and the full report as receipts. The reference implementation is
`packages/web/app/blog/transactional-email-apis/`. Read it before drafting.

Teardowns ship through git, not the database: the data JSON, the post, and the static
report are files deployed with the site. This repo is public, so anything pushed (even
on a branch) is visible. Never commit or push unless the user asks (CLAUDE.md).

## Inputs

- Category (required), e.g. "transactional email APIs".
- Brand to highlight (optional). Default: none. `stepracers` is the maintainer's own test
  brand and safe to publish. Any other highlighted brand must be a public company,
  framed fairly.
- A list of categories means scout mode: do steps 1-3 for each, report which have a
  story, and stop.

## Steps

### 0. Preflight

Check the 5 provider keys are set, printing only names (never values):

```bash
for k in OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_API_KEY PERPLEXITY_API_KEY XAI_API_KEY; do
  printenv "$k" >/dev/null && echo "$k set" || echo "$k MISSING"; done
```

If any are missing, stop and ask the user to export them. Don't run with fewer engines:
a public post missing an engine invites the obvious objection.

### 1. Config (get approval before spending money)

Pick a slug: lowercase-hyphenated, reads like the search query (`transactional-email-apis`).
Create `teardowns/<slug>/openllmrank.config.json` at the repo root, shaped like
`teardowns/transactional-email-apis/openllmrank.config.json`:

- `brand`: the highlight brand (or the category's most interesting underdog).
- `competitors`: 5-8 real brands a buyer would compare, each with its domain as an
  alias. Avoid brand names that are common English words; use the full product name.
- `prompts`: 5-6 questions a buyer would really type: mostly "best X for Y" and
  "alternatives to Z". No how-to questions. A question that names brands ("A vs B",
  "alternatives to A") inflates those brands; it can be run for the report but gets
  `--exclude`d from the counts in step 5.
- The same 5 providers and models as the reference config, `samples_per_prompt: 3`.

Show the user the brands and questions and wait for a go-ahead. The full run costs about
$0.65 per question (6 questions is about $4); the scout is about a third of that.

### 2. Scout run (about $1)

```bash
cd teardowns/<slug> && bun ../../packages/cli/src/cli/index.ts run --samples 1
```

### 3. Is there a story?

Generate the numbers from the scout run (step 5's command) and look for one of:

- a big or famous brand that is barely named, or a small one that dominates;
- engines disagreeing on the leader;
- the cited sources being vendor blogs, app stores, or one dominant review site;
- the highlight brand's number being newsworthy on its own.

No story means stop and say so. It is not a failure, and it saves the $4 full run.

### 4. Full run (about $4)

```bash
cd teardowns/<slug> && bun ../../packages/cli/src/cli/index.ts run
```

### 5. Generate the data

```bash
cd packages/web && bun scripts/teardown-data.ts \
  --db ../../teardowns/<slug>/data/openllmrank.db \
  --config ../../teardowns/<slug>/openllmrank.config.json \
  --slug <slug> [--highlight "<brand>"] [--exclude "<question that names brands>"]...
```

This writes `content/teardowns/<slug>.json` and `public/teardowns/<slug>/report.html`,
using the newest finished run. Pass `--run <id>` to pick another.

### 6. Read the answers before trusting a number

This step is mandatory. Before headlining a brand's share, read the answers behind it
(query `calls.response_text` in the run's db). Mention counts overstate brands that other
products integrate with or run on (Fitbit as "syncs with Fitbit", Slack, Shopify, AWS).
If most of a brand's mentions are like that, say so in the post, as the Fitbit asterisk
does. Any hand-read number goes in a named constant with a comment on how it was
measured, and the post calls it approximate.

Also look at the top cited domains: who wrote the pages the engines read is often the
real story (in the email teardown, one vendor's blog out-cited every provider). A brand
that is not in the config can still be quoted; count its mentions by hand into a
constant.

Then cut the JSON's `quotes` to the 2-3 the post will use (the extractor keeps up to 20
candidates, all naming tracked brands; a verbatim sentence from the db may be added). Quote text must stay verbatim; trimming a leading heading fragment is fine,
rewording is not.

### 7. Draft the post

- Copy `app/blog/transactional-email-apis/{page.tsx,opengraph-image.tsx,twitter-image.tsx}`
  to `app/blog/<slug>/`, and change the JSON import, `SLUG`, alt text and headline.
- Rewrite the prose around THIS finding: headline, lede, three findings, section
  headings, FAQ. Keep the structure: findings up front, `ShareChart`, the key-finding
  section, `EngineSplit`, `CitedSources` and quotes, `TeardownCta`, what it means,
  `MethodBox`, FAQ.
- Derive numbers from `data` (`pct()`, `count()`, `leader()`). Type a number into prose
  only if it cannot be derived, and list any you typed in the summary to the user.
- Add the post to `posts` in `packages/web/lib/blog.ts` (tags `["Teardown", "Data", "AI
  Search"]`, `date` = today) and 3 existing slugs to `RELATED`.

Writing rules: follow DESIGN.md. Every claim states its sample ("named in 12 of 90
answers, run 2026-10-02"), never "ChatGPT ignores X". Frame low scorers as "here's why",
not as losers. Disclose that openllmrank sells this measurement. Never put a customer's
brand or data in a teardown.

### 8. Check

```bash
cd packages/web && bun run typecheck && bun test test/teardown.test.ts test/seo-surface.test.ts
```

Then open `http://localhost:3000/blog/<slug>` and `/blog/<slug>/opengraph-image` (start
`bun run dev:web` from the root if nothing is listening on :3000) and look at both. The
OG card must show the highlight brand and no clipped text.

### 9. Hand off

Tell the user:

- the local URLs, the finding in one sentence, and the total API spend;
- any hand-typed numbers, and what would change them on a re-run;
- 2 draft posts: an X opener (link goes in the first reply) and a LinkedIn post. Include a
  Hacker News title only if the method is the story;
- that it's ready to commit on request. Files: `teardowns/<slug>/openllmrank.config.json`,
  `packages/web/content/teardowns/<slug>.json`, `packages/web/public/teardowns/<slug>/`,
  `packages/web/app/blog/<slug>/`, `packages/web/lib/blog.ts`.

## Refreshing an existing teardown

Re-run step 4 in its folder, then step 5 with the same slug. Numbers derived from `data`
update themselves. Re-check hand-typed constants and the `description` in `lib/blog.ts`,
set `dateModified`, and update the post-meta line if the run date changed.
