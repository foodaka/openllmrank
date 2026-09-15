import { NextResponse } from "next/server";
import { serviceClient, userClient } from "../../../../lib/supabase-server";
import { archiveBrand, updateBrand } from "../../../../lib/brand-writes";
import { readBrandInput } from "../route";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ brandId: string }> | { brandId: string } };

async function session() {
  const supabase = await userClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** PATCH /api/brands/<id> — same body as POST /api/brands. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { brandId } = await ctx.params;
  const { supabase, user } = await session();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const input = await readBrandInput(req);
  const result = await updateBrand({
    user: supabase,
    service: serviceClient(),
    userId: user.id,
    brandId,
    input,
    cadence: input.cadence,
  });
  if (!result.ok) {
    return NextResponse.json(
      "errors" in result
        ? { error: "Invalid brand", code: result.code, errors: result.errors }
        : { error: result.message, code: result.code },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, brand_id: brandId });
}

/** DELETE /api/brands/<id> — archives (never deletes) the brand. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { brandId } = await ctx.params;
  const { supabase, user } = await session();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const result = await archiveBrand({
    user: supabase,
    service: serviceClient(),
    userId: user.id,
    brandId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
  }
  return NextResponse.json({ ok: true, brand_id: brandId, archived: true });
}
