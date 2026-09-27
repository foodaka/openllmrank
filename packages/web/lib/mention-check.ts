// Server-side helpers for the free "Does AI mention you?" check.
//
// Every check spends real money (a grounded call per assistant), so submit
// enforces three durable limits, all counted in Postgres (Vercel runs many
// instances; the in-memory limiter in the route is only a burst brake):
//
//   per requester   CHECKS_PER_IP_PER_DAY, by salted ip hash
//   global spend    MENTION_CHECK_DAILY_BUDGET_USD (default $10), rolling 24h:
//                   real cost of finished checks + an estimate for checks
//                   still queued or running. 0 turns the tool off.
//   answer cache    the worker reuses a question's answers for 24h, so a
//                   popular question costs once (mention_answers).
//
// The row id is the requester's access token: unguessable, never listed.

import { domainInputToOrigin } from "@openllmrank/crawl";
import {
  MENTION_CHECK_ESTIMATED_COST_USD,
  MENTION_CHECK_PROVIDERS,
  MENTION_TERMINAL_STATES,
  MentionResultsSchema,
  normalizeQuestion,
  type MentionResults,
  type MentionState,
} from "@openllmrank/shared/mention-check";
import { z } from "zod";
// Relative imports (not "@/lib/..."): type-checked from the root tsconfig
// via packages/web/test/, which has no "@/" alias.
import { hashIp } from "./crawl-check";
import { serviceClient } from "./supabase-server";

export const CHECKS_PER_IP_PER_DAY = 3;
const DEFAULT_DAILY_BUDGET_USD = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export const MentionCheckInput = z.object({
  brand: z.string().trim().min(1, "Enter your brand name.").max(120),
  website: z.string().trim().min(1, "Enter your website.").max(300),
  question: z
    .string()
    .transform(normalizeQuestion)
    .pipe(
      z
        .string()
        .min(10, "Write the question the way a buyer would ask it (at least 10 characters).")
        .max(300, "Keep the question under 300 characters."),
    ),
});

export function dailyBudgetUsd(): number {
  const raw = process.env.MENTION_CHECK_DAILY_BUDGET_USD;
  if (raw === undefined || raw === "") return DEFAULT_DAILY_BUDGET_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_BUDGET_USD;
}

function sinceIso(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

async function checksToday(ipHash: string): Promise<number> {
  const { count, error } = await serviceClient()
    .from("mention_checks")
    .select("id", { count: "exact", head: true })
    .eq("requester_ip_hash", ipHash)
    .gte("created_at", sinceIso(DAY_MS));
  if (error) throw new Error(`quota query failed: ${error.message}`);
  return count ?? 0;
}

/** Real spend of the last 24h plus a reservation for unfinished checks. */
export async function spendTodayUsd(): Promise<number> {
  const { data, error } = await serviceClient()
    .from("mention_checks")
    .select("state,cost_usd")
    .gte("created_at", sinceIso(DAY_MS))
    .limit(10_000);
  if (error) throw new Error(`budget query failed: ${error.message}`);
  let total = 0;
  for (const row of (data ?? []) as { state: string; cost_usd: string | number }[]) {
    const finished = (MENTION_TERMINAL_STATES as readonly string[]).includes(row.state);
    // numeric arrives from PostgREST as a string.
    total += finished ? Number(row.cost_usd) : Math.max(Number(row.cost_usd), MENTION_CHECK_ESTIMATED_COST_USD);
  }
  return total;
}

export type SubmitMentionCheckResult =
  | { ok: true; token: string }
  | { ok: false; status: 400 | 429 | 503; error: string };

export async function submitMentionCheck(args: {
  input: z.infer<typeof MentionCheckInput>;
  ip: string;
}): Promise<SubmitMentionCheckResult> {
  const origin = domainInputToOrigin(args.input.website);
  if (!origin) {
    return { ok: false, status: 400, error: "That doesn't look like a public website domain." };
  }
  const domain = new URL(origin).hostname.replace(/^www\./, "");

  const budget = dailyBudgetUsd();
  if (budget <= 0) {
    return { ok: false, status: 503, error: "The free check is paused right now. Please try again later." };
  }

  const ipHash = hashIp(args.ip);
  const [used, spent] = await Promise.all([checksToday(ipHash), spendTodayUsd()]);
  if (used >= CHECKS_PER_IP_PER_DAY) {
    return {
      ok: false,
      status: 429,
      error: `You've used your ${CHECKS_PER_IP_PER_DAY} free checks for today. Try again tomorrow, or get the full report.`,
    };
  }
  if (spent + MENTION_CHECK_ESTIMATED_COST_USD > budget) {
    return {
      ok: false,
      status: 503,
      error: "Today's free checks are used up. Please try again tomorrow.",
    };
  }

  const { data, error } = await serviceClient()
    .from("mention_checks")
    .insert({
      brand_name: args.input.brand,
      website: origin,
      domain,
      question: args.input.question,
      providers_jsonb: MENTION_CHECK_PROVIDERS,
      requester_ip_hash: ipHash,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insert mention check failed: ${error?.message}`);
  return { ok: true, token: (data as { id: string }).id };
}

export type MentionCheckView = {
  brand: string;
  domain: string;
  question: string;
  state: MentionState;
  results: MentionResults | null;
  failure_reason: string | null;
  created_at: string;
};

export type ReadMentionCheckResult =
  | { ok: true; check: MentionCheckView }
  | { ok: false; status: 404 | 500; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readMentionCheck(token: string): Promise<ReadMentionCheckResult> {
  if (!UUID_RE.test(token)) return { ok: false, status: 404, error: "Not found" };
  const { data, error } = await serviceClient()
    .from("mention_checks")
    .select("brand_name,domain,question,state,results_jsonb,failure_reason,created_at")
    .eq("id", token)
    .maybeSingle();
  if (error) throw new Error(`mention check lookup failed: ${error.message}`);
  if (!data) return { ok: false, status: 404, error: "Not found" };

  const row = data as {
    brand_name: string;
    domain: string;
    question: string;
    state: MentionState;
    results_jsonb: unknown;
    failure_reason: string | null;
    created_at: string;
  };
  let results: MentionResults | null = null;
  if (row.results_jsonb !== null && row.results_jsonb !== undefined) {
    // Validated, not cast: schema drift is a loud 500, never a wrong verdict.
    const parsed = MentionResultsSchema.safeParse(row.results_jsonb);
    if (!parsed.success) {
      return { ok: false, status: 500, error: "Stored results do not match their schema" };
    }
    results = parsed.data;
  }
  return {
    ok: true,
    check: {
      brand: row.brand_name,
      domain: row.domain,
      question: row.question,
      state: row.state,
      results,
      failure_reason: row.failure_reason,
      created_at: row.created_at,
    },
  };
}
