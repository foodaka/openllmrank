import { NextResponse } from "next/server";
import { HostedConfigSchema } from "@openllmrank/shared/config";
// Relative imports: this route is imported by packages/web/test, which is
// type-checked from the root tsconfig without the "@/" alias.
import { serviceClient, userClient } from "../../../lib/supabase-server";
import { getRerunQuota } from "../../../lib/rerun-quota";

export const dynamic = "force-dynamic";

// Manual re-run (D9). The customer clicks "Re-run now" on a brand page.
//
//   session ──> brand is theirs (RLS) ──> subscription active ──> no run in
//   flight ──> quota left ──> insert job (service role, origin='manual')
//
// Every check happens against rows the RLS-scoped client can see; only the
// final insert uses the service role, because jobs has no client insert
// policy and amount_cents=0 rows must never be creatable from the browser.

type Outcome =
  | { ok: true; jobId: string }
  | { ok: false; status: number; code: string; message: string };

function wantsJson(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  const type = req.headers.get("content-type") ?? "";
  return accept.includes("application/json") || type.includes("application/json");
}

async function readBrandId(req: Request): Promise<string | null> {
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await req.json()) as { brand_id?: unknown };
      return typeof body.brand_id === "string" ? body.brand_id : null;
    }
    const form = await req.formData();
    const value = form.get("brand_id");
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const brandId = await readBrandId(req);
  const outcome = await requestRerun(brandId);
  const json = wantsJson(req);

  if (outcome.ok) {
    if (json) return NextResponse.json({ ok: true, job_id: outcome.jobId }, { status: 201 });
    return NextResponse.redirect(new URL(`/dashboard/${brandId}?queued=1`, req.url), 303);
  }

  if (json || !brandId || !UUID.test(brandId) || outcome.status === 401) {
    return NextResponse.json(
      { error: outcome.message, code: outcome.code },
      { status: outcome.status },
    );
  }
  return NextResponse.redirect(
    new URL(`/dashboard/${brandId}?rerun=${outcome.code}`, req.url),
    303,
  );
}

async function requestRerun(brandId: string | null): Promise<Outcome> {
  if (!brandId || !UUID.test(brandId)) {
    return { ok: false, status: 400, code: "bad_request", message: "brand_id is required" };
  }

  const supabase = await userClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { ok: false, status: 401, code: "unauthenticated", message: "Sign in to re-run" };
  }
  if (!user.email) {
    return { ok: false, status: 400, code: "no_email", message: "Your account has no email address" };
  }

  // RLS: another tenant's brand id returns no row. 404, not 403.
  const { data: brand, error: brandError } = await supabase
    .from("brands")
    .select("id,name,config_jsonb,archived_at")
    .eq("id", brandId)
    .maybeSingle();
  if (brandError) {
    return { ok: false, status: 500, code: "db", message: brandError.message };
  }
  if (!brand || brand.archived_at) {
    return { ok: false, status: 404, code: "not_found", message: "Brand not found" };
  }

  const { data: subscription, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select("id,status,current_period_end")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subscriptionError) {
    return { ok: false, status: 500, code: "db", message: subscriptionError.message };
  }
  if (!subscription) {
    return {
      ok: false,
      status: 402,
      code: "no_subscription",
      message: "Manual re-runs need an active subscription",
    };
  }

  const config = HostedConfigSchema.safeParse(brand.config_jsonb);
  if (!config.success) {
    return {
      ok: false,
      status: 400,
      code: "no_config",
      message: "This brand has no tracking configuration yet. Edit it in settings first.",
    };
  }

  const { count: inFlight, error: inFlightError } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId)
    .in("status", ["paid", "running"]);
  if (inFlightError) {
    return { ok: false, status: 500, code: "db", message: inFlightError.message };
  }
  if ((inFlight ?? 0) > 0) {
    return { ok: false, status: 409, code: "in_flight", message: "A run is already in progress" };
  }

  const quota = await getRerunQuota(supabase, subscription.current_period_end);
  if (quota.remaining <= 0) {
    return {
      ok: false,
      status: 429,
      code: "quota",
      message: `No manual re-runs left until ${quota.resetsAt}`,
    };
  }

  const { data: job, error: jobError } = await serviceClient()
    .from("jobs")
    .insert({
      user_id: user.id,
      brand_id: brandId,
      status: "paid",
      origin: "manual",
      subscription_id: subscription.id,
      config_jsonb: config.data,
      amount_cents: 0,
      currency: "usd",
      email_to: user.email,
    })
    .select("id")
    .single();
  if (jobError || !job) {
    return { ok: false, status: 500, code: "db", message: jobError?.message ?? "insert failed" };
  }
  return { ok: true, jobId: job.id as string };
}
