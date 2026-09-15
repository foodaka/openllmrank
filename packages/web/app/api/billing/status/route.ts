import { NextResponse } from "next/server";
import { userClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

// GET /api/billing/status — the signed-in user's subscription status, or
// null. Polled by /checkout/success while the Stripe webhook lands, so the
// page can say "ready" only once Postgres agrees.
export async function GET() {
  const supabase = await userClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  const { data, error } = await supabase
    .from("subscriptions")
    .select("status,current_period_end")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    { status: data?.status ?? null, current_period_end: data?.current_period_end ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
