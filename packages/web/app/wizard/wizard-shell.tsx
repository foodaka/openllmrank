"use client";

// Shared wizard chrome: kicker (STEP N OF 4), display headline, and footer
// with Back/Next. Renders the editorial form layout from the approved
// wizard-step1 mockup. Each step page composes this and provides its own
// form body via children.

import Link from "next/link";
import type { ReactNode } from "react";

export type WizardShellProps = {
  step: 1 | 2 | 3 | 4;
  totalSteps?: number;
  kicker: string;
  heading: string;
  backHref?: string;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  children: ReactNode;
};

export function WizardShell({
  step,
  totalSteps = 4,
  kicker,
  heading,
  backHref,
  onNext,
  nextLabel = "Next",
  nextDisabled = false,
  children,
}: WizardShellProps) {
  return (
    <main>
      <nav className="wizard-topbar">
        <Link href="/" className="wordmark">
          openllmrank
        </Link>
      </nav>

      <div className="wizard-wrap">
        <ol className="wizard-progress" aria-label="Report setup progress">
          {Array.from({ length: totalSteps }, (_, index) => (
            <li
              key={index}
              aria-current={index + 1 === step ? "step" : undefined}
              className={index + 1 < step ? "is-complete" : undefined}
            >
              <span className="wizard-step-number">{index + 1}</span>{" "}
              {["Brand", "Competitors", "Questions", "Review"][index] ?? `Step ${index + 1}`}
            </li>
          ))}
        </ol>
        <span className="kicker">
          {kicker.toUpperCase()} &middot; STEP {step} OF {totalSteps}
        </span>
        <h1 className="wizard-heading">{heading}</h1>
        <hr className="rule" />
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!nextDisabled) onNext?.();
          }}
        >
          <div className="wizard-body">{children}</div>
          <footer className="wizard-footer">
            <div>
              {backHref ? (
                <Link href={backHref} className="btn-text">
                  &larr; Back
                </Link>
              ) : (
                <span />
              )}
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={nextDisabled}
            >
              {nextLabel}
            </button>
          </footer>
        </form>
      </div>

      <style>{`
        .wizard-topbar {
          max-width: 720px;
          margin: 0 auto;
          padding: 24px 24px 0;
        }
        .wizard-topbar .wordmark {
          font-family: var(--font-display);
          font-size: 20px;
          font-weight: 500;
          color: var(--accent);
          border: none;
        }
        .wizard-wrap {
          max-width: 720px;
          margin: 0 auto;
          padding: 28px 24px 48px;
        }
        .wizard-progress {
          display: grid;
          grid-template-columns: repeat(${totalSteps}, minmax(0, 1fr));
          gap: 12px;
          list-style: none;
          padding: 0;
          margin: 0 0 28px;
        }
        .wizard-progress li {
          border-top: 2px solid var(--line);
          padding-top: 8px;
          color: var(--muted);
          font-size: 14px;
        }
        .wizard-progress li.is-complete { border-color: var(--accent); }
        .wizard-progress li[aria-current="step"] {
          border-color: var(--accent);
          color: var(--ink);
          font-weight: 600;
        }
        .wizard-step-number {
          font-variant-numeric: tabular-nums;
          margin-right: 4px;
        }
        .wizard-heading {
          font-size: 44px;
          line-height: 1.05;
          margin: 12px 0 24px;
        }
        .wizard-heading + .rule { margin: 24px 0; }
        .wizard-body { margin: 24px 0; }
        .wizard-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          margin-top: 28px;
        }
        @media (max-width: 820px) {
          .wizard-heading { font-size: 32px; }
          .wizard-progress { display: flex; gap: 12px; }
          .wizard-progress li { flex: 1; min-width: 0; }
          .wizard-progress li:nth-child(2) { flex: 1.4; }
          .wizard-step-number { display: block; margin-right: 0; }
          .wizard-footer .btn-primary { flex: 1; }
        }
      `}</style>
    </main>
  );
}
