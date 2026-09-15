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
  // A subscription bought from the wizard: no session exists yet, the
  // account is being created by the webhook, so nothing to poll.
  const isTrackingPlan = params.get("plan") === "tracking";
  const leadId = params.get("lead_id");
  const userId = params.get("user_id");
  const subscriptionId = params.get("subscription_id");
  const customerId = params.get("customer_id");
  const [stubStatus, setStubStatus] = useState<
    "idle" | "firing" | "ok" | "err"
  >("idle");
  const [stubErr, setStubErr] = useState<string | null>(null);
  // Subscription confirmation. Stripe's webhook usually lands within a few
  // seconds of the redirect; the page says "ready" only once Postgres has
  // the row, so a customer never opens a dashboard that still says Subscribe.
  const [confirm, setConfirm] = useState<"waiting" | "ready" | "timeout">("waiting");

  useEffect(() => {
    // Persist nothing else — wizard state can be cleared now.
    clearWizardState();
  }, []);

  useEffect(() => {
    if (!isStub || !sessionId) return;
    if (isSubscription && (!subscriptionId || !customerId || (!userId && !leadId))) return;
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
                  metadata: userId
                    ? { user_id: userId }
                    : { lead_id: leadId, kind: "tracking" },
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

  useEffect(() => {
    if (!isSubscription || isTrackingPlan) return;
    // In stub mode the synthetic webhook fires from this page; wait for it.
    if (isStub && stubStatus !== "ok" && stubStatus !== "err") return;
    let cancelled = false;
    const startedAt = Date.now();
    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch("/api/billing/status", { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { status: string | null };
          if (body.status && body.status !== "canceled") {
            setConfirm("ready");
            return;
          }
        }
      } catch {
        // transient; keep polling
      }
      if (Date.now() - startedAt > 30_000) {
        setConfirm("timeout");
        return;
      }
      setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [isSubscription, isTrackingPlan, isStub, stubStatus]);

  const subscriptionHeadline = isTrackingPlan
    ? "Your tracking has started."
    : confirm === "ready"
      ? "Your tracking is ready."
      : confirm === "timeout"
        ? "Stripe is still confirming your payment."
        : "Confirming your subscription…";
  const subscriptionLede = isTrackingPlan
    ? "We\u2019re running your first report now; expect it by email in about fifteen minutes. A second email lets you set a password for your dashboard, where every weekly run lands from here on."
    : confirm === "ready"
      ? "Your brands are set to run on a recurring schedule. You can follow the trend from your dashboard."
      : confirm === "timeout"
        ? "Your dashboard will update within a few minutes. If Billing still shows Subscribe after that, reply to your receipt email and we will sort it out."
        : "This usually takes a few seconds.";

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
        <h1 aria-live="polite">
          {isSubscription ? subscriptionHeadline : "Your report is being generated."}
        </h1>
        <p className="lede">
          {isSubscription
            ? subscriptionLede
            : "A confirmation just landed in your inbox. We\u2019re now sending the questions you gave us across five grounded AI providers. Expect the report by email in about fifteen minutes."}
        </p>

        <hr className="rule" />

        <p className="next-steps">
          {isSubscription
            ? isTrackingPlan || confirm === "ready"
              ? "You can close this tab. We\u2019ll handle the next run."
              : "Keep this tab open for a moment."
            : "You can close this tab. We\u2019ll handle the rest."}
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
          <Link
            href={
              isTrackingPlan
                ? "/login"
                : isSubscription
                  ? confirm === "timeout" ? "/dashboard/billing" : "/dashboard"
                  : "/"
            }
            className="btn-text"
          >
            {isTrackingPlan
              ? "Sign in once you have set your password"
              : isSubscription
                ? confirm === "timeout" ? "Open billing" : "Go to dashboard"
                : "\u2190 Back to openllmrank.io"}
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
