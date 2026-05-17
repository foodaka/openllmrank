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
        <span className="kicker">
          {kicker.toUpperCase()} &middot; STEP {step} OF {totalSteps}
        </span>
        <h1 className="wizard-heading">{heading}</h1>
        <hr className="rule" />
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
          padding: 48px 24px 96px;
        }
        .wizard-heading {
          font-size: 44px;
          line-height: 1.05;
          margin: 16px 0 24px;
        }
        .wizard-body { margin: 24px 0; }
        .wizard-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 48px;
        }
        @media (max-width: 820px) {
          .wizard-heading { font-size: 32px; }
          .wizard-footer .btn-primary { flex: 1; }
        }
      `}</style>
    </main>
  );
}
