import { z } from "zod";
import {
  HOSTED_CAPS,
  HOSTED_REPORT_PROVIDERS,
  HostedConfigSchema,
  type HostedConfig,
} from "@openllmrank/shared/config";
import {
  reportLinkSecret,
  signReportToken,
  signedReportUrl,
  verifyReportToken,
} from "@openllmrank/shared/report-token";
import { buildAgentReport, type AgentReport, type StoredRunMetrics } from "./agent-report";
import { loadReportData } from "./report-data";
import { provisionPaidReport, reportPriceCents } from "./report-provisioning";
import {
  chargeSharedPaymentToken,
  createCheckoutSession,
  refundPaymentIntent,
} from "./stripe";
import { serviceClient } from "./supabase-server";
import {
  normalizeWebsite,
  suggestFromWebsite,
  SuggestionError,
} from "./website-suggestions";

// What an external AI agent can do with openllmrank, as plain functions.
// No protocol in here: app/api/mcp/route.ts binds these to MCP tools, and a
// REST or OpenAPI binding could sit beside it without touching this file.
//
//   discoverQuestions   website -> buyer questions            (free)
//   createOrder         brand + competitors -> priced order   (free, no job yet)
//   payForOrder         order + Shared Payment Token -> paid job
//   getStatus           order/report id -> queued | running | completed | failed
//   getReport           report id -> compact structured results
//
// Every write reuses the wizard's machinery: the order is a `leads` row, the
// paid job comes from provisionPaidReport (same as the Stripe webhook), the
// worker runs it unchanged, failures refund through the worker refunder.
//
// Access: there are no accounts on this surface. createOrder returns an
// access_token (the report-link HMAC) and every later call must present it
// with the id it was issued for, so knowing or guessing an id grants nothing.

export type AgentErrorCode =
  | "INVALID_INPUT"
  | "WEBSITE_UNREADABLE"
  | "ACCESS_DENIED"
  | "PAYMENT_DECLINED"
  | "PAYMENT_TOKEN_INVALID"
  | "PAYMENT_UNAVAILABLE"
  | "REPORT_NOT_READY"
  | "REPORT_FAILED"
  | "RATE_LIMITED"
  | "INTERNAL";

/** `recoverable` tells the calling agent whether changing the input or retrying can help. */
export class AgentError extends Error {
  constructor(
    public code: AgentErrorCode,
    message: string,
    public recoverable: boolean,
  ) {
    super(message);
  }
}

export type AgentDeps = {
  supabase: ReturnType<typeof serviceClient>;
  siteOrigin: string;
  suggest: typeof suggestFromWebsite;
  charge: typeof chargeSharedPaymentToken;
  refund: typeof refundPaymentIntent;
  createCheckout: typeof createCheckoutSession;
};

export function defaultAgentDeps(siteOrigin: string): AgentDeps {
  let supabase: ReturnType<typeof serviceClient> | undefined;
  return {
    // Lazy: the MCP handshake and tools/list must not need database access.
    get supabase() {
      return (supabase ??= serviceClient());
    },
    siteOrigin,
    suggest: suggestFromWebsite,
    charge: chargeSharedPaymentToken,
    refund: refundPaymentIntent,
    createCheckout: createCheckoutSession,
  };
}

const TYPICAL_MINUTES = "10-15";
const POLL_AFTER_SECONDS = 60;
const ORDER_PREFIX = "order:";
const SOURCE = "mcp";

// ── discoverQuestions ───────────────────────────────────────────────────

export const DiscoverInput = z.object({
  website: z.string().min(1).max(2048),
});

export async function discoverQuestions(
  input: z.infer<typeof DiscoverInput>,
  deps: Pick<AgentDeps, "suggest">,
) {
  const suggestions = await suggestOrThrow(input.website, deps);
  return {
    brand: suggestions.name,
    category: suggestions.category,
    questions: suggestions.prompts,
  };
}

async function suggestOrThrow(website: string, deps: Pick<AgentDeps, "suggest">) {
  try {
    return await deps.suggest(normalizeWebsite(website));
  } catch (e) {
    if (e instanceof SuggestionError) {
      throw new AgentError(
        e.status === 400 ? "INVALID_INPUT" : "WEBSITE_UNREADABLE",
        e.message,
        true,
      );
    }
    throw e;
  }
}

// ── createOrder ─────────────────────────────────────────────────────────

const Name = z.string().trim().min(1).max(120);

export const OrderInput = z.object({
  brand: Name,
  website: z.string().min(1).max(2048),
  competitors: z.array(Name).min(1).max(10),
  email: z.string().trim().email().max(254),
  brand_aliases: z.array(Name).max(10).optional(),
  category: z.string().trim().min(2).max(120).optional(),
  questions: z
    .array(z.string().trim().min(10).max(300))
    .min(1)
    .max(HOSTED_CAPS.max_prompts)
    .optional(),
});

export async function createOrder(input: z.infer<typeof OrderInput>, deps: AgentDeps) {
  let website: string;
  try {
    website = normalizeWebsite(input.website);
  } catch (e) {
    throw new AgentError("INVALID_INPUT", (e as Error).message, true);
  }

  // No questions supplied: draft them from the website, exactly as the
  // wizard's "AI website draft" does.
  let questions = input.questions;
  let category = input.category;
  if (!questions) {
    const drafted = await suggestOrThrow(website, deps);
    questions = drafted.prompts;
    category ??= drafted.category;
  }

  const parsed = HostedConfigSchema.safeParse({
    brand: {
      name: input.brand,
      aliases: input.brand_aliases ?? [],
      website,
      ...(category ? { category } : {}),
    },
    competitors: input.competitors.map((name) => ({ name, aliases: [] })),
    prompts: questions,
    // The provider lineup is a product decision, never caller input.
    providers: HOSTED_REPORT_PROVIDERS.map((p) => ({ ...p })),
    samples_per_prompt: 3,
    concurrency_per_provider: 4,
  });
  if (!parsed.success) {
    throw new AgentError(
      "INVALID_INPUT",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      true,
    );
  }
  const config = parsed.data;
  const email = input.email.toLowerCase();

  const { data: lead, error: leadErr } = await deps.supabase
    .from("leads")
    .insert({
      email,
      brand_name: config.brand.name,
      competitor_count: config.competitors.length,
      prompt_count: config.prompts.length,
      config_jsonb: config,
      source: SOURCE,
      status: "started",
    })
    .select("id")
    .single();
  if (leadErr || !lead) {
    console.error("[agent] could not record order", leadErr?.message);
    throw new AgentError("INTERNAL", "Could not create the order. Try again.", true);
  }

  // Fallback for agents without a payment wallet: a normal Stripe Checkout
  // page for the same order. The webhook provisions it like any wizard order.
  const amountCents = reportPriceCents();
  let checkoutUrl: string | null = null;
  try {
    const session = await deps.createCheckout({
      amountCents,
      currency: "usd",
      productName: process.env.PRODUCT_NAME ?? "openllmrank report",
      leadId: lead.id,
      email,
      successUrl: `${deps.siteOrigin}/checkout/success`,
      cancelUrl: `${deps.siteOrigin}/checkout/cancel`,
    });
    checkoutUrl = session.url;
    await deps.supabase
      .from("leads")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", lead.id);
  } catch (e) {
    console.error("[agent] checkout session failed", (e as Error).message);
  }

  return {
    status: "awaiting_payment" as const,
    order_id: lead.id as string,
    access_token: signReportToken(`${ORDER_PREFIX}${lead.id}`, reportLinkSecret()),
    price: { amount: amountCents, currency: "usd" },
    brand: config.brand.name,
    competitors: config.competitors.map((c) => c.name),
    questions: config.prompts,
    assistants: config.providers.map((p) => p.id),
    delivery: `Results in about ${TYPICAL_MINUTES} minutes after payment; the full report is also emailed to ${email}.`,
    checkout_url: checkoutUrl,
    next_step:
      "Confirm the price and questions with the user. Then call pay_for_report with a Stripe Shared Payment Token for exactly this amount, or have the user pay at checkout_url.",
  };
}

// ── payForOrder ─────────────────────────────────────────────────────────

export const PayInput = z.object({
  order_id: z.string().uuid(),
  access_token: z.string().min(1).max(512),
  payment_token: z.string().min(1).max(256),
});

type LeadRow = {
  id: string;
  email: string;
  config_jsonb: unknown;
  status: string;
  job_id: string | null;
};

function assertAccess(id: string, token: string, kind: "order" | "report"): void {
  const claims = verifyReportToken(token, reportLinkSecret());
  const expected = kind === "order" ? `${ORDER_PREFIX}${id}` : id;
  // One answer for a bad token and an unknown id, so ids cannot be probed.
  if (!claims || claims.jobId !== expected) {
    throw new AgentError(
      "ACCESS_DENIED",
      "That id and access_token do not match. Use the pair returned when the order was created.",
      false,
    );
  }
}

async function loadLead(deps: AgentDeps, orderId: string): Promise<LeadRow> {
  const { data } = await deps.supabase
    .from("leads")
    .select("id,email,config_jsonb,status,job_id")
    .eq("id", orderId)
    .eq("source", SOURCE)
    .maybeSingle();
  if (!data) {
    throw new AgentError("ACCESS_DENIED", "That order does not exist.", false);
  }
  return data as LeadRow;
}

function reportHandle(deps: AgentDeps, jobId: string) {
  const secret = reportLinkSecret();
  return {
    report_id: jobId,
    access_token: signReportToken(jobId, secret),
    report_url: signedReportUrl(deps.siteOrigin, jobId, secret),
  };
}

export async function payForOrder(input: z.infer<typeof PayInput>, deps: AgentDeps) {
  assertAccess(input.order_id, input.access_token, "order");
  const lead = await loadLead(deps, input.order_id);

  const started = (jobId: string, alreadyPaid: boolean) => ({
    status: "queued" as const,
    already_paid: alreadyPaid,
    ...reportHandle(deps, jobId),
    poll_after_seconds: POLL_AFTER_SECONDS,
    next_step: `The analysis is running (about ${TYPICAL_MINUTES} minutes). Call get_report_status with report_id and this new access_token, then get_visibility_report once it is completed.`,
  });

  // Paid already (a retry, or the user used checkout_url). Never charge twice.
  if (lead.status === "converted" && lead.job_id) return started(lead.job_id, true);

  const parsedConfig = HostedConfigSchema.safeParse(lead.config_jsonb);
  if (!parsedConfig.success) {
    throw new AgentError("INTERNAL", "The stored order could not be read. Create a new order.", true);
  }
  const config: HostedConfig = parsedConfig.data;
  const amountCents = reportPriceCents();

  const charge = await deps.charge({
    token: input.payment_token,
    amountCents,
    currency: "usd",
    description: `openllmrank AI visibility report: ${config.brand.name}`,
    receiptEmail: lead.email,
    metadata: { lead_id: lead.id, source: SOURCE },
  });
  if (!charge.ok) {
    const code =
      charge.code === "payment_declined"
        ? "PAYMENT_DECLINED"
        : charge.code === "payment_token_invalid"
          ? "PAYMENT_TOKEN_INVALID"
          : "PAYMENT_UNAVAILABLE";
    // A fresh token (or a retry, for an outage) can fix all three.
    throw new AgentError(code, charge.message, true);
  }

  const provisioned = await provisionPaidReport(deps.supabase, {
    email: lead.email,
    config,
    amountCents,
    source: SOURCE,
    stripePaymentIntentId: charge.paymentIntentId,
  });

  let jobId: string;
  if (provisioned.ok) {
    jobId = provisioned.jobId;
  } else if (provisioned.duplicate) {
    // Same PaymentIntent (the charge is idempotent per token): a concurrent
    // retry already created the job. Hand back that job.
    const { data: existing } = await deps.supabase
      .from("jobs")
      .select("id")
      .eq("stripe_payment_intent_id", charge.paymentIntentId)
      .maybeSingle();
    if (!existing) {
      throw new AgentError("INTERNAL", "Payment succeeded but the report could not be located. Use the contact form on openllmrank.io.", false);
    }
    return started(existing.id as string, true);
  } else {
    // Money taken, no job: give it back now rather than leave it for a human.
    console.error("[agent] provisioning failed after payment", provisioned);
    const refunded = await deps.refund(charge.paymentIntentId);
    throw new AgentError(
      "INTERNAL",
      refunded
        ? "The report could not be started, so the payment was refunded. Try again with a new payment token."
        : "The report could not be started and the automatic refund did not go through. Use the contact form on openllmrank.io for a refund.",
      refunded,
    );
  }

  await deps.supabase
    .from("leads")
    .update({ status: "converted", job_id: jobId, converted_at: new Date().toISOString() })
    .eq("id", lead.id);

  return started(jobId, false);
}

// ── getStatus / getReport ───────────────────────────────────────────────

export const ReportRefInput = z.object({
  report_id: z.string().uuid(),
  access_token: z.string().min(1).max(512),
});

type JobRow = {
  id: string;
  user_id: string;
  status: string;
  config_jsonb: unknown;
  cli_run_id: string | null;
  failed_count: number | null;
};

const STATUS_FOR_AGENTS: Record<string, "queued" | "running" | "completed" | "failed"> = {
  pending: "queued",
  paid: "queued",
  running: "running",
  completed: "completed",
  failed: "failed",
};

function tokenKind(id: string, token: string): "order" | "report" {
  const claims = verifyReportToken(token, reportLinkSecret());
  return claims?.jobId === `${ORDER_PREFIX}${id}` ? "order" : "report";
}

async function loadJob(deps: AgentDeps, jobId: string): Promise<JobRow> {
  const { data } = await deps.supabase
    .from("jobs")
    .select("id,user_id,status,config_jsonb,cli_run_id,failed_count")
    .eq("id", jobId)
    .maybeSingle();
  if (!data) throw new AgentError("ACCESS_DENIED", "That report does not exist.", false);
  return data as JobRow;
}

/** Accepts a report id, or an order id (so an agent can wait on checkout_url payment). */
export async function getStatus(input: z.infer<typeof ReportRefInput>, deps: AgentDeps) {
  const kind = tokenKind(input.report_id, input.access_token);
  assertAccess(input.report_id, input.access_token, kind);

  let jobId = input.report_id;
  let handle: ReturnType<typeof reportHandle> | undefined;
  if (kind === "order") {
    const lead = await loadLead(deps, input.report_id);
    if (!lead.job_id) {
      return {
        status: "awaiting_payment" as const,
        next_step: "Payment has not been received. Call pay_for_report, or have the user finish paying at checkout_url.",
      };
    }
    jobId = lead.job_id;
    handle = reportHandle(deps, jobId);
  }

  const job = await loadJob(deps, jobId);
  const status = STATUS_FOR_AGENTS[job.status] ?? "queued";
  return {
    status,
    // An order id resolves to its report: use these from now on.
    ...(handle ?? { report_id: jobId }),
    ...(status === "queued" || status === "running"
      ? { poll_after_seconds: POLL_AFTER_SECONDS, typical_duration_minutes: TYPICAL_MINUTES }
      : {}),
    ...(status === "completed" ? { next_step: "Call get_visibility_report for the results." } : {}),
    ...(status === "failed"
      ? { next_step: "The analysis failed and the payment is refunded automatically. A new order can be created." }
      : {}),
  };
}

export async function getReport(
  input: z.infer<typeof ReportRefInput>,
  deps: AgentDeps,
): Promise<AgentReport> {
  assertAccess(input.report_id, input.access_token, "report");
  const job = await loadJob(deps, input.report_id);

  if (job.status === "failed") {
    throw new AgentError("REPORT_FAILED", "This analysis failed; the payment is refunded automatically.", false);
  }
  if (job.status !== "completed" || !job.cli_run_id) {
    throw new AgentError(
      "REPORT_NOT_READY",
      `The analysis is still running. Check get_report_status again in ${POLL_AFTER_SECONDS} seconds.`,
      true,
    );
  }

  const data = await loadReportData(deps.supabase, job);
  const { data: metrics } = await deps.supabase
    .from("run_metrics")
    .select("own_citation_rate,share_of_voice,samples_total,per_provider_jsonb,per_competitor_jsonb")
    .eq("job_id", job.id)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return buildAgentReport({
    data,
    metrics: metrics ? toStoredMetrics(metrics as Record<string, unknown>) : null,
    failedCalls: job.failed_count ?? 0,
    reportUrl: signedReportUrl(deps.siteOrigin, job.id, reportLinkSecret()),
  });
}

// numeric columns arrive from PostgREST as strings.
function toStoredMetrics(row: Record<string, unknown>): StoredRunMetrics {
  return {
    own_citation_rate: Number(row.own_citation_rate),
    share_of_voice: Number(row.share_of_voice),
    samples_total: Number(row.samples_total),
    per_provider_jsonb: (row.per_provider_jsonb ?? {}) as Record<string, number>,
    per_competitor_jsonb: (row.per_competitor_jsonb ?? []) as { name: string; rate: number }[],
  };
}
