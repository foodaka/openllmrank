import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// POST-only sign-out. A GET would let any <img src="/auth/signout"> on a
// third-party page log the user out.

export async function POST(request: NextRequest) {
  const { origin } = request.nextUrl;
  let response = NextResponse.redirect(`${origin}/`, { status: 303 });

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

  await supabase.auth.signOut();
  return response;
}
