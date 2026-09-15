"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WizardShell } from "../wizard-shell";
import {
  clearWizardState,
  getWizardMode,
  readWizardState,
  type WizardState,
  type WizardMode,
  wizardPath,
} from "@/lib/wizard-state";
import { HostedConfigSchema } from "@openllmrank/shared/config";

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  perplexity: "Perplexity",
  xai: "xAI Grok",
};

export default function WizardReviewPage() {
  const router = useRouter();
  const [state, setState] = useState<WizardState | null>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [agreeError, setAgreeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [mode, setMode] = useState<WizardMode>("one-shot");

  useEffect(() => {
    const nextMode = getWizardMode();
    setMode(nextMode);
    const s = readWizardState(nextMode);
    if (!s.brand?.name) {
      router.replace(wizardPath("/wizard/brand", nextMode));
      return;
    }
    if (s.competitors.length === 0) {
      router.replace(wizardPath("/wizard/competitors", nextMode));
      return;
    }
    if (s.prompts.length === 0) {
      router.replace(wizardPath("/wizard/prompts", nextMode));
      return;
    }
    setState(s);
    if (s.email) setEmail(s.email);
  }, [router]);

  function validateEmail(): boolean {
    const v = email.trim();
    if (!v) {
      setEmailError("Email is required so we can send your report.");
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setEmailError("That doesn't look like a valid email.");
      return false;
    }
    setEmailError(null);
    return true;
  }

  async function handleSubmit() {
    if (!state || !state.brand) return;
    const addMode = mode === "add-brand";
    if (!addMode && !validateEmail()) return;
    if (!addMode && !agreed) {
      setAgreeError(
        "Please confirm you agree to the Terms and Privacy Policy.",
      );
      return;
    }
    setAgreeError(null);

    setSubmitting(true);
    setSubmitError(null);

    try {
      // Build the HostedConfig payload. Server re-validates with the same
      // schema (defense in depth).
      const config = {
        brand: state.brand,
        competitors: state.competitors,
        prompts: state.prompts,
        providers: state.providers,
        samples_per_prompt: 3,
        concurrency_per_provider: 4,
      };
      // Client-side validation matches server-side
      const parsed = HostedConfigSchema.safeParse(config);
      if (!parsed.success) {
        setSubmitError(
          parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; "),
        );
        setSubmitting(false);
        return;
      }

      const res = await fetch(addMode ? "/api/brands" : "/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          addMode
            ? {
                name: parsed.data.brand.name,
                website: parsed.data.brand.website,
                category: parsed.data.brand.category,
                aliases: parsed.data.brand.aliases.join(", "),
                competitors: parsed.data.competitors
                  .map((competitor) =>
                    competitor.aliases.length > 0
                      ? `${competitor.name} | ${competitor.aliases.join(", ")}`
                      : competitor.name,
                  )
                  .join("\n"),
                prompts: parsed.data.prompts.join("\n"),
              }
            : { config: parsed.data, email: email.trim() },
        ),
      });
      const data = (await res.json()) as {
        url?: string;
        mode?: string;
        brand_id?: string;
        brand?: { id: string };
        error?: string;
        detail?: unknown;
      };
      if (!res.ok || data.error) {
        setSubmitError(
          data.error ?? (addMode ? "Could not add brand." : "Could not create checkout session."),
        );
        setSubmitting(false);
        return;
      }

      if (addMode) {
        const brandId = data.brand_id ?? data.brand?.id;
        if (!brandId) {
          setSubmitError("Brand was added without a dashboard destination.");
          setSubmitting(false);
          return;
        }
        clearWizardState(mode);
        router.push(`/dashboard/${brandId}`);
        return;
      }

      // Don't clear wizard state until we're actually redirecting — if the
      // user hits back from Stripe we want it preserved.
      if (!data.url) {
        setSubmitError("Could not create checkout session.");
        setSubmitting(false);
        return;
      }
      window.location.assign(data.url);
    } catch (e) {
      setSubmitError((e as Error).message ?? "Network error.");
      setSubmitting(false);
    }
  }

  if (!state || !state.brand) return null;

  const promptCount = state.prompts.length;
  const samples = 3;
  const providerCount = state.providers.length;
  const totalCalls = promptCount * samples * providerCount;

  return (
    <WizardShell
      step={4}
      kicker={mode === "add-brand" ? "" : "Review & pay"}
      heading={mode === "add-brand" ? "Ready to keep watch?" : "Ready to investigate?"}
      backHref={wizardPath("/wizard/prompts", mode)}
      onNext={handleSubmit}
      nextLabel={
        mode === "add-brand"
          ? submitting
            ? "Adding brand..."
            : "Add brand"
          : submitting
            ? "Creating checkout..."
            : "Pay & generate report — $29.99"
      }
      nextDisabled={submitting || (mode !== "add-brand" && !agreed)}
    >
      <dl className="review-summary">
        <div>
          <dt>Brand</dt>
          <dd>
            {state.brand.name}
            {state.brand.category && <span className="muted"> · {state.brand.category}</span>}
          </dd>
        </div>
        {state.brand.website && (
        <div>
          <dt>Website</dt>
          <dd>{new URL(state.brand.website).hostname}</dd>
        </div>
        )}
        <div>
          <dt>Competitors</dt>
          <dd>
            {state.competitors.map((c) => c.name).join(", ")}{" "}
            <span className="muted">({state.competitors.length})</span>
          </dd>
        </div>
        <div>
          <dt>Prompts</dt>
          <dd>
            {promptCount} {promptCount === 1 ? "prompt" : "prompts"}
          </dd>
        </div>
        <div>
          <dt>Providers</dt>
          <dd>
            {state.providers
              .map((provider) => PROVIDER_NAMES[provider.id] ?? provider.id)
              .join(" and ")}
          </dd>
        </div>
        <div>
          <dt>What we&rsquo;ll do</dt>
          <dd>
            {totalCalls} grounded LLM calls ({promptCount} × {samples} samples
            × {providerCount} providers). Estimated time: ~15 minutes.
          </dd>
        </div>
      </dl>

      <hr className="rule" />

      {mode === "add-brand" ? (
        <p className="note">
          Your active subscription covers this brand. We&rsquo;ll queue its first
          tracking run after it is added.
        </p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="email">Where should we send your report?</label>
            <input
              id="email"
              type="text"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={validateEmail}
              placeholder="you@company.com"
              aria-invalid={emailError ? "true" : "false"}
              aria-describedby={emailError ? "email-error" : undefined}
            />
            {emailError && (
              <span className="field-error" id="email-error" role="alert">
                {emailError}
              </span>
            )}
          </div>

          <div className="agree-row">
            <label className="agree-label">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => {
                  setAgreed(e.target.checked);
                  if (e.target.checked) setAgreeError(null);
                }}
                aria-invalid={agreeError ? "true" : "false"}
                aria-describedby={agreeError ? "agree-error" : undefined}
              />
              <span>
                I agree to the{" "}
                <Link href="/terms" target="_blank" rel="noopener noreferrer">
                  Terms of Service
                </Link>{" "}
                and acknowledge the{" "}
                <Link href="/privacy" target="_blank" rel="noopener noreferrer">
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
            {agreeError && (
              <span className="field-error" id="agree-error" role="alert">
                {agreeError}
              </span>
            )}
          </div>

          <div className="trust-note">
            <p>
              <strong>Refund-on-failure promise:</strong> if we can&rsquo;t
              generate your report, we refund automatically within an hour. No
              questions asked.
            </p>
          </div>
        </>
      )}

      {submitError && (
        <p className="submit-error" role="alert">
          {submitError}
        </p>
      )}

      <style>{`
        .review-summary {
          margin: 24px 0;
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .review-summary > div {
          display: grid;
          grid-template-columns: 160px 1fr;
          gap: 24px;
          padding: 16px 0;
          border-bottom: 1px solid var(--line);
        }
        .review-summary dt {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.11em;
          color: var(--accent);
          font-weight: 700;
        }
        .review-summary dd {
          margin: 0;
          font-size: 17px;
          color: var(--ink);
        }
        .muted { color: var(--muted); }
        .agree-row {
          margin: 20px 0 0;
        }
        .agree-label {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          font-size: 15px;
          color: var(--ink);
          line-height: 1.5;
          cursor: pointer;
        }
        .agree-label input[type="checkbox"] {
          margin-top: 3px;
          width: 18px;
          height: 18px;
          flex-shrink: 0;
          accent-color: var(--accent);
          cursor: pointer;
        }
        .agree-label a {
          color: var(--accent);
        }
        .trust-note {
          background: var(--soft);
          border: 1px solid var(--line);
          border-left: 3px solid var(--accent);
          padding: 16px 20px;
          margin: 24px 0 0;
          border-radius: var(--radius-md);
        }
        .trust-note p { margin: 0; color: var(--muted); font-size: 15px; }
        .trust-note strong { color: var(--ink); }
        .submit-error {
          margin-top: 16px;
          padding: 12px 16px;
          background: rgba(159, 58, 33, 0.08);
          border: 1px solid var(--loss);
          border-radius: var(--radius-md);
          color: var(--loss);
          font-size: 15px;
        }
        @media (max-width: 820px) {
          .review-summary > div {
            grid-template-columns: 1fr;
            gap: 8px;
          }
        }
      `}</style>
    </WizardShell>
  );
}
