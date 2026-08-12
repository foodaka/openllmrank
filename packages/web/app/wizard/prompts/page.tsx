"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WizardShell } from "../wizard-shell";
import { readWizardState, writeWizardState } from "@/lib/wizard-state";
import { HOSTED_CAPS } from "@openllmrank/shared/config";

const MIN_PROMPTS = 1;
const MAX_PROMPTS = HOSTED_CAPS.max_prompts;

// The six buyer-intent angles a report is most useful across. The first three
// are pre-filled; the rest become placeholders on any row the buyer adds, so
// the guidance is visible at the moment they're typing rather than only above
// the form.
type Intent = { label: string; example: (ctx: IntentContext) => string };
type IntentContext = { brand: string; category: string; competitor: string };

const INTENTS: Intent[] = [
  {
    label: "Use case",
    example: ({ category }) => `What is the best ${category} for a growing business?`,
  },
  {
    label: "Alternatives",
    example: ({ competitor }) => `Compare the top alternatives to ${competitor}.`,
  },
  {
    label: "Pricing",
    example: ({ brand }) => `How much does ${brand} cost?`,
  },
  {
    label: "Fit",
    example: ({ brand }) => `Who is ${brand} best for?`,
  },
  {
    label: "Risk",
    example: ({ brand }) => `What are the risks of choosing ${brand} as a vendor?`,
  },
  {
    label: "Company size",
    example: ({ brand }) => `Would you recommend ${brand} for a 20-person company?`,
  },
];

const STARTER_COUNT = 3;

function buildIntentContext(
  brand: string,
  category: string | undefined,
  competitor: string | undefined,
): IntentContext {
  return {
    brand,
    category: category ?? "tools in this category",
    competitor: competitor ?? "the category leader",
  };
}

function buildStarterPrompts(ctx: IntentContext): string[] {
  return INTENTS.slice(0, STARTER_COUNT).map((i) => i.example(ctx));
}

export default function WizardPromptsPage() {
  const router = useRouter();
  const [prompts, setPrompts] = useState<string[]>([]);
  const [intentCtx, setIntentCtx] = useState<IntentContext | null>(null);
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
    const ctx = buildIntentContext(
      s.brand.name,
      s.brand.category,
      s.competitors[0]?.name,
    );
    setIntentCtx(ctx);
    if (s.prompts.length > 0) {
      setPrompts(s.prompts);
    } else {
      setPrompts(buildStarterPrompts(ctx));
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

  if (!hydrated || !intentCtx) return null;

  const nonEmptyCount = prompts.filter((p) => p.trim()).length;
  const ctx = intentCtx;
  const placeholderFor = (idx: number) =>
    INTENTS[idx % INTENTS.length]!.example(ctx);

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
        Edit any of them, or add up to {MAX_PROMPTS - STARTER_COUNT} more. The
        closer they match what your buyers actually type, the sharper the
        report.
      </p>

      <section className="intent-guide" aria-labelledby="intent-guide-label">
        <span className="kicker" id="intent-guide-label">
          Angles worth covering
        </span>
        <dl>
          {INTENTS.map((intent) => (
            <div className="intent-row" key={intent.label}>
              <dt>{intent.label}</dt>
              <dd>{intent.example(ctx)}</dd>
            </div>
          ))}
        </dl>
      </section>

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
                placeholder={placeholderFor(idx)}
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
        .intent-guide {
          background: var(--soft);
          border: 1px solid var(--line);
          border-radius: var(--radius-md);
          padding: 20px 24px 24px;
          margin-bottom: 28px;
        }
        .intent-guide dl { margin: 12px 0 0; }
        .intent-row {
          display: grid;
          grid-template-columns: 116px 1fr;
          gap: 16px;
          padding: 8px 0;
          border-top: 1px solid var(--line);
        }
        .intent-row:first-child { border-top: none; }
        .intent-row dt {
          font-size: 14px;
          font-weight: 600;
          color: var(--muted);
          padding-top: 2px;
        }
        .intent-row dd {
          margin: 0;
          font-family: var(--font-display);
          font-style: italic;
          font-size: 16px;
          line-height: 1.4;
          color: var(--ink);
        }
        @media (max-width: 820px) {
          .intent-row { grid-template-columns: 1fr; gap: 4px; }
        }
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
