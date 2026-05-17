"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WizardShell } from "../wizard-shell";
import { readWizardState, writeWizardState } from "@/lib/wizard-state";
import { HOSTED_CAPS } from "@openllmrank/shared/config";

const MIN_PROMPTS = 1;
const MAX_PROMPTS = HOSTED_CAPS.max_prompts;

// Pre-filled starter prompts shown when the wizard is empty. v1 stub: we use
// a small template seeded by the brand + first competitor. v1.1 will swap
// this for a real LLM call.
function buildStarterPrompts(
  brandName: string,
  competitor: string | undefined,
): string[] {
  const c = competitor ?? "alternatives";
  return [
    `What is the best tool for what ${brandName} does?`,
    `How does ${brandName} compare to ${c}?`,
    `Which ${brandName.toLowerCase().includes(" ") ? brandName : brandName + " category"} platform is most popular?`,
  ];
}

export default function WizardPromptsPage() {
  const router = useRouter();
  const [prompts, setPrompts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const s = readWizardState();
    if (!s.brand?.name) {
      router.replace("/wizard/brand");
      return;
    }
    if (s.competitors.length === 0) {
      router.replace("/wizard/competitors");
      return;
    }
    if (s.prompts.length > 0) {
      setPrompts(s.prompts);
    } else {
      setPrompts(buildStarterPrompts(s.brand.name, s.competitors[0]?.name));
    }
    setHydrated(true);
  }, [router]);

  function setAt(idx: number, value: string) {
    setPrompts(prompts.map((p, i) => (i === idx ? value : p)));
  }

  function removeAt(idx: number) {
    setPrompts(prompts.filter((_, i) => i !== idx));
  }

  function addBlank() {
    if (prompts.length >= MAX_PROMPTS) return;
    setPrompts([...prompts, ""]);
  }

  function validate(): boolean {
    const cleaned = prompts.map((p) => p.trim()).filter(Boolean);
    if (cleaned.length < MIN_PROMPTS) {
      setError(`At least ${MIN_PROMPTS} prompt required.`);
      return false;
    }
    if (cleaned.length > MAX_PROMPTS) {
      setError(`At most ${MAX_PROMPTS} prompts ($29.99 includes up to ${MAX_PROMPTS}).`);
      return false;
    }
    setError(null);
    return true;
  }

  function handleNext() {
    if (!validate()) return;
    const cleaned = prompts.map((p) => p.trim()).filter(Boolean);
    writeWizardState({ prompts: cleaned });
    router.push("/wizard/review");
  }

  if (!hydrated) return null;

  const nonEmptyCount = prompts.filter((p) => p.trim()).length;

  return (
    <WizardShell
      step={3}
      kicker="Their questions"
      heading="What do customers ask AI?"
      backHref="/wizard/competitors"
      onNext={handleNext}
      nextDisabled={nonEmptyCount < MIN_PROMPTS || nonEmptyCount > MAX_PROMPTS}
    >
      <p className="muted-intro">
        We&rsquo;ve drafted three prompts based on your brand and competitors.
        Edit any of them, or add up to {MAX_PROMPTS - 3} more. The closer
        they match what your buyers actually type, the sharper the report.
      </p>

      <div className="prompts-list">
        {prompts.map((p, idx) => (
          <div className="field prompt-row" key={idx}>
            <label htmlFor={`prompt-${idx}`}>
              Prompt {idx + 1}
            </label>
            <div className="prompt-input-row">
              <textarea
                id={`prompt-${idx}`}
                value={p}
                onChange={(e) => setAt(idx, e.target.value)}
                rows={2}
                placeholder="e.g. What is the best CRM for B2B SaaS?"
              />
              {prompts.length > 1 && (
                <button
                  type="button"
                  className="btn-text remove"
                  onClick={() => removeAt(idx)}
                  aria-label={`Remove prompt ${idx + 1}`}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {prompts.length < MAX_PROMPTS && (
        <button
          type="button"
          className="btn-text add-more"
          onClick={addBlank}
        >
          + Add another prompt ({prompts.length}/{MAX_PROMPTS})
        </button>
      )}

      {error && (
        <span className="field-error" role="alert" style={{ marginTop: 16 }}>
          {error}
        </span>
      )}

      <style>{`
        .muted-intro { color: var(--muted); font-size: 17px; margin-bottom: 24px; }
        .prompts-list { display: flex; flex-direction: column; gap: 8px; }
        .prompt-row { margin: 8px 0; }
        .prompt-input-row { display: flex; gap: 12px; align-items: flex-start; }
        .prompt-input-row textarea {
          flex: 1;
          resize: vertical;
          min-height: 60px;
          font-family: var(--font-body);
          font-size: 16px;
        }
        .prompt-input-row .remove { color: var(--loss); padding-top: 12px; }
        .add-more { margin-top: 16px; }
      `}</style>
    </WizardShell>
  );
}
