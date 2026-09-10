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
  description?: ReactNode;
  backHref?: string;
  cancelHref?: string;
  cancelLabel?: string;
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
  description,
  backHref,
  cancelHref,
  cancelLabel = "Cancel",
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
        <nav className="wizard-steps" aria-label="Setup progress">
          {["Brand", "Rivals", "Questions", "Review"].map((label, index) => {
            const stepNumber = index + 1;
            const current = stepNumber === step;
            return (
              <span
                className={`wizard-step${current ? " current" : ""}${stepNumber < step ? " complete" : ""}`}
                aria-current={current ? "step" : undefined}
                key={label}
              >
                {stepNumber} {label}
              </span>
            );
          })}
        </nav>
        <span className="kicker">
          {kicker ? `${kicker.toUpperCase()} ` : ""}
          {kicker && <>&middot; </>}STEP {step} OF {totalSteps}
        </span>
        <h1 className="wizard-heading">{heading}</h1>
        {description && <p className="wizard-description">{description}</p>}
        <hr className="rule" />
        <div className="wizard-body">{children}</div>
        <footer className="wizard-footer">
          <div>
            {backHref ? (
              <Link href={backHref} className="btn-text">
                &larr; Back
              </Link>
            ) : cancelHref ? (
              <Link href={cancelHref} className="btn-text">
                {cancelLabel}
              </Link>
            ) : (
              <span />
            )}
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={onNext}
            disabled={nextDisabled}
          >
            {nextLabel}
          </button>
        </footer>
      </div>

      <style>{`
        .wizard-topbar {
          max-width: 1120px;
          margin: 0 auto;
          padding: 24px 32px 0;
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
          padding: 48px 24px 96px;
        }
        .wizard-steps {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 32px;
        }
        .wizard-step {
          border: 1px solid var(--line);
          border-radius: var(--radius-pill);
          background: var(--soft);
          color: var(--muted);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.06em;
          padding: 8px 12px;
          text-transform: uppercase;
        }
        .wizard-step.current {
          background: var(--accent);
          border-color: var(--accent);
          color: var(--paper);
        }
        .wizard-step.complete {
          color: var(--accent);
        }
        .wizard-heading {
          font-size: 44px;
          line-height: 1.05;
          margin: 16px 0 24px;
        }
        .wizard-description {
          color: var(--muted);
          font-size: 17px;
          margin: -8px 0 24px;
          max-width: 58ch;
        }
        .wizard-body { margin: 24px 0; }
        .wizard-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 48px;
        }
        @media (max-width: 820px) {
          .wizard-topbar { padding: 20px 16px 0; }
          .wizard-steps { gap: 6px; margin-bottom: 24px; }
          .wizard-step { padding: 7px 9px; font-size: 11px; }
          .wizard-heading { font-size: 32px; }
          .wizard-footer .btn-primary { flex: 1; }
        }
      `}</style>
    </main>
  );
}
