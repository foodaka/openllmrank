# Changelog

All notable changes to openllmrank are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `openllmrank run --output-json` flag. When set, stdout emits a single structured JSON object on success (`{"status":"ok","run_id":...,"succeeded":N,"failed":N,"cost_usd_total":N,"aborted":false}`) and a structured error object on failure (`{"status":"error","code":"CONFIG_NOT_FOUND"|"CONFIG_INVALID_JSON"|"CONFIG_SCHEMA_FAIL"|"PROVIDER_AUTH"|"PROVIDER_UNSUPPORTED"|"BAD_ARG"|...,"message":"...","detail":...}`). All human output goes to stderr; the progress bar is silenced. Useful for scripting and integration with hosted environments.
- `openllmrank run --config-from-stdin` flag. Reads the JSON config from stdin instead of `openllmrank.config.json`. Combine with `--output-json` for a programmatic interface.
- Both flags are non-breaking. Default behavior (human progress bar, file-based config) is unchanged.

### Changed

- Repository is now a Bun-workspace monorepo. The npm package `openllmrank` lives in `packages/cli`. Shared schemas live in `packages/shared` (private). No user-facing change for npm consumers.

## [0.2.0] - 2026-05-06

### Added
- **Anthropic provider adapter** (`claude-haiku-4-5` etc.) using the Messages API with the `web_search_20250305` tool. Returns real citations, not training-data hallucinations.
- **Robots.txt respect** in the scraper used by `openllmrank suggest`. The scraper checks `/robots.txt` on the target domain (cached per-origin) and skips disallowed paths with a clear "blocked by robots.txt" reason. Override with `respectRobots: false` in code if you need it.
- Tests for the Anthropic adapter (9 tests) and robots.txt enforcement (4 tests).

### Changed
- The starter config from `openllmrank init` now includes a commented-out Anthropic provider entry, so users can enable it with one uncomment.
- The `.env.example` template now includes `ANTHROPIC_API_KEY` alongside `OPENAI_API_KEY`.
- README headline tightened to mention only OpenAI + Anthropic as v0.2 providers (Gemini, Perplexity still listed as "coming").

### Fixed
- Anthropic SDK uses `Headers` (not plain object) for `err.headers`. The request-ID extractor now handles both Headers instances and plain object headers.

## [0.1.0] - 2026-05-06

### Added
- **`openllmrank suggest`** command. After a `run`, fetches the winning competitor's cited URL and the user's brand URL via plain HTTP, extracts main content with cheerio (no headless browser), and asks GPT to produce a structured content-gap analysis with 3-5 specific recommendations. Cost: ~$0.005 per losing prompt analyzed.
- `openllmrank run --retry-failed` re-queries just the failed rows from the latest run (cheaper than a full re-run when you've recovered from a transient outage).

### Changed
- 500-retry budget bumped from 3 to 5 attempts. Sustained OpenAI 500s often recover within ~30s; we were giving up after ~10s of backoff.
- 429 errors with quota/billing messages are now classified as `auth` (terminal) instead of `rate_limit` (retryable). No more useless retries on hard quota errors.

### Fixed
- OpenAI request IDs (from `x-request-id` header or `req_xxx` in the message body) are captured in `error_message` so users can quote them to OpenAI support.

## [0.0.1] - 2026-05-06

### Added
- Initial public release.
- `openllmrank init` writes a starter `openllmrank.config.json` and `.env.example`.
- `openllmrank run` queries each prompt × provider × N samples against the OpenAI Responses API with the `web_search` tool. Persists results to SQLite at `./data/openllmrank.db` with content-addressed `prompt_id` (sha256 of prompt + model + provider + config) so resumability survives prompt edits.
- `openllmrank run --resume` resumes the latest unfinished run.
- `openllmrank report` emits a markdown gap-analysis from the rolling 7-day window.
- `openllmrank export --since 7d` emits raw calls + citations as NDJSON.
- Strict whole-word + URL substring citation parsing with longest-alias-first precedence; 25-case fixture suite.
- Normalized `ProviderError` shape; central retry policy in `runner.ts`.
- 73 tests across citations, gap analysis, runner orchestration, OpenAI adapter, DB schema, and CLI surface.
- MIT licensed.

### Known limitations
- v0 supports OpenAI only. Anthropic, Gemini, Perplexity arrive in subsequent releases.
- The scraper used by `openllmrank suggest` is HTTP-only; JS-rendered single-page applications may not yield extractable content. The tool detects this case and skips with a clear note rather than failing.
- Bun >= 1.3 is required. Node is not currently supported.
