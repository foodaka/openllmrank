"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { clearWizardState } from "@/lib/wizard-state";

// Two responsibilities:
//   1. Display the editorial "order received" confirmation.
//   2. In local_stub mode (?stub=1), post a synthetic webhook event to
//      /api/webhook/stripe so the job actually flips to 'paid' locally.
//      This lets the full end-to-end flow be exercised without Stripe.
//
// useSearchParams forces client-side rendering. Next.js 15 requires a
// Suspense boundary around the component that uses it so the rest of the
// route can prerender. Otherwise `next build` fails with
// "useSearchParams() should be wrapped in a suspense boundary". (Fix
// caught during Vercel-style production build smoke test on 2026-05-18.)

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutSuccessInner />
    </Suspense>
  );
}

function CheckoutSuccessInner() {
  const params = useSearchParams();
  const sessionId = params.get("session_id");
  const isStub = params.get("stub") === "1";
  const isSubscription = params.get("subscription") === "1";
  const leadId = params.get("lead_id");
  const userId = params.get("user_id");
  const subscriptionId = params.get("subscription_id");
  const customerId = params.get("customer_id");
  const [stubStatus, setStubStatus] = useState<
    "idle" | "firing" | "ok" | "err"
  >("idle");
  const [stubErr, setStubErr] = useState<string | null>(null);

  useEffect(() => {
    // Persist nothing else — wizard state can be cleared now.
    clearWizardState();
  }, []);

  useEffect(() => {
    if (!isStub || !sessionId) return;
    if (isSubscription && (!userId || !subscriptionId || !customerId)) return;
    if (!isSubscription && !leadId) return;
    setStubStatus("firing");
    fetch("/api/webhook/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-stub-event": "1",
      },
      body: JSON.stringify({
        id: `evt_stub_${sessionId}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: sessionId,
            ...(isSubscription
              ? {
                  mode: "subscription",
                  subscription: subscriptionId,
                  customer: customerId,
                  metadata: { user_id: userId },
                }
              : {
                  payment_intent: `pi_stub_${sessionId}`,
                  metadata: { lead_id: leadId },
                }),
          },
        },
      }),
    })
      .then((r) => {
        if (!r.ok) {
          setStubStatus("err");
          return r.text().then((t) => setStubErr(t));
        }
        setStubStatus("ok");
        return null;
      })
      .catch((e) => {
        setStubStatus("err");
        setStubErr((e as Error).message);
      });
  }, [
    isStub,
    isSubscription,
    sessionId,
    leadId,
    userId,
    subscriptionId,
    customerId,
  ]);

  return (
    <main>
      <nav className="topbar">
        <Link href="/" className="wordmark">
          openllmrank
        </Link>
      </nav>
      <div className="wrap success-wrap">
        <span className="kicker">
          {isSubscription ? "Subscription started" : "Order received"}
        </span>
        <h1>
          {isSubscription
            ? "Your tracking is ready."
            : "Your report is being generated."}
        </h1>
        <p className="lede">
          {isSubscription
            ? "Your brands are set to run on a recurring schedule. You can follow the trend from your dashboard."
            : "A confirmation just landed in your inbox. We&rsquo;re now sending the questions you gave us across five grounded AI providers. Expect the report by email in about fifteen minutes."}
        </p>

        <hr className="rule" />

        <p className="next-steps">
          {isSubscription
            ? "You can close this tab. We&rsquo;ll handle the next run."
            : "You can close this tab. We&rsquo;ll handle the rest."}
        </p>

        {isStub && (
          <aside className="stub-note">
            <strong>Local-stub mode.</strong>{" "}
            {stubStatus === "firing" && "Firing synthetic webhook…"}
            {stubStatus === "ok" &&
              (isSubscription
                ? "Synthetic webhook delivered. The subscription is active in Postgres."
                : "Synthetic webhook delivered. The job is marked paid in Postgres.")}
            {stubStatus === "err" && (
              <span>
                Webhook stub failed: {stubErr}
              </span>
            )}
          </aside>
        )}

        <p>
          <Link href={isSubscription ? "/dashboard" : "/"} className="btn-text">
            {isSubscription
              ? "Go to dashboard"
              : "\u2190 Back to openllmrank.com"}
          </Link>
        </p>
      </div>

      <style>{`
        .topbar { max-width: 720px; margin: 0 auto; padding: 24px 24px 0; }
        .wordmark { font-family: var(--font-display); font-size: 20px; font-weight: 500; color: var(--accent); border: none; }
        .success-wrap { max-width: 720px; margin: 0 auto; padding: 48px 24px 96px; }
        .success-wrap h1 { font-size: 44px; line-height: 1.05; margin: 16px 0 24px; }
        .lede { font-size: 19px; color: var(--muted); max-width: 620px; margin-bottom: 16px; }
        .next-steps { color: var(--muted); font-size: 17px; }
        .stub-note {
          background: var(--soft);
          border: 1px solid var(--line);
          border-left: 3px solid var(--accent-2);
          padding: 16px 20px;
          margin: 24px 0;
          border-radius: var(--radius-md);
          color: var(--muted);
          font-size: 15px;
        }
        .stub-note strong { color: var(--ink); }
        @media (max-width: 820px) {
          .success-wrap h1 { font-size: 32px; }
        }
      `}</style>
    </main>
  );
}
