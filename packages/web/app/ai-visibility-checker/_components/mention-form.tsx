"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trackFunnel } from "../../../lib/funnel-client";

const EXAMPLES = [
  "What's the best payroll software for a 20-person startup?",
  "Which CRM should a small agency use?",
  "What are the best alternatives to Mailchimp?",
];

export function MentionForm() {
  const router = useRouter();
  const [brand, setBrand] = useState("");
  const [website, setWebsite] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    trackFunnel("mention_check_start");
    try {
      const res = await fetch("/api/mention-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brand, website, question }),
      });
      const body = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !body.token) {
        trackFunnel("mention_check_error", { reason: res.status === 429 ? "quota" : "request" });
        setError(body.error ?? "Something went wrong. Try again.");
        setBusy(false);
        return;
      }
      trackFunnel("mention_check_created");
      router.push(`/ai-visibility-checker/${body.token}`);
    } catch {
      trackFunnel("mention_check_error", { reason: "network" });
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  const ready = brand.trim() !== "" && website.trim() !== "" && question.trim().length >= 10;

  return (
    <form className="check-form mention-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="brand">Your brand</label>
        <input
          id="brand"
          type="text"
          autoComplete="organization"
          placeholder="Acme"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          disabled={busy}
          maxLength={120}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="website">Your website</label>
        <input
          id="website"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="acme.com"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          disabled={busy}
          maxLength={300}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="question">A question your buyers ask</label>
        <textarea
          id="question"
          rows={2}
          placeholder={EXAMPLES[0]}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
          maxLength={300}
          required
          aria-describedby="question-help"
        />
        <p className="field-help" id="question-help">
          Don&rsquo;t name your brand. Ask it the way a buyer would, for
          example: &ldquo;{EXAMPLES[1]}&rdquo; or &ldquo;{EXAMPLES[2]}&rdquo;
        </p>
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn-primary" type="submit" disabled={busy || !ready}>
        {busy ? "Asking the assistants…" : "Check my brand"}
      </button>
    </form>
  );
}
