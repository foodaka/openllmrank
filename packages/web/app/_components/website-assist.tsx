"use client";

import { useEffect, useRef, useState } from "react";
import type { WebsiteSuggestions } from "@/lib/website-suggestions";

// Shared by the signup wizard and the dashboard add-brand form. The copy
// defaults describe the wizard, where the draft lives in localStorage and the
// questions are edited in step 3; the dashboard passes its own.
export function WebsiteAssist({
  website,
  onApply,
  hasQuestions,
  appliedNote = "Draft saved in this browser. Review your brand below and your questions in step 3.",
  editNote = "You can edit every question in step 3.",
  replaceNote = "Using this draft will replace your saved questions.",
}: {
  website: string;
  onApply: (draft: WebsiteSuggestions) => void;
  hasQuestions: boolean;
  appliedNote?: string;
  editNote?: string;
  replaceNote?: string;
}) {
  const [draft, setDraft] = useState<WebsiteSuggestions | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    active.current?.abort();
    active.current = null;
    setPending(false); setDraft(null); setError(""); setApplied(false);
    return () => { active.current?.abort(); active.current = null; };
  }, [website]);

  async function generate() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setPending(true); setError(""); setDraft(null); setApplied(false);
    const timer = setTimeout(() => controller.abort(), 85_000);
    try {
      const res = await fetch("/api/wizard/suggest", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website }), signal: controller.signal,
      });
      const data = await res.json();
      if (controller.signal.aborted) return;
      if (!res.ok) throw new Error(data.error || "We couldn’t draft suggestions. Please try again.");
      setDraft(data.suggestions);
    } catch (err) {
      if (active.current === controller) {
        setError(controller.signal.aborted ? "The request took too long. Try again, or continue manually." : err instanceof Error ? err.message : "We couldn’t connect. Please try again.");
      }
    } finally {
      clearTimeout(timer);
      if (active.current === controller) setPending(false);
    }
  }

  return <section className="website-assist" aria-label="AI setup assistant">
    <div className="assist-heading">
      <div>
        <span className="kicker">A HEAD START WITH AI</span>
        <p>Turn your website into a first draft.</p>
      </div>
      <button className="btn-secondary" type="button" disabled={!website.trim() || pending} onClick={generate}>
        {pending ? "Drafting…" : draft || applied ? "Generate again" : "Suggest from website"}
      </button>
    </div>
    <p className="assist-note">We’ll read your public page and suggest your category and questions buyers might ask. You decide what to use.</p>
    <div role="status" aria-live="polite">
      {pending && <p className="assist-status">Reading your website and drafting buyer questions. This may take a moment.</p>}
      {applied && <p className="assist-status">{appliedNote}</p>}
    </div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {draft && <div className="assist-draft">
      <h2>Your suggested starting point</h2>
      <dl><div><dt>Brand</dt><dd>{draft.name}</dd></div><div><dt>Category</dt><dd>{draft.category}</dd></div></dl>
      <h3>Questions buyers might ask</h3>
      <ol>{draft.prompts.map((prompt, i) => <li key={i}>{prompt}</li>)}</ol>
      <p className="assist-note">AI suggestions, based on your page—not measured search activity. Your existing brand details will be kept. {hasQuestions ? replaceNote : editNote}</p>
      <div className="assist-actions">
        <button type="button" className="btn-primary" onClick={() => { onApply(draft); setDraft(null); setApplied(true); }}>Use this draft</button>
        <button type="button" className="btn-text" onClick={() => setDraft(null)}>Dismiss</button>
      </div>
    </div>}
    <style>{`
      .website-assist { margin: 20px 0 28px; padding: 20px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
      .assist-heading { display: flex; gap: 20px; align-items: center; justify-content: space-between; }
      .assist-heading p { margin: 6px 0; font-size: 18px; }
      .assist-heading button { flex-shrink: 0; min-height: 44px; padding: 10px 16px; border: 1px solid var(--accent); border-radius: 4px; background: transparent; color: var(--accent); font: inherit; font-size: 15px; font-weight: 500; cursor: pointer; }
      .assist-heading button:hover { background: var(--soft); }
      .assist-heading button:disabled { opacity: .55; cursor: default; }
      .assist-heading button:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
      .assist-note { font-size: 14px; color: var(--muted); margin: 10px 0 0; }
      .assist-status { color: var(--accent); font-size: 15px; margin: 12px 0 0; }
      .assist-draft { margin-top: 24px; padding: 24px; background: var(--soft); border-radius: 6px; }
      .assist-draft h2 { font-family: var(--font-display); font-size: 26px; margin: 0 0 20px; }
      .assist-draft dl { margin: 0 0 24px; display: grid; gap: 12px; }
      .assist-draft dt { color: var(--muted); font-size: 14px; }
      .assist-draft dd { margin: 2px 0 0; font-weight: 500; }
      .assist-draft h3 { font-size: 16px; margin: 0 0 8px; }
      .assist-draft ol { padding-left: 24px; margin: 0 0 20px; }
      .assist-draft li { padding: 8px 0 8px 4px; line-height: 1.5; }
      .assist-actions { display: flex; align-items: center; gap: 24px; margin-top: 20px; }
      .assist-actions button { min-height: 44px; }
      @media (max-width: 540px) { .assist-heading { align-items: stretch; flex-direction: column; gap: 12px; } .assist-draft { padding: 20px 16px; } }
    `}</style>
  </section>;
}
