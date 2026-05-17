import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side Supabase clients. Two flavors:
//   anonClient(): public anon key, RLS-respecting. Used for reads on behalf
//     of a logged-in user (eventually). Never use this for writes that
//     require trusting the request origin.
//   serviceClient(): SERVICE ROLE key, RLS-bypassing. Used by /api routes
//     when we've validated the action server-side (e.g., we just verified
//     a Stripe webhook signature and need to INSERT into jobs without RLS
//     gating). NEVER expose to the client. NEVER use in a route that takes
//     user-controlled input without explicit gating.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

let _anon: SupabaseClient | null = null;
let _service: SupabaseClient | null = null;

export function anonClient(): SupabaseClient {
  if (_anon) return _anon;
  _anon = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { persistSession: false } },
  );
  return _anon;
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
