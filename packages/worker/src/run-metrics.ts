import type { SQL } from "bun";
import { HostedConfigSchema } from "@openllmrank/shared/config";
import type {
  CallRow,
  CitationRow,
  PromptRow,
} from "openllmrank/src/core/db";
import { computeGap, computeRates } from "openllmrank/src/core/gap";

export type RunMetricValues = {
  own_citation_rate: number;
  share_of_voice: number;
  samples_total: number;
  per_provider_jsonb: Record<string, number>;
  per_competitor_jsonb: { name: string; rate: number }[];
  top_gap_prompt: string | null;
  top_gap_score: number | null;
};

export type RunMetricContext = {
  run_id: string;
  user_id: string;
  brand_id: string;
  job_id: string;
  computed_at: string;
  brand_name: string;
  competitor_names: string[];
};

type RawCallRow = Omit<CallRow, "run_id" | "cost_usd"> & {
  run_id: string;
  cost_usd: number | string;
};

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function boundedRate(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(5));
}

function rateFor(
  rates: ReturnType<typeof computeRates>,
  brand: string,
  provider?: string,
): number {
  const rows = rates.filter(
    (row) => row.brand === brand && (provider === undefined || row.provider === provider),
  );
  const samplesTotal = sum(rows.map((row) => row.samples_total));
  if (samplesTotal === 0) return 0;
  return boundedRate(sum(rows.map((row) => row.samples_with_citation)) / samplesTotal);
}

function citedFor(
  rates: ReturnType<typeof computeRates>,
  brand: string,
  provider?: string,
): number {
  return sum(
    rates
      .filter(
        (row) => row.brand === brand && (provider === undefined || row.provider === provider),
      )
      .map((row) => row.samples_with_citation),
  );
}

function shareOfVoice(
  rates: ReturnType<typeof computeRates>,
  brandName: string,
  competitorNames: string[],
  provider?: string,
): number {
  const ownCited = citedFor(rates, brandName, provider);
  const competitorCited = sum(
    competitorNames.map((name) => citedFor(rates, name, provider)),
  );
  const totalCited = ownCited + competitorCited;
  return totalCited === 0 ? 0 : boundedRate(ownCited / totalCited);
}

export function buildRunMetrics(args: {
  calls: CallRow[];
  citations: CitationRow[];
  prompts: PromptRow[];
  brand_name: string;
  competitor_names: string[];
}): RunMetricValues {
  const brandNames = [args.brand_name, ...args.competitor_names];
  const rates = computeRates(args.calls, args.citations, args.prompts, brandNames);
  const gaps = computeGap(rates, args.brand_name, args.competitor_names);
  const ownRows = rates.filter((row) => row.brand === args.brand_name);
  const providers = [...new Set(ownRows.map((row) => row.provider))];

  const topGap = gaps[0];
  return {
    own_citation_rate: rateFor(rates, args.brand_name),
    share_of_voice: shareOfVoice(rates, args.brand_name, args.competitor_names),
    samples_total: sum(ownRows.map((row) => row.samples_total)),
    per_provider_jsonb: Object.fromEntries(
      providers.map((provider) => [
        provider,
        rateFor(rates, args.brand_name, provider),
      ]),
    ),
    per_competitor_jsonb: args.competitor_names.map((name) => ({
      name,
      rate: rateFor(rates, name),
    })),
    top_gap_prompt: topGap?.prompt_text ?? null,
    top_gap_score: topGap ? Number(topGap.gap_score.toFixed(5)) : null,
  };
}

async function loadRunData(
  sql: SQL,
  context: Pick<RunMetricContext, "run_id" | "user_id">,
): Promise<Pick<Parameters<typeof buildRunMetrics>[0], "calls" | "citations" | "prompts">> {
  const rawCalls = (await sql`
    select r.cli_run_id as run_id, c.prompt_id, c.sample_index, c.ts::text,
           c.response_text, c.search_results_json::text as search_results_json,
           c.latency_ms, c.tokens_in, c.tokens_out, c.cost_usd,
           c.error_code, c.error_message
    from public.calls c
    join public.runs r on r.id = c.run_id
    where c.run_id = ${context.run_id}
      and c.user_id = ${context.user_id}
  `) as unknown as RawCallRow[];

  const calls: CallRow[] = rawCalls.map((call) => ({
    ...call,
    cost_usd: Number(call.cost_usd),
  }));

  const citations = (await sql`
    select r.cli_run_id as run_id, calls.prompt_id, calls.sample_index,
           c.brand, c.matched_text, c.kind
    from public.citations c
    join public.calls calls on calls.id = c.call_id
    join public.runs r on r.id = c.run_id
    where c.run_id = ${context.run_id}
      and c.user_id = ${context.user_id}
  `) as unknown as CitationRow[];

  const prompts = (await sql`
    select distinct p.prompt_id, p.prompt_text, p.model, p.provider,
           p.config_blob, p.created_at::text
    from public.prompts p
    join public.calls c
      on c.prompt_id = p.prompt_id and c.user_id = p.user_id
    where c.run_id = ${context.run_id}
      and p.user_id = ${context.user_id}
  `) as unknown as PromptRow[];

  return { calls, citations, prompts };
}

export async function writeRunMetrics(
  sql: SQL,
  context: RunMetricContext,
  options: { skipEmptyRun?: boolean } = {},
): Promise<RunMetricValues> {
  const data = await loadRunData(sql, context);
  const values = buildRunMetrics({
    ...data,
    brand_name: context.brand_name,
    competitor_names: context.competitor_names,
  });

  // Zero-success jobs are failed by the worker and should not create a
  // completed-run point in the dashboard.
  if (options.skipEmptyRun !== false && data.calls.length === 0) return values;

  await sql`
    insert into public.run_metrics (
      run_id, user_id, brand_id, job_id, computed_at,
      own_citation_rate, share_of_voice, samples_total,
      per_provider_jsonb, per_competitor_jsonb, top_gap_prompt, top_gap_score
    ) values (
      ${context.run_id}, ${context.user_id}, ${context.brand_id}, ${context.job_id}, ${context.computed_at}::timestamptz,
      ${values.own_citation_rate}, ${values.share_of_voice}, ${values.samples_total},
      ${values.per_provider_jsonb}::jsonb,
      ${values.per_competitor_jsonb}::jsonb,
      ${values.top_gap_prompt}, ${values.top_gap_score}
    )
    on conflict (run_id) do update set
      user_id = excluded.user_id,
      brand_id = excluded.brand_id,
      job_id = excluded.job_id,
      computed_at = excluded.computed_at,
      own_citation_rate = excluded.own_citation_rate,
      share_of_voice = excluded.share_of_voice,
      samples_total = excluded.samples_total,
      per_provider_jsonb = excluded.per_provider_jsonb,
      per_competitor_jsonb = excluded.per_competitor_jsonb,
      top_gap_prompt = excluded.top_gap_prompt,
      top_gap_score = excluded.top_gap_score
  `;

  return values;
}

type BackfillRunRow = {
  run_id: string;
  user_id: string;
  brand_id: string;
  job_id: string;
  computed_at: string;
  config_jsonb: unknown;
};

function parseHostedConfig(value: unknown): ReturnType<typeof HostedConfigSchema.safeParse> {
  if (typeof value !== "string") return HostedConfigSchema.safeParse(value);

  try {
    return HostedConfigSchema.safeParse(JSON.parse(value));
  } catch {
    return HostedConfigSchema.safeParse(value);
  }
}

export async function backfillRunMetrics(sql: SQL): Promise<number> {
  const runs = (await sql`
    select r.id as run_id, r.user_id, r.brand_id, r.job_id,
           r.finished_at::text as computed_at, j.config_jsonb
    from public.runs r
    join public.jobs j on j.id = r.job_id
    where j.status = 'completed'
      and r.finished_at is not null
    order by r.finished_at asc
  `) as unknown as BackfillRunRow[];

  for (const run of runs) {
    const parsed = parseHostedConfig(run.config_jsonb);
    if (!parsed.success) {
      throw new Error(`invalid config_jsonb for run ${run.run_id}: ${parsed.error.message}`);
    }

    await writeRunMetrics(sql, {
      run_id: run.run_id,
      user_id: run.user_id,
      brand_id: run.brand_id,
      job_id: run.job_id,
      computed_at: run.computed_at,
      brand_name: parsed.data.brand.name,
      competitor_names: parsed.data.competitors.map((competitor) => competitor.name),
    }, { skipEmptyRun: false });
  }

  return runs.length;
}
