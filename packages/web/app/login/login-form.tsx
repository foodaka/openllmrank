"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase-browser";

// Two sign-in modes (D2):
//
//   magic  — signInWithOtp. Works for the accounts the Stripe webhook
//            created with no password, which is every customer today.
//   password — signInWithPassword. Faster for returning users, and the
//            fallback when email delivery is slow or Postmark is down.
//
// Mode is local state, not a route, so switching does not lose the typed
// email address.

type Mode = "magic" | "password";

export function LoginForm({
  next,
  devHint,
}: {
  next: string;
  /** Local dev only. Magic-link mail goes to Mailpit, not a real inbox, so
   *  defaulting to magic mode locally strands whoever is trying the app. */
  devHint?: { email: string; password: string; mailpitUrl: string };
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(devHint ? "password" : "magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = browserClient();

    if (mode === "magic") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      setBusy(false);
      if (error) return setError(error.message);
      return setSent(true);
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setError(error.message);
    router.push(next);
    router.refresh();
  }

  if (sent) {
    return (
      <div className="sent">
        <span className="kicker">Check your inbox</span>
        <h1>We sent a sign-in link to {email}.</h1>
        <p>
          The link signs you in and expires in an hour. You can close this tab.
        </p>
        {devHint && (
          <p className="devhint">
            Local dev: that mail went to Mailpit, not a real inbox.{" "}
            <a href={devHint.mailpitUrl} target="_blank" rel="noreferrer">
              Open Mailpit
            </a>{" "}
            to click it, or go back and use the password.
          </p>
        )}
        <button className="btn-text" onClick={() => setSent(false)} type="button">
          Use a different email
        </button>
        <style jsx>{`
          h1 {
            font-family: var(--font-display);
            font-size: 38px;
            line-height: 1.04;
            font-weight: 500;
            margin: 12px 0 20px;
          }
          p {
            color: var(--muted);
            font-size: 17px;
            margin-bottom: var(--space-lg);
          }
          .devhint {
            padding-left: var(--space-md);
            border-left: 2px solid var(--line);
            font-size: 14px;
            line-height: 1.5;
          }
        `}</style>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <span className="kicker">Sign in</span>
      <h1>Your AI-search visibility, tracked.</h1>

      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "auth-error" : undefined}
      />

      {mode === "password" && (
        <>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </>
      )}

      {error && (
        <p className="err" id="auth-error" role="alert">
          {error}
        </p>
      )}

      <button className="btn-primary" type="submit" disabled={busy}>
        {busy
          ? "One moment"
          : mode === "magic"
            ? "Email me a sign-in link"
            : "Sign in"}
      </button>

      <button
        className="btn-text switch"
        type="button"
        onClick={() => {
          setMode(mode === "magic" ? "password" : "magic");
          setError(null);
        }}
      >
        {mode === "magic" ? "Use a password instead" : "Email me a link instead"}
      </button>

      {devHint && (
        <p className="devhint">
          <strong>Local prototype.</strong> Sign in with{" "}
          <code>{devHint.email}</code> / <code>{devHint.password}</code>.
          Magic-link mail is caught by{" "}
          <a href={devHint.mailpitUrl} target="_blank" rel="noreferrer">
            Mailpit
          </a>
          , so it never reaches a real inbox.
        </p>
      )}

      <style jsx>{`
        form {
          display: flex;
          flex-direction: column;
        }
        h1 {
          font-family: var(--font-display);
          font-size: 38px;
          line-height: 1.04;
          font-weight: 500;
          margin: 12px 0 var(--space-lg);
          letter-spacing: -0.015em;
        }
        label {
          font-size: 14px;
          font-weight: 600;
          margin-bottom: var(--space-sm);
        }
        input {
          background: var(--soft);
          border: 1px solid var(--line);
          border-radius: var(--radius-md);
          padding: 14px 16px;
          font-size: 18px;
          min-height: 44px;
          font-family: var(--font-body);
          color: var(--ink);
          margin-bottom: var(--space-md);
        }
        input:focus {
          outline: 2px solid var(--accent);
          border-color: var(--accent);
        }
        .err {
          color: var(--loss);
          font-size: 15px;
          margin: 0 0 var(--space-md);
        }
        .btn-primary {
          margin-top: var(--space-sm);
        }
        .switch {
          margin-top: var(--space-md);
          align-self: flex-start;
        }
        .devhint {
          margin-top: var(--space-lg);
          padding-left: var(--space-md);
          border-left: 2px solid var(--line);
          color: var(--muted);
          font-size: 14px;
          line-height: 1.5;
        }
        .devhint code {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 13px;
          background: var(--soft);
          padding: 1px 5px;
          border-radius: var(--radius-sm);
          color: var(--ink);
        }
      `}</style>
    </form>
  );
}
