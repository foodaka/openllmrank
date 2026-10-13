"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getAcquisition, trackFunnel } from "../../../lib/funnel-client";

export function SnapshotForm() {
  const router = useRouter();
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    trackFunnel("snapshot_start");
    try {
      const res = await fetch("/api/snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ website, email, acquisition: getAcquisition() }),
      });
      const body = (await res.json()) as { url?: string; error?: string; reason?: string };
      if (!res.ok || !body.url) {
        trackFunnel("snapshot_error", { reason: body.reason ?? String(res.status) });
        setError(body.error ?? "Something went wrong. Try again.");
        setBusy(false);
        return;
      }
      trackFunnel("snapshot_created");
      router.push(body.url);
    } catch {
      trackFunnel("snapshot_error", { reason: "network" });
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <form className="check-form snapshot-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="snapshot-website">Your website</label>
        <input
          id="snapshot-website"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="yoursite.com"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          disabled={busy}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="snapshot-email">Work email</label>
        <input
          id="snapshot-email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "snapshot-error" : "snapshot-email-hint"}
        />
        <span className="muted snapshot-hint" id="snapshot-email-hint">
          We email you the link so you can come back to it.
        </span>
      </div>
      {error ? (
        <p className="field-error" id="snapshot-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="btn-primary"
        type="submit"
        disabled={busy || website.trim() === "" || email.trim() === ""}
      >
        {busy ? "Reading your site…" : "Get my free snapshot"}
      </button>
      <p className="muted snapshot-legal">
        Free, no card. By continuing you agree to the{" "}
        <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </form>
  );
}
