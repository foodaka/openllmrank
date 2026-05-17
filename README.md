# openllmrank — monorepo

This is the Bun-workspace monorepo for the openllmrank project.

## Packages

| Package | Path | Description | Visibility |
|---------|------|-------------|------------|
| `openllmrank` | [`packages/cli`](./packages/cli) | The open-source CLI. Tracks how your brand appears in answers from ChatGPT and Claude. Published to npm. | Public, MIT |
| `@openllmrank/shared` | `packages/shared` | Shared Zod schemas and types used by the CLI and the hosted webapp. | Private |

## Quick start (CLI users)

See [`packages/cli/README.md`](./packages/cli/README.md). The short version:

```bash
bun install -g openllmrank
openllmrank init
openllmrank run
openllmrank report --html
```

## Working in this repo

```bash
bun install         # install all workspaces (single lockfile at root)
bun test            # run all tests across all packages
bun run typecheck   # typecheck across all packages
```

Test framework is `bun:test` everywhere; tests live in `packages/*/test/`.

## License

MIT — see [LICENSE](./LICENSE).
