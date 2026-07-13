# Contributing to openllmrank

Thanks for considering a contribution. The most valuable contributions right now are grounded-provider improvements, new grounded adapters, and bug reports from real-world usage.

## Setup

```bash
git clone https://github.com/foodaka/openllmrank.git
cd openllmrank
bun install
bun test       # 100+ tests; should all pass
bun run typecheck
```

## Adding a new provider adapter

Provider adapters share a small registry and HTTP error-normalization layer, so a complete contribution usually touches the adapter, registry, and tests.

**1. Implement the `Provider` interface** in `packages/cli/src/providers/<name>.ts`. The interface lives in `packages/cli/src/core/types.ts`:

```typescript
interface Provider {
  id: ProviderId;
  query(args: ProviderQueryArgs): Promise<ProviderResult>;
}
```

Your adapter must:

- Call the provider's grounded/search-enabled API (NOT plain chat completions — we need real citations, not training-data hallucinations).
- Translate provider-specific errors to a normalized `ProviderError` with `kind` in `'transient' | 'rate_limit' | 'auth' | 'bad_request' | 'unknown'`. The runner uses `kind` to decide retry behavior; misclassifying a quota error as `rate_limit` will cause useless retries.
- Detect "quota / billing / no credit" errors specifically and classify them as `auth` (terminal), not `rate_limit` (retryable).
- Capture the provider's request ID (header or message body) into the error message so users can quote it to support.
- Return structured `search_results` (URLs + titles + snippets) so the citation parser can detect grounded mentions.
- Estimate `cost_usd` per call from token counts plus any per-search fee.

Reference implementations: `packages/cli/src/providers/openai.ts` (Responses API), `anthropic.ts` (Messages API), and the HTTP adapters for Gemini, Perplexity, and xAI. Reuse `packages/cli/src/providers/http.ts` for normalized HTTP errors.

**2. Register the adapter** in `packages/cli/src/providers/registry.ts` with its environment variable, default model, supported models, capabilities, and factory.

**3. Add fixture tests** in `packages/cli/test/<name>.test.ts`. Mirror the existing provider test files. At minimum:

- Happy-path text extraction
- Search-results / citations extraction
- Each error class (401 → auth, 429 → rate_limit, 5xx → transient, 4xx → bad_request, quota → auth)
- Request ID capture from headers and message body

**4. Update the README** to mention the new provider in the Status section.

A complete provider PR is typically 200-300 lines (adapter + tests). The OpenAI adapter is a good size reference at ~190 lines.

## Bug reports

The most useful bug reports include:

- Output of `openllmrank --help` and `bun --version`
- The exact command that failed
- Relevant rows from the SQLite DB (or the error message)
- A snippet of the response_text that triggered the issue (sanitize keys / sensitive data)

For citation parser bugs (false positives or misses), please open an issue with the exact text snippet and expected match. We'll add it to the fixture suite.

## Code style

- TypeScript strict mode is on; please don't use `any`. `unknown` + narrowing is fine.
- Two-space indent. Trailing commas. The existing code is the style guide.
- New code paths should have tests. The test suite uses `bun test`.
- Prefer Bun built-ins (`bun:sqlite`, `Bun.spawn`, etc.) when available; we want to keep the dependency footprint small.

## What we won't merge

- Adapters that use plain chat completions instead of grounded/search-enabled APIs. The product's correctness depends on real citations.
- Headless-browser dependencies (Playwright, Puppeteer). The scraper is intentionally HTTP-only to keep the install lightweight.
- Telemetry that phones home by default. Opt-in only, if at all.
- Features that require a backend service. v0 is local-only by design.

## Releases

Maintainers cut releases by:

1. Bumping `version` in `packages/cli/package.json`
2. Updating `packages/cli/CHANGELOG.md`
3. `git tag vX.Y.Z && git push origin vX.Y.Z`
4. `npm publish --access public` (requires 2FA)
