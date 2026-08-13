import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  // Only accept same-origin relative paths. Without this check, a link like
  // /login?next=https://evil.example turns our own login into an open
  // redirect that lands a freshly authenticated user on someone else's site.
  const target =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  const supabase = await userClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(target);

  // Prototype affordance, local only. Two independent gates: NODE_ENV must be
  // development AND Supabase must be pointed at a loopback address. A prod
  // build, or a dev build aimed at hosted Supabase, shows nothing.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isLocal =
    process.env.NODE_ENV === "development" &&
    /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(supabaseUrl);

  const devHint = isLocal
    ? {
        email: "demo@openllmrank.io",
        password: "demo-password-123",
        mailpitUrl: "http://127.0.0.1:54334",
      }
    : undefined;

  return (
    <main className="auth-wrap">
      <Link href="/" className="wordmark">
        openllmrank
      </Link>
      <LoginForm next={target} devHint={devHint} />
    </main>
  );
}
