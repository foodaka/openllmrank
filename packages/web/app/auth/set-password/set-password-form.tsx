"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { recoveryBrowserClient } from "@/lib/supabase-browser";

const PENDING_RECOVERY_KEY = "openllmrank:pending-password-recovery";

function hasPendingRecovery(): boolean {
  return window.sessionStorage.getItem(PENDING_RECOVERY_KEY) === "1";
}

export function SetPasswordForm() {
  const router = useRouter();
  const supabase = useMemo(() => recoveryBrowserClient(), []);
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadSession() {
      // @supabase/ssr forces its browser client to use PKCE, while admin
      // recovery links arrive as access/refresh tokens in the URL fragment.
      // Transfer those tokens explicitly so the cookie-backed client can
      // still establish the session used by middleware and dashboard routes.
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");

      if (accessToken && refreshToken) {
        // A recovery link may be opened after another account was signed in
        // in this browser. Clear that local session before adopting the
        // invite tokens so updateUser cannot target the previous account.
        await supabase.auth.signOut({ scope: "local" });
        const { data, error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!active) return;
        if (data.session) {
          window.sessionStorage.setItem(PENDING_RECOVERY_KEY, "1");
        }
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
        setHasSession(Boolean(data.session));
        setError(sessionError?.message ?? null);
        setReady(true);
        return;
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      setHasSession(Boolean(data.session) && hasPendingRecovery());
      setError(sessionError?.message ?? null);
      setReady(true);
    }

    void loadSession();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setHasSession(Boolean(session) && hasPendingRecovery());
      setReady(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Use at least 6 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }

    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }

    window.sessionStorage.removeItem(PENDING_RECOVERY_KEY);
    router.replace("/dashboard");
    router.refresh();
  }

  if (!ready) {
    return <p>Checking your invite link...</p>;
  }

  if (!hasSession) {
    return (
      <div>
        <span className="kicker">Invite link</span>
        <h1>That link is missing or expired.</h1>
        <p>
          Request a fresh sign-in link and we&apos;ll get you back into your
          dashboard.
        </p>
        <Link className="btn-primary" href="/login">
          Return to sign in
        </Link>
        {error && <p className="err">{error}</p>}
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
          .err {
            color: var(--loss);
            font-size: 15px;
            margin-top: var(--space-lg);
          }
        `}</style>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <span className="kicker">Welcome to openllmrank</span>
      <h1>Set your password.</h1>
      <p className="intro">
        You can use it for faster sign-in, or keep using magic links.
      </p>

      <label htmlFor="password">Password</label>
      <div className="password-field">
        <input
          id="password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          minLength={6}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button
          className="password-toggle"
          type="button"
          aria-label={showPassword ? "Hide password" : "Show password"}
          aria-pressed={showPassword}
          onClick={() => setShowPassword((visible) => !visible)}
        >
          {showPassword ? "Hide" : "Show"}
        </button>
      </div>

      <label htmlFor="confirmation">Confirm password</label>
      <div className="password-field">
        <input
          id="confirmation"
          type={showConfirmation ? "text" : "password"}
          autoComplete="new-password"
          minLength={6}
          required
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
        <button
          className="password-toggle"
          type="button"
          aria-label={showConfirmation ? "Hide confirmation" : "Show confirmation"}
          aria-pressed={showConfirmation}
          onClick={() => setShowConfirmation((visible) => !visible)}
        >
          {showConfirmation ? "Hide" : "Show"}
        </button>
      </div>

      {error && <p className="err" role="alert">{error}</p>}

      <button className="btn-primary" type="submit" disabled={busy}>
        {busy ? "Saving..." : "Set password"}
      </button>

      <style jsx>{`
        form {
          display: flex;
          flex-direction: column;
          width: 100%;
        }
        h1 {
          font-family: var(--font-display);
          font-size: 38px;
          line-height: 1.04;
          font-weight: 500;
          margin: 12px 0 var(--space-sm);
        }
        .intro {
          color: var(--muted);
          font-size: 17px;
          margin-bottom: var(--space-lg);
        }
        label {
          font-size: 14px;
          font-weight: 600;
          margin-bottom: var(--space-sm);
        }
        input {
          width: 100%;
          background: var(--soft);
          border: 1px solid var(--line);
          border-radius: var(--radius-md);
          padding: 14px 16px;
          font-size: 18px;
          min-height: 44px;
          font-family: var(--font-body);
          color: var(--ink);
          margin-bottom: 0;
        }
        input:focus {
          outline: 2px solid var(--accent);
          border-color: var(--accent);
        }
        .password-field {
          position: relative;
          margin-bottom: var(--space-md);
        }
        .password-field input {
          padding-right: 72px;
        }
        .password-toggle {
          position: absolute;
          top: 50%;
          right: 8px;
          transform: translateY(-50%);
          min-height: 32px;
          padding: 6px 8px;
          border: 0;
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--accent);
          font: 600 13px var(--font-body);
          cursor: pointer;
        }
        .password-toggle:hover {
          background: var(--paper);
        }
        .password-toggle:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        form > .btn-primary {
          width: 100%;
          margin-top: var(--space-sm);
        }
        .err {
          color: var(--loss);
          font-size: 15px;
          margin: 0 0 var(--space-md);
        }
      `}</style>
    </form>
  );
}
