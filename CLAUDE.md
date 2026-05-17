# CLAUDE.md — Agent operating notes for openllmrank

Notes for any AI agent (Claude, Cursor, Codex, etc.) opening this repo for the first time. Read these before making changes.

## Repo shape

This is a Bun-workspace monorepo.

| Package | Path | What it is | Visibility |
|---------|------|------------|------------|
| `openllmrank` | `packages/cli/` | The open-source CLI. AI-search-visibility tracking via the OpenAI Responses API and Anthropic Messages API. Published to npm. MIT. | Public |
| `@openllmrank/shared` | `packages/shared/` | Shared Zod schemas (`ConfigSchema`, `HostedConfigSchema`), TS types, and design tokens used by both the CLI and the hosted webapp. | Private |
| `@openllmrank/web` | `packages/web/` | The hosted Next.js webapp: marketing landing, signup wizard, Stripe checkout, webhook handler. Runs end-to-end locally with `STRIPE_MODE=local_stub`. | Private |

The infrastructure code (Supabase migrations, RLS policies) lives in `supabase/migrations/`.

## Design system

**Always read [DESIGN.md](./DESIGN.md) before making any visual or UI decision.**

All font choices, colors, spacing, and aesthetic direction are defined there. Do not deviate without explicit user approval. In code review or QA, flag any code that doesn't match the tokens.

Single source of truth for CSS variables: `packages/shared/src/design-tokens.css`. The CLI report renderer (`packages/cli/src/core/render-html.ts`) has the same tokens inlined deliberately (the CLI must be standalone). When you change a token, change it in both places.

The aesthetic is editorial / investigative magazine — warm paper, Georgia serif headlines, moss-green accent, terra-cotta emphasis. Never propose Inter, Space Grotesk, Poppins, or system-ui as a display font on this project.

## Testing

```bash
bun test                # all packages, ~145 tests
bun run typecheck       # root + all packages
bun run --cwd packages/web typecheck   # web package alone
```

Test framework is `bun:test` everywhere. Tests live in `packages/*/test/`.

Some tests require local Supabase running. Bring it up with `bun run db:start` (wraps `supabase start`). They skip cleanly if Postgres isn't reachable.

## Running locally

```bash
bun run db:start        # local Supabase (Postgres on :54332, Studio on :54333)
bun run dev:web         # Next.js on :3000
```

Default `STRIPE_MODE=local_stub` lets the full pay-to-job flow exercise end-to-end with no Stripe / Supabase / Postmark account.

## Conventions

- **Commits:** Conventional Commits prefix (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`). Use scopes (`feat(web):`, `feat(db):`, `chore(cli):`). Co-author the agent that wrote the code.
- **No commits without user request.** The user asks to commit; you don't proactively commit.
- **No `git push` without user request.** Same rule.
- **Ports:** This project uses Supabase ports `54331..54339` (default ports `54321..54327` shifted by +10) so it can run alongside other Supabase projects on the same machine. Don't reset `supabase/config.toml`.

## Files agents commonly need

- [DESIGN.md](./DESIGN.md) — the design system
- [TODOS.md](./TODOS.md) — v1 MUST work + explicit v1.1 / v2 deferrals
- `packages/cli/CHANGELOG.md` — CLI release history (npm package)
- `~/.gstack/projects/foodaka-openllmrank/markhinschberger-main-design-20260517-183514.md` — the architectural design doc with rationale for every major decision

## Skill routing

When the user's request matches a gstack skill, invoke it via the Skill tool. When in doubt, invoke the skill.

- Product ideas / brainstorming → `/office-hours`
- Strategy / scope → `/plan-ceo-review`
- Architecture → `/plan-eng-review`
- Design system / plan review → `/design-consultation` or `/plan-design-review`
- Full review pipeline → `/autoplan`
- Bugs / errors → `/investigate`
- QA / testing site behavior → `/qa` or `/qa-only`
- Code review / diff check → `/review`
- Visual polish → `/design-review`
- Ship / deploy / PR → `/ship` or `/land-and-deploy`
- Save progress → `/context-save`
- Resume context → `/context-restore`
