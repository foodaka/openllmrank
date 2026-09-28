import { NextResponse } from "next/server";
// Relative imports (not "@/lib/..."): routes are type-checked from the root
// tsconfig via packages/web/test/, which has no "@/" alias.
import { serviceClient, userClient } from "../../../../../lib/supabase-server";
import { hasActiveSubscription } from "../../../../../lib/brand-writes";
import { checkRateLimit } from "../../../../../lib/rate-limit";
import { dataforseoConfigured } from "../../../../../lib/dataforseo";
import {
  ResearchError,
  ResearchInput,
  loadSearch,
  marketFor,
  researchQuestions,
} from "../../../../../lib/question-research";

// POST /api/brands/<id>/questions  { topic, location_code? }
//   -> buyer questions ranked by Google + AI demand (lib/question-research.ts)
// GET  /api/brands/<id>/questions?search=<id>  -> a previous search
//
// Subscribers only: every new search spends DataForSEO credit. Durable
// per-user quota and the 7-day cache live in lib/question-research.ts; the
// in-memory limiter here is only a burst brake.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

type Ctx = { params: Promise<{ brandId: string }> | { brandId: string } };

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

async function ownedBrand(brandId: string) {
  const supabase = await userClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: json({ error: "Sign in" }, 401) };
  // RLS: a brand the caller does not own reads as absent.
  const { data: brand } = await supabase
    .from("brands")
    .select("id,archived_at")
    .eq("id", brandId)
    .maybeSingle();
  if (!brand || brand.archived_at) return { ok: false as const, response: json({ error: "Brand not found" }, 404) };
  return { ok: true as const, supabase, user };
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { brandId } = await ctx.params;
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return json({ error: "Cross-site request refused" }, 403);

  const owned = await ownedBrand(brandId);
  if (!owned.ok) return owned.response;
  if (!(await hasActiveSubscription(owned.supabase))) {
    return json({ error: "Question research is part of the tracking plan.", code: "no_subscription" }, 402);
  }
  if (!dataforseoConfigured() || !process.env.OPENAI_API_KEY) {
    return json({ error: "Question research isn't configured yet." }, 503);
  }
  const burst = checkRateLimit(`question-research:${owned.user.id}`, 5, 60_000);
  if (!burst.allowed) return json({ error: "Slow down a little and try again." }, 429);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Send the topic as JSON." }, 400);
  }
  const parsed = ResearchInput.safeParse(raw);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  const market = marketFor(parsed.data.location_code);
  if (!market) return json({ error: "Choose one of the listed markets." }, 400);

  try {
    const outcome = await researchQuestions({
      service: serviceClient(),
      userId: owned.user.id,
      brandId,
      topic: parsed.data.topic,
      market,
    });
    return json(outcome);
  } catch (e) {
    if (e instanceof ResearchError) return json({ error: e.message }, e.status);
    console.error("[question-research] failed", (e as Error).message);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { brandId } = await ctx.params;
  const owned = await ownedBrand(brandId);
  if (!owned.ok) return owned.response;
  const id = new URL(req.url).searchParams.get("search") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Not found" }, 404);
  const outcome = await loadSearch(serviceClient(), brandId, id);
  return outcome ? json(outcome) : json({ error: "Not found" }, 404);
}
