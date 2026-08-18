"use client";

// Monitoring subscription confirmation.
//   1. Real mode: Stripe already fired the webhook; this page just confirms
//      and sets expectations (first report arrives by email in minutes).
//   2. local_stub mode (?stub=1): post a synthetic checkout.session.completed
//      with kind=monitor and synthesized customer/subscription ids so the
//      monitor row is actually created locally (mirrors /checkout/success).

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function MonitorSuccessInner() {
  const params = useSearchParams();
  const isStub = params.get("stub") === "1";
  const sessionId = params.get("session_id") ?? "";
  const domain = params.get("domain") ?? "";
  const email = params.get("email") ?? "";
  const [stubStatus, setStubStatus] = useState<"idle" | "ok" | "error">("idle");

  useEffect(() => {
    if (!isStub || !sessionId || stubStatus !== "idle") return;
    void fetch("/api/webhook/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "x-stub-event": "1" },
      body: JSON.stringify({
        id: `evt_stub_${sessionId}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: sessionId,
            customer: `cus_stub_${sessionId}`,
            subscription: `sub_stub_${sessionId}`,
            customer_details: { email },
            metadata: {
              kind: "monitor",
              domain,
              origin: `https://${domain}`,
            },
          },
        },
      }),
    }).then(
      (res) => setStubStatus(res.ok ? "ok" : "error"),
      () => setStubStatus("error"),
    );
  }, [isStub, sessionId, domain, email, stubStatus]);

  return (
    <article className="wrap">
      <span className="kicker">Monitoring active</span>
      <h1>We&rsquo;re watching {domain || "your site"}.</h1>
      <p className="sub">
        Your first monitored crawl starts within a minute — the baseline
        report lands in your inbox shortly after. From then on: one email a
        week. An all-clear when everything&rsquo;s healthy, an alert the
        moment a page becomes unreachable, a link breaks, or a crawler gets
        blocked.
      </p>
      <p className="muted">
        Manage or cancel any time from the billing-portal link in every
        email. No account needed.
      </p>
      {isStub ? (
        <p className="crawl-banner" role="status">
          local_stub: synthetic subscription webhook{" "}
          {stubStatus === "ok" ? "delivered — monitor created" : stubStatus === "error" ? "FAILED — check the dev server logs" : "sending…"}
        </p>
      ) : null}
      <p>
        <Link href="/check" className="btn-text">
          &larr; Back to the crawl check
        </Link>
      </p>
    </article>
  );
}

export default function MonitorSuccessPage() {
  return (
    <Suspense fallback={<article className="wrap"><h1>Loading…</h1></article>}>
      <MonitorSuccessInner />
    </Suspense>
  );
}
