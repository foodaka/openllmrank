"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client. Anon key only, RLS-respecting, writes its
// session to cookies so middleware.ts and every server component can read
// the same session. Used only by the auth forms — dashboard data is fetched
// server-side through userClient().

export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
