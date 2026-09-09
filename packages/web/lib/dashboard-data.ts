import { userClient } from "./supabase-server";

// Dashboard reads. Every query here goes through userClient(), so RLS
// (auth.uid() = user_id) is what enforces tenancy — not a WHERE clause we
// might forget. That is why none of these functions take a userId argument:
// there is deliberately no way to ask for someone else's rows.

export type RunMetric = {
  run_id: string;
  job_id: string;
  computed_at: string;
  origin: JobOrigin | null;
  own_citation_rate: number;
  share_of_voice: number;
  samples_total: number;
  per_provider_jsonb: Record<string, number>;
  per_competitor_jsonb: { name: string; rate: number }[];
  top_gap_prompt: string | null;
  top_gap_score: number | null;
};

export type JobOrigin = "one_shot" | "scheduled" | "manual";

export type DashBrand = {
  id: string;
  name: string;
  website: string | null;
  category: string | null;
  cadence: "weekly" | "monthly" | "paused";
  next_run_at: string | null;
  last_run_at: string | null;
  archived_at: string | null;
};

export type Subscription = {
  status: "incomplete" | "active" | "past_due" | "canceled";
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

/** Postgres numeric arrives as a string over PostgREST; coerce at the edge. */
function toMetric(row: Record<string, unknown>): RunMetric {
  return {
    run_id: row.run_id as string,
    job_id: row.job_id as string,
    computed_at: row.computed_at as string,
    origin: (row.origin as JobOrigin) ?? null,
    own_citation_rate: Number(row.own_citation_rate),
    share_of_voice: Number(row.share_of_voice),
    samples_total: Number(row.samples_total),
    per_provider_jsonb: (row.per_provider_jsonb ?? {}) as Record<string, number>,
    per_competitor_jsonb: (row.per_competitor_jsonb ?? []) as {
      name: string;
      rate: number;
    }[],
    top_gap_prompt: (row.top_gap_prompt as string) ?? null,
    top_gap_score:
      row.top_gap_score === null || row.top_gap_score === undefined
        ? null
        : Number(row.top_gap_score),
  };
}

export async function getBrands(): Promise<DashBrand[]> {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from("brands")
    .select("id,name,website,category,cadence,next_run_at,last_run_at,archived_at")
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`brands: ${error.message}`);
  return (data ?? []) as DashBrand[];
}

export async function getBrand(brandId: string): Promise<DashBrand | null> {
  const supabase = await userClient();
  const { data } = await supabase
    .from("brands")
    .select("id,name,website,category,cadence,next_run_at,last_run_at,archived_at")
    .eq("id", brandId)
    .maybeSingle();
  return (data as DashBrand) ?? null;
}

/** Oldest first, so the trend chart can render straight from the array. */
export async function getMetrics(brandId: string): Promise<RunMetric[]> {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from("run_metrics")
    .select(
      "run_id,job_id,computed_at,own_citation_rate,share_of_voice,samples_total,per_provider_jsonb,per_competitor_jsonb,top_gap_prompt,top_gap_score",
    )
    .eq("brand_id", brandId)
    .order("computed_at", { ascending: true });
  if (error) throw new Error(`run_metrics: ${error.message}`);

  const metrics = (data ?? []).map((r) => toMetric(r as Record<string, unknown>));
  const jobIds = metrics.map((metric) => metric.job_id);
  if (jobIds.length === 0) return metrics;

  // run_metrics stores the job id but not its origin. Fetch the origins in one
  // RLS-scoped query so the chart can distinguish scheduled runs from manual
  // reruns without making one request per point.
  const { data: jobs, error: jobsError } = await supabase
    .from("jobs")
    .select("id,origin")
    .in("id", jobIds);
  if (jobsError) throw new Error(`jobs: ${jobsError.message}`);

  const origins = new Map(
    (jobs ?? []).map((job) => [job.id as string, job.origin as JobOrigin]),
  );
  return metrics.map((metric) => ({
    ...metric,
    origin: origins.get(metric.job_id) ?? null,
  }));
}

/** Latest metric per brand, for the brand list. One query, not N. */
export async function getLatestMetricsByBrand(): Promise<Map<string, RunMetric[]>> {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from("run_metrics")
    .select(
      "brand_id,run_id,job_id,computed_at,own_citation_rate,share_of_voice,samples_total,per_provider_jsonb,per_competitor_jsonb,top_gap_prompt,top_gap_score",
    )
    .order("computed_at", { ascending: true });
  if (error) throw new Error(`run_metrics: ${error.message}`);

  const byBrand = new Map<string, RunMetric[]>();
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const brandId = r.brand_id as string;
    if (!byBrand.has(brandId)) byBrand.set(brandId, []);
    byBrand.get(brandId)!.push(toMetric(r));
  }
  return byBrand;
}

export async function getSubscription(): Promise<Subscription | null> {
  const supabase = await userClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("status,current_period_end,cancel_at_period_end")
    .in("status", ["incomplete", "active", "past_due"])
    .maybeSingle();
  return (data as Subscription) ?? null;
}

export type RunHistoryRow = {
  id: string;
  origin: JobOrigin;
  status: string;
  created_at: string;
  succeeded_at: string | null;
  succeeded_count: number | null;
  failed_count: number | null;
  cost_usd_total: number | null;
};

export async function getRunHistory(brandId: string): Promise<RunHistoryRow[]> {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id,origin,status,created_at,succeeded_at,succeeded_count,failed_count,cost_usd_total",
    )
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`jobs: ${error.message}`);
  return (data ?? []) as RunHistoryRow[];
}

// ------------------------------------------------------------------ format

export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
}

/** "three weeks ago", "last month" — prose, not "21d". This is an editorial surface. */
export function elapsedPhrase(fromIso: string, toIso: string): string {
  const days = Math.round(
    (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000,
  );
  if (days <= 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (weeks === 1) return "a week ago";
  if (weeks < 5) {
    const words = ["", "one", "two", "three", "four"];
    return `${words[weeks]} weeks ago`;
  }
  const months = Math.round(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}

export type Direction = "up" | "down" | "flat";

export function direction(current: number, previous: number): Direction {
  // Half a percentage point of movement is noise at 3 samples per prompt.
  // Calling it "up" would be lying with a rounding error.
  const delta = current - previous;
  if (Math.abs(delta) < 0.005) return "flat";
  return delta > 0 ? "up" : "down";
}
