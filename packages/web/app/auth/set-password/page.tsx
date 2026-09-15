import type { Metadata } from "next";
import Link from "next/link";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = {
  title: "Set your password",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function SetPasswordPage() {
  // Do not server-guard this route. Supabase recovery links deliver the
  // temporary session in the URL fragment, which the browser client consumes.
  return (
    <main className="auth-wrap">
      <Link href="/" className="wordmark">
        openllmrank
      </Link>
      <SetPasswordForm />
    </main>
  );
}
