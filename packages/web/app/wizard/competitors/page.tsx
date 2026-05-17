"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WizardShell } from "../wizard-shell";
import { readWizardState, writeWizardState } from "@/lib/wizard-state";
import type { Brand } from "@openllmrank/shared/config";

const MAX_COMPETITORS = 10;
const MIN_COMPETITORS = 1;

export default function WizardCompetitorsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Brand[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const s = readWizardState();
    if (!s.brand?.name) {
      router.replace("/wizard/brand");
      return;
    }
    setItems(s.competitors ?? []);
    setHydrated(true);
  }, [router]);

  function addCompetitor() {
    const name = draft.trim();
    if (!name) return;
    if (items.length >= MAX_COMPETITORS) {
      setError(`At most ${MAX_COMPETITORS} competitors.`);
      return;
    }
    if (items.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setError("Already in the list.");
      return;
    }
    setItems([...items, { name, aliases: [] }]);
    setDraft("");
    setError(null);
  }

  function removeAt(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }

  function validate(): boolean {
    if (items.length < MIN_COMPETITORS) {
      setError(`Add at least ${MIN_COMPETITORS} competitor.`);
      return false;
    }
    setError(null);
    return true;
  }

  function handleNext() {
    if (!validate()) return;
    writeWizardState({ competitors: items });
    router.push("/wizard/prompts");
  }

  if (!hydrated) return null;

  return (
    <WizardShell
      step={2}
      kicker="Their competitors"
      heading="Who are you up against?"
      backHref="/wizard/brand"
      onNext={handleNext}
      nextDisabled={items.length < MIN_COMPETITORS}
    >
      <p className="muted-intro">
        We&rsquo;ll compare your brand to each of these. One to ten
        competitors works best &mdash; the closer-matched, the sharper the
        report.
      </p>

      <div className="field">
        <label htmlFor="comp-input">Add a competitor</label>
        <div className="comp-input-row">
          <input
            id="comp-input"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCompetitor();
              }
            }}
            placeholder="e.g. HubSpot"
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? "comp-error" : undefined}
          />
          <button
            type="button"
            className="btn-text"
            onClick={addCompetitor}
            disabled={!draft.trim() || items.length >= MAX_COMPETITORS}
          >
            Add
          </button>
        </div>
        {error && (
          <span className="field-error" id="comp-error" role="alert">
            {error}
          </span>
        )}
      </div>

      {items.length > 0 && (
        <ul className="comp-list" aria-label="Competitor list">
          {items.map((c, idx) => (
            <li key={c.name}>
              <span>{c.name}</span>
              <button
                type="button"
                className="btn-text remove"
                onClick={() => removeAt(idx)}
                aria-label={`Remove ${c.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <style>{`
        .muted-intro { color: var(--muted); font-size: 17px; margin-bottom: 24px; }
        .comp-input-row { display: flex; gap: 12px; align-items: stretch; }
        .comp-input-row input { flex: 1; }
        .comp-list {
          list-style: none;
          padding: 0;
          margin: 24px 0 0;
          border-top: 1px solid var(--line);
        }
        .comp-list li {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 0;
          border-bottom: 1px solid var(--line);
          font-size: 18px;
        }
        .comp-list .remove { color: var(--loss); }
      `}</style>
    </WizardShell>
  );
}
