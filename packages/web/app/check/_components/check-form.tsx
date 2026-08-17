"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CheckForm() {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/crawl-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const body = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !body.token) {
        setError(body.error ?? "Something went wrong. Try again.");
        setBusy(false);
        return;
      }
      router.push(`/check/${body.token}`);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <form className="check-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="domain">Your domain</label>
        <input
          id="domain"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="yoursite.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          disabled={busy}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "domain-error" : undefined}
        />
        {error ? (
          <p className="field-error" id="domain-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <button className="btn-primary" type="submit" disabled={busy || domain.trim() === ""}>
        {busy ? "Starting the check…" : "Check my site"}
      </button>
    </form>
  );
}
