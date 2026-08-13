#!/usr/bin/env bun
/**
 * Seeds the LOCAL Supabase stack with a realistic multi-brand tracking
 * account, so the dashboard prototype renders against real rows through real
 * RLS policies rather than hardcoded fixtures. See SPEC-DASHBOARD.md.
 *
 * Deliberately covers all three dashboard states at once:
 *
 *   Linear   11 weekly runs, rising 18% -> 41%   -> the full trend view
 *   Cal.com   8 weekly runs, flat with a dip     -> a "down" standfirst
 *   Resend    1 run only                         -> the single-run state
 *
 * Three brands also puts the account OVER SCHEDULER_WEEKLY_MAX_BRANDS (2),
 * so the D12 cadence throttle is visible in the UI: all brands sit at
 * 'monthly', not 'weekly'.
 *
 * Refuses to run against anything but 127.0.0.1 / localhost.
 *
 *   bun run --cwd packages/web seed:demo
 */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54331";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error(
    "Missing SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run with: bun run --cwd packages/web seed:demo",
  );
  process.exit(1);
}

// Guardrail: this script deletes and rewrites a user's rows. Never let it
// point at a hosted project by accident.
if (!/127\.0\.0\.1|localhost/.test(URL)) {
  console.error(`Refusing to seed a non-local Supabase URL: ${URL}`);
  process.exit(1);
}

const db = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

const DEMO_EMAIL = "demo@openllmrank.io";
const DEMO_PASSWORD = "demo-password-123";

const PROVIDERS = ["openai", "anthropic", "google", "perplexity", "xai"] as const;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type BrandSpec = {
  name: string;
  website: string;
  category: string;
  aliases: string[];
  competitors: string[];
  prompts: string[];
  /** One entry per run, oldest first. Own-brand citation rate 0..1. */
  curve: number[];
};

const BRANDS: BrandSpec[] = [
  {
    name: "Linear",
    website: "https://linear.app",
    category: "project management software",
    aliases: ["Linear.app"],
    competitors: ["Jira", "Asana", "Monday.com"],
    prompts: [
      "What is the best project management tool for software teams?",
      "Which issue tracker should a startup use?",
      "Best Jira alternatives for engineering teams",
      "What project management software has the best keyboard shortcuts?",
      "Which product roadmap tool integrates with GitHub?",
    ],
    // Rising: a brand whose AEO work is paying off.
    curve: [0.18, 0.19, 0.22, 0.21, 0.26, 0.29, 0.28, 0.33, 0.36, 0.38, 0.41],
  },
  {
    name: "Cal.com",
    website: "https://cal.com",
    category: "scheduling software",
    aliases: ["Cal", "Calcom"],
    competitors: ["Calendly", "SavvyCal"],
    prompts: [
      "What is the best open source Calendly alternative?",
      "Which scheduling tool has the best API?",
      "Best meeting scheduler for developers",
      "Self-hosted appointment scheduling software",
    ],
    // Flat with a mid-window dip: the "down from" standfirst path.
    curve: [0.31, 0.33, 0.30, 0.24, 0.22, 0.27, 0.29, 0.28],
  },
  {
    name: "Resend",
    website: "https://resend.com",
    category: "transactional email API",
    aliases: [],
    competitors: ["SendGrid", "Postmark", "Mailgun"],
    prompts: [
      "What is the best transactional email API for developers?",
      "Best SendGrid alternative for a React app",
      "Which email API has the best deliverability?",
    ],
    // Single run: exercises the "trend starts with run two" empty state.
    curve: [0.22],
  },
];

/** Deterministic pseudo-random in [0,1) so reseeding produces the same data. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

async function findOrCreateUser(): Promise<string> {
  const { data: created } = await db.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { source: "seed" },
  });
  if (created?.user) return created.user.id;

  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const match = list?.users.find((u) => u.email?.toLowerCase() === DEMO_EMAIL);
  if (!match) throw new Error("could not create or find the demo user");
  return match.id;
}

async function main() {
  console.log(`Seeding ${URL}`);

  const userId = await findOrCreateUser();
  console.log(`  user   ${DEMO_EMAIL} (${userId})`);

  // Idempotent: wipe this demo user's rows so reseeding is clean. Cascades
  // handle jobs -> runs -> run_metrics.
  await db.from("brands").delete().eq("user_id", userId);
  await db.from("subscriptions").delete().eq("user_id", userId);

  // Active $29/mo subscription (D8).
  const periodEnd = new Date(Date.now() + 18 * 24 * 60 * 60 * 1000);
  const { error: subErr } = await db.from("subscriptions").insert({
    user_id: userId,
    stripe_subscription_id: `sub_seed_${userId.slice(0, 8)}`,
    stripe_customer_id: `cus_seed_${userId.slice(0, 8)}`,
    status: "active",
    current_period_end: periodEnd.toISOString(),
    cancel_at_period_end: false,
  });
  if (subErr) throw new Error(`subscription: ${subErr.message}`);
  console.log(`  sub    active, renews ${periodEnd.toISOString().slice(0, 10)}`);

  // 3 brands > SCHEDULER_WEEKLY_MAX_BRANDS (2), so D12 throttles everyone
  // to monthly. The dashboard says so out loud rather than hiding it.
  const cadence = BRANDS.length > 2 ? "monthly" : "weekly";

  for (const [bIdx, spec] of BRANDS.entries()) {
    const runCount = spec.curve.length;
    const lastRunAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const nextRunAt = new Date(
      lastRunAt.getTime() + (cadence === "weekly" ? WEEK_MS : 30 * 24 * 60 * 60 * 1000),
    );

    const config = {
      brand: { name: spec.name, aliases: spec.aliases, website: spec.website, category: spec.category },
      competitors: spec.competitors.map((name) => ({ name, aliases: [] })),
      prompts: spec.prompts,
      providers: [
        { id: "openai", model: "gpt-5.4-mini" },
        { id: "anthropic", model: "claude-haiku-4-5" },
        { id: "google", model: "gemini-3.5-flash" },
        { id: "perplexity", model: "sonar" },
        { id: "xai", model: "grok-4.3" },
      ],
      samples_per_prompt: 3,
      concurrency_per_provider: 4,
    };

    const { data: brand, error: brandErr } = await db
      .from("brands")
      .insert({
        user_id: userId,
        name: spec.name,
        aliases: spec.aliases,
        website: spec.website,
        category: spec.category,
        config_jsonb: config,
        cadence,
        next_run_at: nextRunAt.toISOString(),
        last_run_at: lastRunAt.toISOString(),
      })
      .select("id")
      .single();
    if (brandErr || !brand) throw new Error(`brand ${spec.name}: ${brandErr?.message}`);

    const samplesTotal = spec.prompts.length * 3 * PROVIDERS.length;

    for (const [rIdx, ownRate] of spec.curve.entries()) {
      // Oldest run first; most recent lands 2 days ago.
      const weeksAgo = runCount - 1 - rIdx;
      const ranAt = new Date(lastRunAt.getTime() - weeksAgo * WEEK_MS);
      const finishedAt = new Date(ranAt.getTime() + 12 * 60 * 1000);

      // Run 0 is the original $29.99 purchase; the rest are subscription runs.
      // One manual re-run mid-history so the origin badge has something to show.
      const origin =
        rIdx === 0 ? "one_shot" : rIdx === Math.floor(runCount / 2) ? "manual" : "scheduled";

      const { data: job, error: jobErr } = await db
        .from("jobs")
        .insert({
          user_id: userId,
          brand_id: brand.id,
          status: "completed",
          email_status: "sent",
          refund_status: "not_required",
          origin,
          config_jsonb: config,
          amount_cents: origin === "one_shot" ? 2999 : 0,
          currency: "usd",
          email_to: DEMO_EMAIL,
          cli_run_id: `run_${bIdx}_${rIdx}`,
          succeeded_at: finishedAt.toISOString(),
          succeeded_count: samplesTotal,
          failed_count: 0,
          cost_usd_total: 2.28,
          created_at: ranAt.toISOString(),
          report_link_expires_at: new Date(
            finishedAt.getTime() + 90 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        })
        .select("id")
        .single();
      if (jobErr || !job) throw new Error(`job ${spec.name}#${rIdx}: ${jobErr?.message}`);

      const { data: run, error: runErr } = await db
        .from("runs")
        .insert({
          job_id: job.id,
          user_id: userId,
          brand_id: brand.id,
          cli_run_id: `run_${bIdx}_${rIdx}`,
          started_at: ranAt.toISOString(),
          finished_at: finishedAt.toISOString(),
          config_hash: `hash_${bIdx}_${rIdx}`,
        })
        .select("id")
        .single();
      if (runErr || !run) throw new Error(`run ${spec.name}#${rIdx}: ${runErr?.message}`);

      // Per-provider spread around the run's overall rate. Perplexity and
      // Gemini tend to cite more (they surface more sources); xAI least.
      const bias: Record<string, number> = {
        openai: 0.0,
        anthropic: -0.06,
        google: 0.09,
        perplexity: 0.12,
        xai: -0.11,
      };
      const perProvider: Record<string, number> = {};
      for (const [pIdx, p] of PROVIDERS.entries()) {
        const jitter = (rand(bIdx * 100 + rIdx * 10 + pIdx) - 0.5) * 0.06;
        perProvider[p] = Math.max(0, Math.min(1, Number((ownRate + bias[p]! + jitter).toFixed(5))));
      }

      // Competitors: the leader stays ahead but the gap narrows as the
      // brand's own rate climbs, which is the story the report tells.
      const perCompetitor = spec.competitors.map((name, cIdx) => {
        const base = cIdx === 0 ? 0.58 : cIdx === 1 ? 0.34 : 0.19;
        const drift = -0.02 * rIdx * (cIdx === 0 ? 1 : 0.3);
        const jitter = (rand(bIdx * 200 + rIdx * 20 + cIdx) - 0.5) * 0.05;
        return { name, rate: Math.max(0, Number((base + drift + jitter).toFixed(5))) };
      });

      const competitorSum = perCompetitor.reduce((a, c) => a + c.rate, 0);
      const shareOfVoice = ownRate / (ownRate + competitorSum || 1);

      // Worst gap: the single prompt where the leading competitor most
      // out-cites us. This is a PER-PROMPT number, not the run aggregate —
      // prompt-level variance is far wider than the average, so a brand that
      // leads on average still trails badly on its weakest question. Using
      // the aggregate here produced a nonsense "trail by 0 points".
      const gapPromptIdx = Math.floor(rand(bIdx * 300 + rIdx) * spec.prompts.length);
      const topCompetitorRate = Math.max(...perCompetitor.map((c) => c.rate));
      const promptSpread = 0.18 + rand(bIdx * 400 + rIdx) * 0.2;
      const worstPromptGap = topCompetitorRate - ownRate + promptSpread;

      const { error: metricErr } = await db.from("run_metrics").insert({
        run_id: run.id,
        user_id: userId,
        brand_id: brand.id,
        job_id: job.id,
        computed_at: finishedAt.toISOString(),
        own_citation_rate: Number(ownRate.toFixed(5)),
        share_of_voice: Number(shareOfVoice.toFixed(5)),
        samples_total: samplesTotal,
        per_provider_jsonb: perProvider,
        per_competitor_jsonb: perCompetitor,
        top_gap_prompt: spec.prompts[gapPromptIdx],
        top_gap_score: Number(Math.max(0, Math.min(1, worstPromptGap)).toFixed(5)),
      });
      if (metricErr) throw new Error(`run_metrics ${spec.name}#${rIdx}: ${metricErr.message}`);
    }

    console.log(
      `  brand  ${spec.name.padEnd(9)} ${runCount} run(s), ` +
        `${(spec.curve[0]! * 100).toFixed(0)}% -> ${(spec.curve.at(-1)! * 100).toFixed(0)}%, cadence=${cadence}`,
    );
  }

  console.log(`\nDone. Sign in at http://localhost:3000/login`);
  console.log(`  email     ${DEMO_EMAIL}`);
  console.log(`  password  ${DEMO_PASSWORD}`);
  if (cadence === "monthly") {
    console.log(
      `\nNote: ${BRANDS.length} brands exceeds SCHEDULER_WEEKLY_MAX_BRANDS=2,`,
    );
    console.log(`so the D12 throttle put every brand on monthly. The UI says so.`);
  }
}

main().catch((e) => {
  console.error(`\nSeed failed: ${(e as Error).message}`);
  process.exit(1);
});
