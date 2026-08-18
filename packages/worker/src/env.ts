// Worker environment configuration. Lazily loaded on first access so that
// tests can import worker modules without DATABASE_URL being set.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnvFile(path = ".env.local"): void {
  // CWD first (deployed layout), then package-relative — so tests invoked
  // from the repo root (`bun test`, the documented flow) still find
  // packages/worker/.env.local instead of failing on missing DATABASE_URL.
  const resolved = existsSync(path) ? path : join(import.meta.dir, "..", path);
  if (!existsSync(resolved)) return;
  const content = readFileSync(resolved, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile();

type EnvShape = {
  databaseUrl: string;
  openaiKey: string;
  anthropicKey: string;
  googleKey: string;
  perplexityKey: string;
  xaiKey: string;
  stripeMode: "local_stub" | "test" | "live";
  stripeSecretKey: string;
  postmarkMode: "local_stub" | "live";
  postmarkToken: string;
  postmarkFrom: string;
  postmarkFromName: string;
  postmarkReplyTo: string;
  reportBaseUrl: string;
  workerId: string;
  pollIntervalMs: number;
  crawlPollIntervalMs: number;
  monitorPortalUrl: string;
  leaseTimeoutMs: number;
  cliRunTimeoutMs: number;
  adminWebhook: string;
};

let _env: EnvShape | null = null;

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var: ${name}. Copy packages/worker/.env.example to .env.local and fill it in.`,
    );
  }
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got '${raw}'.`);
  }
  return n;
}

function build(): EnvShape {
  return {
    databaseUrl: required("DATABASE_URL"),
    openaiKey: optional("OPENAI_API_KEY"),
    anthropicKey: optional("ANTHROPIC_API_KEY"),
    googleKey: optional("GOOGLE_API_KEY"),
    perplexityKey: optional("PERPLEXITY_API_KEY"),
    xaiKey: optional("XAI_API_KEY"),
    stripeMode: optional("STRIPE_MODE", "local_stub") as
      | "local_stub"
      | "test"
      | "live",
    stripeSecretKey: optional("STRIPE_SECRET_KEY"),
    postmarkMode: optional("POSTMARK_MODE", "local_stub") as
      | "local_stub"
      | "live",
    postmarkToken: optional("POSTMARK_SERVER_TOKEN"),
    postmarkFrom: optional("POSTMARK_FROM", "report@openllmrank.io"),
    postmarkFromName: optional("POSTMARK_FROM_NAME", "openllmrank"),
    postmarkReplyTo: optional("POSTMARK_REPLY_TO"),
    reportBaseUrl: optional(
      "REPORT_BASE_URL",
      optional("NEXT_PUBLIC_SITE_ORIGIN", "http://localhost:3000"),
    ),
    workerId: optional("WORKER_ID", `worker-${process.pid}`),
    pollIntervalMs: int("WORKER_POLL_INTERVAL_MS", 5000),
    // Faster than the paid poll: the report page promises first signal in
    // seconds, and claim latency is part of that budget (decision 6A).
    crawlPollIntervalMs: int("CRAWL_POLL_INTERVAL_MS", 1000),
    // Stripe no-code customer-portal login link (dashboard → Settings →
    // Billing → Customer portal). Empty in dev → emails fall back to mailto.
    monitorPortalUrl: optional("STRIPE_PORTAL_URL"),
    leaseTimeoutMs: int("WORKER_LEASE_TIMEOUT_MS", 30 * 60 * 1000),
    cliRunTimeoutMs: int("CLI_RUN_TIMEOUT_MS", 20 * 60 * 1000),
    adminWebhook: optional("ADMIN_ALERT_DISCORD_WEBHOOK"),
  };
}

// Proxy: validate lazily, exactly once. Modules can `import { env }` at the
// top of the file; nothing actually reads process.env until env.foo is
// accessed. This lets tests stub or skip without triggering validation.
export const env = new Proxy({} as EnvShape, {
  get(_target, prop) {
    if (!_env) _env = build();
    return _env[prop as keyof EnvShape];
  },
});

export function isStripeStub(): boolean {
  return env.stripeMode === "local_stub";
}

export function isPostmarkStub(): boolean {
  return env.postmarkMode === "local_stub";
}
