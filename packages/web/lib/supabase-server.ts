import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side Supabase clients. Two flavors:
//   userClient(): anon key + the request's session cookies. RLS-respecting
//     and tenant-scoped by auth.uid(). THIS is what every dashboard route
//     uses. If a dashboard page reaches for serviceClient() instead, RLS
//     stops protecting tenancy and any user can read any other user's data.
//   serviceClient(): SERVICE ROLE key, RLS-bypassing. Used by /api routes
//     when we've validated the action server-side (e.g., we just verified
//     a Stripe webhook signature and need to INSERT into jobs without RLS
//     gating). NEVER expose to the client. NEVER use in a route that takes
//     user-controlled input without explicit gating.
//
//   anonClient(): anon key, NO session. It cannot carry a user's cookies, so
//     it is never what a dashboard page wants. It exists for one purpose:
//     RLS posture tests that prove the anon role sees zero rows.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

let _anon: SupabaseClient | null = null;
let _service: SupabaseClient | null = null;

/**
 * Unauthenticated anon-role client. Test-only by intent: it has no session
 * and therefore sees only what RLS grants to `anon`, which should be nothing.
 * Use userClient() for anything performed on behalf of a signed-in user.
 */
export function anonClient(): SupabaseClient {
  if (_anon) return _anon;
  _anon = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { persistSession: false } },
  );
  return _anon;
}

/**
 * RLS-respecting client bound to the caller's session cookies. Every read a
 * logged-in user performs goes through this, so Postgres row-level security
 * (not application code) is what enforces tenancy.
 *
 * Not memoized: each request has its own cookie jar.
 */
export async function userClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // middleware.ts refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}

export function serviceClient(): SupabaseClient {
  if (_service) return _service;
  _service = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  return _service;
}
