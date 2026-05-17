import Link from "next/link";

export default function CheckoutCancelPage() {
  return (
    <main>
      <nav className="topbar">
        <Link href="/" className="wordmark">
          openllmrank
        </Link>
      </nav>
      <div className="wrap cancel-wrap">
        <span className="kicker">Cart saved</span>
        <h1>Picked up where you left off.</h1>
        <p className="lede">
          We didn&rsquo;t charge you anything. Your brand, competitors, and
          prompts are still saved &mdash; you can review them and continue
          whenever you&rsquo;re ready.
        </p>
        <hr className="rule" />
        <p>
          <Link href="/wizard/review" className="btn-primary">
            Continue to review
          </Link>
        </p>
      </div>

      <style>{`
        .topbar { max-width: 720px; margin: 0 auto; padding: 24px 24px 0; }
        .wordmark { font-family: var(--font-display); font-size: 20px; font-weight: 500; color: var(--accent); border: none; }
        .cancel-wrap { max-width: 720px; margin: 0 auto; padding: 48px 24px 96px; }
        .cancel-wrap h1 { font-size: 44px; line-height: 1.05; margin: 16px 0 24px; }
        .lede { font-size: 19px; color: var(--muted); max-width: 620px; }
        @media (max-width: 820px) {
          .cancel-wrap h1 { font-size: 32px; }
        }
      `}</style>
    </main>
  );
}
