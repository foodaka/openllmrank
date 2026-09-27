// Minimal DataForSEO client for question research: keyword ideas and
// suggestions (Google demand) and AI keyword search volume (demand in AI
// assistants). Request/response shapes follow DataForSEO's v3 API; the
// field surface mirrors OpenSEO's typed client (MIT, every-app/open-seo).
//
// Credentials: DATAFORSEO_API_KEY (base64 "login:password", the format
// OpenSEO uses), or DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD.
//
// Every task reports its own USD cost; callers sum it for spend tracking.
// Everything returned is untrusted third-party data: validated with Zod,
// never interpolated into instructions without fencing.

import { z } from "zod";

const API_BASE = "https://api.dataforseo.com";
const REQUEST_TIMEOUT_MS = 45_000;

export class DataforseoError extends Error {
  constructor(
    message: string,
    public readonly kind: "not_configured" | "billing" | "upstream",
  ) {
    super(message);
    this.name = "DataforseoError";
  }
}

export function dataforseoConfigured(): boolean {
  return Boolean(
    process.env.DATAFORSEO_API_KEY || (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
  );
}

function authHeader(): string {
  const key = process.env.DATAFORSEO_API_KEY;
  if (key) return `Basic ${key}`;
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new DataforseoError("DataForSEO credentials are not configured.", "not_configured");
  }
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

const MonthlySchema = z
  .object({
    year: z.number().nullish(),
    month: z.number().nullish(),
    search_volume: z.number().nullish(),
  })
  .passthrough();

export const LabsKeywordItemSchema = z
  .object({
    keyword: z.string().nullish(),
    keyword_info: z
      .object({
        search_volume: z.number().nullish(),
        cpc: z.number().nullish(),
        monthly_searches: z.array(MonthlySchema).nullish(),
      })
      .passthrough()
      .nullish(),
    keyword_properties: z.object({ keyword_difficulty: z.number().nullish() }).passthrough().nullish(),
    search_intent_info: z.object({ main_intent: z.string().nullish() }).passthrough().nullish(),
  })
  .passthrough();

const AiVolumeItemSchema = z
  .object({
    keyword: z.string().nullish(),
    ai_search_volume: z.number().nullish(),
  })
  .passthrough();

const TaskSchema = z
  .object({
    status_code: z.number(),
    status_message: z.string().nullish(),
    cost: z.number().nullish(),
    result: z
      .array(z.object({ items: z.array(z.unknown()).nullish() }).passthrough())
      .nullish(),
  })
  .passthrough();

const ResponseSchema = z
  .object({
    status_code: z.number(),
    status_message: z.string().nullish(),
    tasks: z.array(TaskSchema).nullish(),
  })
  .passthrough();

export type LabsKeywordItem = z.infer<typeof LabsKeywordItemSchema>;

export type DataforseoResult<T> = { items: T[]; costUsd: number };

/** DataForSEO's billing failures: out of credits, account blocked. */
const BILLING_STATUS_CODES = new Set([40200, 40201, 40202, 40210]);

async function post<T>(
  path: string,
  body: unknown,
  itemSchema: z.ZodType<T>,
  fetchImpl: typeof fetch = fetch,
): Promise<DataforseoResult<T>> {
  let res: Response;
  try {
    res = await fetchImpl(`${API_BASE}${path}`, {
      method: "POST",
      headers: { Authorization: authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify([body]),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof DataforseoError) throw e;
    throw new DataforseoError(`DataForSEO request failed: ${(e as Error).message}`, "upstream");
  }
  if (!res.ok) {
    throw new DataforseoError(
      `DataForSEO returned HTTP ${res.status}`,
      res.status === 402 ? "billing" : "upstream",
    );
  }
  const parsed = ResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new DataforseoError("DataForSEO returned an unexpected payload.", "upstream");
  const task = parsed.data.tasks?.[0];
  const code = task?.status_code ?? parsed.data.status_code;
  if (!task || code !== 20000) {
    const message = task?.status_message ?? parsed.data.status_message ?? "unknown error";
    throw new DataforseoError(
      `DataForSEO task failed (${code}): ${message}`,
      BILLING_STATUS_CODES.has(code) ? "billing" : "upstream",
    );
  }
  const items: T[] = [];
  for (const raw of task.result?.[0]?.items ?? []) {
    // Drop malformed rows rather than failing the whole search.
    const item = itemSchema.safeParse(raw);
    if (item.success) items.push(item.data);
  }
  return { items, costUsd: task.cost ?? 0 };
}

export type KeywordQuery = {
  keyword: string;
  locationCode: number;
  languageCode: string;
  limit: number;
};

/** Keywords in the same category as the seed (broad ideas). */
export function fetchKeywordIdeas(q: KeywordQuery, fetchImpl?: typeof fetch) {
  return post(
    "/v3/dataforseo_labs/google/keyword_ideas/live",
    {
      keywords: [q.keyword],
      location_code: q.locationCode,
      language_code: q.languageCode,
      limit: q.limit,
      include_serp_info: false,
      ignore_synonyms: false,
      closely_variants: false,
    },
    LabsKeywordItemSchema,
    fetchImpl,
  );
}

/** Long-tail keywords that contain the seed (question-shaped phrasings). */
export function fetchKeywordSuggestions(q: KeywordQuery, fetchImpl?: typeof fetch) {
  return post(
    "/v3/dataforseo_labs/google/keyword_suggestions/live",
    {
      keyword: q.keyword,
      location_code: q.locationCode,
      language_code: q.languageCode,
      limit: q.limit,
      include_serp_info: false,
      include_seed_keyword: true,
      ignore_synonyms: false,
      exact_match: false,
    },
    LabsKeywordItemSchema,
    fetchImpl,
  );
}

/** Estimated monthly searches for each keyword in AI assistants. */
export function fetchAiSearchVolume(
  q: { keywords: string[]; locationCode: number; languageCode: string },
  fetchImpl?: typeof fetch,
) {
  return post(
    "/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live",
    { keywords: q.keywords.slice(0, 1000), location_code: q.locationCode, language_code: q.languageCode },
    AiVolumeItemSchema,
    fetchImpl,
  );
}
