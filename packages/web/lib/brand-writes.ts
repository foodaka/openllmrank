import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HOSTED_CAPS,
  HOSTED_REPORT_PROVIDERS,
  HostedConfigSchema,
  type HostedConfig,
} from "@openllmrank/shared/config";
import {
  DEFAULT_WEEKLY_MAX_BRANDS,
  effectiveCadence,
  positiveIntEnv,
  type RunCadence,
} from "@openllmrank/shared/cadence";

// Brand writes for the dashboard (E5). Two clients are involved on purpose:
//
//   user client (RLS)      proves the caller owns the brand / has a subscription
//   service client         performs the write, because migration 0010 keeps
//                          config_jsonb, cadence, and next_run_at out of the
//                          authenticated role's reach
//
// Nothing here trusts a user id from the request; it always comes from the
// session the caller already resolved.

export type BrandFormInput = {
  name: string;
  website: string;
  category: string;
  aliases: string;      // comma-separated
  competitors: string;  // one per line: "Name" or "Name | alias, alias"
  prompts: string;      // one per line
};

export type BrandFormErrors = Partial<Record<keyof BrandFormInput, string>>;

export type BrandCadence = RunCadence;

export type ParsedBrandForm =
  | { ok: true; config: HostedConfig; website: string; category: string }
  | { ok: false; errors: BrandFormErrors };

function normalizeWebsite(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function splitList(raw: string, sep: RegExp): string[] {
  return raw
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function weeklyMaxBrands(): number {
  return positiveIntEnv(process.env.SCHEDULER_WEEKLY_MAX_BRANDS, DEFAULT_WEEKLY_MAX_BRANDS);
}

/** Turn the form's free text into a validated HostedConfig. */
export function parseBrandForm(input: BrandFormInput): ParsedBrandForm {
  const errors: BrandFormErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = "Brand name is required.";

  const website = normalizeWebsite(input.website);
  if (!website) errors.website = "Enter a valid website, such as acme.com.";

  const category = input.category.trim();
  if (category.length < 2) {
    errors.category = "Tell us the category buyers put you in, in a few words.";
  } else if (category.length > 120) {
    errors.category = "Keep the category under 120 characters.";
  }

  const aliases = splitList(input.aliases, /,/);

  const competitors = splitList(input.competitors, /\r?\n/).map((line) => {
    const [cname, calias] = line.split("|").map((s) => s.trim());
    return { name: cname ?? "", aliases: calias ? splitList(calias, /,/) : [] };
  }).filter((c) => c.name);
  if (competitors.length === 0) {
    errors.competitors = "Add at least one competitor, one per line.";
  } else if (competitors.length > 10) {
    errors.competitors = "At most 10 competitors.";
  }

  const prompts = splitList(input.prompts, /\r?\n/);
  if (prompts.length === 0) {
    errors.prompts = "Add at least one question, one per line.";
  } else if (prompts.length > HOSTED_CAPS.max_prompts) {
    errors.prompts = `At most ${HOSTED_CAPS.max_prompts} questions.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const parsed = HostedConfigSchema.safeParse({
    brand: { name, aliases, website: website!, category },
    competitors,
    prompts,
    // The provider lineup is a product decision, never a form field.
    providers: HOSTED_REPORT_PROVIDERS.map((p) => ({ ...p })),
    samples_per_prompt: 3,
    concurrency_per_provider: 4,
  });
  if (!parsed.success) {
    return { ok: false, errors: { name: parsed.error.issues[0]?.message ?? "Invalid input." } };
  }
  return { ok: true, config: parsed.data, website: website!, category };
}

/** Prefill values for the form from a stored config. */
export function brandFormFromConfig(
  brand: { name: string; website: string | null; category: string | null },
  config: HostedConfig | null,
): BrandFormInput {
  return {
    name: brand.name,
    website: brand.website ?? config?.brand.website ?? "",
    category: brand.category ?? config?.brand.category ?? "",
    aliases: (config?.brand.aliases ?? []).join(", "),
    competitors: (config?.competitors ?? [])
      .map((c) => (c.aliases.length ? `${c.name} | ${c.aliases.join(", ")}` : c.name))
      .join("\n"),
    prompts: (config?.prompts ?? []).join("\n"),
  };
}

export type BrandWriteResult =
  | { ok: true; brandId: string }
  | { ok: false; status: number; code: string; message: string };

async function hasActiveSubscription(user: SupabaseClient): Promise<boolean> {
  const { data } = await user
    .from("subscriptions")
    .select("id")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

/** D12 for the whole account: every active brand carries the same cadence. */
export async function recomputeAccountCadence(
  service: SupabaseClient,
  userId: string,
): Promise<"weekly" | "monthly"> {
  const { count } = await service
    .from("brands")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("archived_at", null);
  const cadence = effectiveCadence(count ?? 0, weeklyMaxBrands());
  const { error } = await service
    .from("brands")
    .update({ cadence })
    .eq("user_id", userId)
    .is("archived_at", null)
    .neq("cadence", "paused");
  if (error) throw new Error(`cadence update: ${error.message}`);
  return cadence;
}

export async function createBrand(args: {
  user: SupabaseClient;
  service: SupabaseClient;
  userId: string;
  input: BrandFormInput;
}): Promise<BrandWriteResult | { ok: false; status: 400; code: "invalid"; errors: BrandFormErrors }> {
  if (!(await hasActiveSubscription(args.user))) {
    return { ok: false, status: 402, code: "no_subscription", message: "Adding a brand needs an active subscription." };
  }
  const parsed = parseBrandForm(args.input);
  if (!parsed.ok) return { ok: false, status: 400, code: "invalid", errors: parsed.errors };

  const { data, error } = await args.service
    .from("brands")
    .insert({
      user_id: args.userId,
      name: parsed.config.brand.name,
      aliases: parsed.config.brand.aliases,
      website: parsed.website,
      category: parsed.category,
      config_jsonb: parsed.config,
      cadence: "weekly",
      // Due immediately: the scheduler queues the first run on its next tick.
      next_run_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, status: 500, code: "db", message: error?.message ?? "insert failed" };
  }
  await recomputeAccountCadence(args.service, args.userId);
  return { ok: true, brandId: data.id as string };
}

export async function updateBrand(args: {
  user: SupabaseClient;
  service: SupabaseClient;
  userId: string;
  brandId: string;
  input: BrandFormInput;
  cadence?: BrandCadence;
}): Promise<BrandWriteResult | { ok: false; status: 400; code: "invalid"; errors: BrandFormErrors }> {
  // RLS: a brand the caller does not own reads as absent.
  const { data: owned } = await args.user
    .from("brands")
    .select("id,archived_at,cadence,next_run_at")
    .eq("id", args.brandId)
    .maybeSingle();
  if (!owned || owned.archived_at) {
    return { ok: false, status: 404, code: "not_found", message: "Brand not found." };
  }
  if (!(await hasActiveSubscription(args.user))) {
    return {
      ok: false,
      status: 402,
      code: "no_subscription",
      message: "An active subscription is required to change brand settings.",
    };
  }
  const parsed = parseBrandForm(args.input);
  if (!parsed.ok) return { ok: false, status: 400, code: "invalid", errors: parsed.errors };

  let schedule: { cadence: BrandCadence; next_run_at: string | null } | undefined;
  if (args.cadence) {
    if (args.cadence === "paused") {
      schedule = { cadence: "paused", next_run_at: null };
    } else {
      const { count, error: countError } = await args.service
        .from("brands")
        .select("id", { count: "exact", head: true })
        .eq("user_id", args.userId)
        .is("archived_at", null);
      if (countError) {
        return { ok: false, status: 500, code: "db", message: countError.message };
      }
      schedule = {
        cadence: effectiveCadence(count ?? 0, weeklyMaxBrands()),
        next_run_at: owned.next_run_at ?? new Date().toISOString(),
      };
    }
  }

  const { error } = await args.service
    .from("brands")
    .update({
      name: parsed.config.brand.name,
      aliases: parsed.config.brand.aliases,
      website: parsed.website,
      category: parsed.category,
      config_jsonb: parsed.config,
      ...(schedule ?? {}),
    })
    .eq("id", args.brandId)
    .eq("user_id", args.userId);
  if (error) return { ok: false, status: 500, code: "db", message: error.message };
  if (args.cadence) await recomputeAccountCadence(args.service, args.userId);
  return { ok: true, brandId: args.brandId };
}

export async function archiveBrand(args: {
  user: SupabaseClient;
  service: SupabaseClient;
  userId: string;
  brandId: string;
}): Promise<BrandWriteResult> {
  const { data: owned } = await args.user
    .from("brands")
    .select("id")
    .eq("id", args.brandId)
    .maybeSingle();
  if (!owned) return { ok: false, status: 404, code: "not_found", message: "Brand not found." };

  const { error } = await args.service
    .from("brands")
    .update({ archived_at: new Date().toISOString(), cadence: "paused", next_run_at: null })
    .eq("id", args.brandId)
    .eq("user_id", args.userId);
  if (error) return { ok: false, status: 500, code: "db", message: error.message };
  await recomputeAccountCadence(args.service, args.userId);
  return { ok: true, brandId: args.brandId };
}
