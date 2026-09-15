import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { safeNext } from "../../../lib/safe-next";

// Magic-link landing. Supabase redirects here with ?code=..., we exchange it
// for a session and write the cookies, then send the user where they were
// originally headed.
//
//   /auth/callback?code=...&next=/dashboard
//         │
//         ├── exchange ok  ──> 307 to `next`, session cookies set
//         └── exchange bad ──> 307 /login?error=... (expired or reused link)

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");

  // Same-origin relative paths only — see lib/safe-next.ts.
  const next = safeNext(nextParam);

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  let response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Only a code goes back to /login; the page maps it to customer copy.
    // Supabase's message ("PKCE code verifier not found…") is for our logs.
    console.warn("[auth/callback] exchange failed:", error.message);
    return NextResponse.redirect(`${origin}/login?error=link_expired`);
  }

  return response;
}
