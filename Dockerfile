# Worker Dockerfile for Railway. Avoids Nixpacks' Node.js auto-detection
# (which currently tries to install Node 18.x EOL on every build because
# the workspace has Next.js as a dependency). Uses the official Bun image
# directly so the runtime matches local dev exactly.
#
# Build with: docker build -t openllmrank-worker .
# Run with:   docker run --env-file packages/worker/.env.local openllmrank-worker

FROM oven/bun:1.3.13-slim AS base

WORKDIR /app

# Copy lockfile + every workspace's package.json first to maximize Docker
# layer caching. Reinstalling deps only re-runs when these files change,
# not on every source-code edit.
COPY package.json bun.lock ./
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/crawl/package.json ./packages/crawl/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/web/package.json ./packages/web/package.json
COPY packages/worker/package.json ./packages/worker/package.json

# Install the entire workspace. --frozen-lockfile catches any drift
# between bun.lock and package.json files; the build fails loudly if
# they're out of sync.
RUN bun install --frozen-lockfile

# Now copy the actual source. Anything in .dockerignore is excluded.
COPY . .

# Worker runs as a long-lived process with no HTTP listener. Railway will
# restart on crash per railway.toml's restartPolicy.
CMD ["bun", "run", "packages/worker/src/index.ts"]
