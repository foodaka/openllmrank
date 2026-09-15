import { NextResponse } from "next/server";
import type { RunCadence } from "@openllmrank/shared/cadence";
// Relative imports: type-checked from packages/web/test without the "@/" alias.
import { serviceClient, userClient } from "../../../lib/supabase-server";
import { createBrand, type BrandFormInput } from "../../../lib/brand-writes";

export const dynamic = "force-dynamic";

// POST /api/brands — JSON body { name, website, category, aliases, competitors,
// prompts } (competitors and prompts newline-separated, aliases comma-separated).
// The dashboard form uses the server action in app/dashboard/brands/actions.ts;
// this route exposes the same write for tests and integrations.

export type BrandRequestInput = BrandFormInput & { cadence?: RunCadence };

function cadenceOf(value: unknown): RunCadence | undefined {
  return value === "weekly" || value === "monthly" || value === "paused"
    ? value
    : undefined;
}

export async function readBrandInput(req: Request): Promise<BrandRequestInput> {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      name: text(body.name),
      website: text(body.website),
      category: text(body.category),
      aliases: text(body.aliases),
      competitors: text(body.competitors),
      prompts: text(body.prompts),
      cadence: cadenceOf(body.cadence),
    };
  }
  const form = await req.formData();
  return {
    name: text(form.get("name")),
    website: text(form.get("website")),
    category: text(form.get("category")),
    aliases: text(form.get("aliases")),
    competitors: text(form.get("competitors")),
    prompts: text(form.get("prompts")),
    cadence: cadenceOf(form.get("cadence")),
  };
}

export async function POST(req: Request) {
  const supabase = await userClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to add a brand" }, { status: 401 });

  const result = await createBrand({
    user: supabase,
    service: serviceClient(),
    userId: user.id,
    input: await readBrandInput(req),
  });
  if (!result.ok) {
    return NextResponse.json(
      "errors" in result
        ? { error: "Invalid brand", code: result.code, errors: result.errors }
        : { error: result.message, code: result.code },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, brand_id: result.brandId }, { status: 201 });
}
