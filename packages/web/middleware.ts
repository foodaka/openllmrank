import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Session refresh + dashboard guard.
//
//   request for /dashboard/*
//         │
//         ▼
//   refresh the Supabase session cookie (getUser hits the auth server, so
//   a revoked or expired session is caught here, not trusted from the JWT)
//         │
//         ├── user present ──> continue, with refreshed cookies attached
//         └── no user      ──> 307 /login?next=<pathname>
//
// Everything outside /dashboard/* passes through untouched: the marketing
// pages, the wizard, the blog, and /reports/[id] all stay public. Report
// access control lives in the route itself because it has three valid
// paths (signed token, session, legacy grace) that middleware cannot see.

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser(), not getSession(): getSession trusts the cookie's JWT without
  // contacting the auth server, so a signed-out or revoked session would
  // still look valid here.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/auth/set-password"],
};
