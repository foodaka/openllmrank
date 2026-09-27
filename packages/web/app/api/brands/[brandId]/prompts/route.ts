import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceClient, userClient } from "../../../../../lib/supabase-server";
import { trackPrompt } from "../../../../../lib/brand-writes";

// POST /api/brands/<id>/prompts  { question } — add one buyer question to
// the brand's tracked prompts ("Track this" in question research).

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ brandId: string }> | { brandId: string } };

const Body = z.object({ question: z.string().max(400) });

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { brandId } = await ctx.params;
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  }
  const supabase = await userClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Send the question as JSON." }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid question." }, { status: 400 });

  const result = await trackPrompt({
    user: supabase,
    service: serviceClient(),
    userId: user.id,
    brandId,
    question: parsed.data.question,
  });
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
  return NextResponse.json({ ok: true, added: result.added, prompts: result.prompts });
}
