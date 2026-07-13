import Link from "next/link";
import { ContactLink } from "./_components/contact-link";

// Marketing landing page. Editorial long-scroll, mirrors the approved
// hero mockup at:
// ~/.gstack/projects/foodaka-openllmrank/designs/marketing-hero-20260517/variant-A.png
// Same visual system as packages/cli/src/core/render-html.ts.

export default function HomePage() {
  return (
    <>
      <nav className="site-nav">
        <div className="wordmark">openllmrank</div>
        <ul className="site-nav-links">
          <li>
            <a href="#how-it-works">How it works</a>
          </li>
          <li>
            <a href="#sample">Sample report</a>
          </li>
          <li>
            <a href="#faq">FAQ</a>
          </li>
        </ul>
      </nav>

      <main>
        <section className="hero wrap">
          <div className="hero-text">
            <span className="kicker">AI-search visibility report</span>
            <h1 className="hero-headline">
              When buyers ask AI, does your brand make the shortlist?
            </h1>
            <p className="hero-sub">
              We run the buying questions your customers actually type through
              grounded OpenAI and Anthropic APIs, watch what they recommend,
              and ship a $29.99 report showing where you&rsquo;re losing visibility
              and what to do next.
            </p>
            <p className="hero-actions">
              <Link href="/wizard/brand" className="btn-primary">
                Get my report &mdash; $29.99
              </Link>
              <a href="#sample" className="btn-text">
                See a sample report
              </a>
            </p>
          </div>

          <aside className="hero-sample" aria-label="Sample report data">
            <span className="kicker sample-kicker">sample</span>
            <p className="sample-question">
              &ldquo;What&rsquo;s the best CRM for B2B SaaS?&rdquo;
            </p>
            <div className="rate-row">
              <span className="label">Your brand</span>
              <div className="bar">
                <span style={{ width: "12%" }} />
              </div>
              <span className="value">12%</span>
            </div>
            <div className="rate-row">
              <span className="label">Competitor A</span>
              <div className="bar alt">
                <span style={{ width: "67%" }} />
              </div>
              <span className="value">67%</span>
            </div>
            <div className="rate-row">
              <span className="label">Competitor B</span>
              <div className="bar alt">
                <span style={{ width: "41%" }} />
              </div>
              <span className="value">41%</span>
            </div>
          </aside>
        </section>

        <section id="how-it-works" className="wrap">
          <hr className="rule" />
          <span className="kicker">How it works</span>
          <h2 className="section-headline">
            Three steps. One Monday morning.
          </h2>

          <div className="steps">
            <article className="step">
              <span className="step-num">01</span>
              <h3>Tell us about your brand</h3>
              <p>
                A short wizard asks for your brand name, a handful of
                competitors, and a few buying questions your customers ask AI
                tools. Takes about three minutes.
              </p>
            </article>
            <article className="step">
              <span className="step-num">02</span>
              <h3>We run a repeatable test</h3>
              <p>
                Behind the scenes we run each prompt three times through current
                OpenAI and Anthropic API models with web search, capture every
                answer, and extract every brand citation. No spreadsheets. No screenshots.
              </p>
            </article>
            <article className="step">
              <span className="step-num">03</span>
              <h3>You get the receipts</h3>
              <p>
                Within fifteen minutes, an emailed editorial report tells you
                where you&rsquo;re cited, where your competitors are cited
                instead, and a prioritized action plan linked to the source
                evidence we captured.
              </p>
            </article>
          </div>
        </section>

        <section id="sample" className="wrap">
          <hr className="rule" />
          <span className="kicker">Sample report</span>
          <h2 className="section-headline">
            This is what you receive.
          </h2>
          <p className="section-sub">
            An illustrative dataset rendered through the exact report code a
            paying customer gets. Click through &mdash; it&rsquo;s a real HTML
            page, not a screenshot.
          </p>
          <p>
            <Link href="/sample-report.html" className="btn-text">
              Open the sample report &rarr;
            </Link>
          </p>
        </section>

        <section id="faq" className="wrap">
          <hr className="rule" />
          <span className="kicker">Frequently asked</span>
          <h2 className="section-headline">Questions worth asking.</h2>

          <dl className="faq">
            <dt>What exactly do I get for $29.99?</dt>
            <dd>
              One AI-search visibility report, delivered by email within
              fifteen minutes of payment. It includes citation rates per
              prompt, a gap analysis versus your competitors, and concrete
              content recommendations to close the gaps we found. If we
              can&rsquo;t generate your report, we refund automatically
              within an hour.
            </dd>

            <dt>Why not just ask ChatGPT myself?</dt>
            <dd>
              You can. But AI answers vary run to run, web search
              results shift, and a single conversation is a sample size of
              one. We run your prompts multiple times across multiple models
              with web search, then parse every response for brand mentions.
              You get the trend, not the anecdote.
            </dd>

            <dt>Is this exactly what I will see in the ChatGPT or Claude app?</dt>
            <dd>
              No, and any honest visibility tool should say so. We query the
              providers&rsquo; grounded APIs. Consumer apps can use different model
              versions, system instructions, rollouts, and personalization.
              The report is a reproducible directional benchmark, not a promise
              that every user will receive the same answer.
            </dd>

            <dt>Will this be a one-time report, or a subscription?</dt>
            <dd>
              One-time. There is no subscription and no recurring charge.
              Purchase another report when you want a fresh snapshot, or use
              the open-source CLI to run the same workflow on your own schedule.
            </dd>

            <dt>Is the underlying CLI open source?</dt>
            <dd>
              Yes. The full <a href="https://github.com/foodaka/openllmrank">openllmrank CLI</a> is
              MIT-licensed on npm. Bring your own OpenAI, Anthropic, Gemini,
              Perplexity, or xAI key
              and you can self-host the entire system for the cost of a few
              API calls. We charge for the hosted version because most
              marketing leads can&rsquo;t (and shouldn&rsquo;t need to) run
              a CLI.
            </dd>

            <dt>What if my brand has zero citations?</dt>
            <dd>
              You&rsquo;ll get the most useful report of all. We&rsquo;ll
              show you exactly which competitors are getting cited, on which
              prompts, and — when the provider returns source citations —
              which pages may be contributing. The
              empty state is the value &mdash; you can&rsquo;t fix what you
              can&rsquo;t see.
            </dd>
          </dl>
        </section>

        <section className="wrap cta-final">
          <hr className="rule" />
          <h2 className="section-headline">Ready to investigate?</h2>
          <p>
            <Link href="/wizard/brand" className="btn-primary">
              Get my report &mdash; $29.99
            </Link>
          </p>
        </section>

        <footer className="wrap site-footer">
          <span className="muted">
            openllmrank &middot; Privacy-friendly, open-source analytics for AI search visibility &middot;{" "}
            <Link href="/privacy">Privacy</Link> &middot;{" "}
            <Link href="/terms">Terms</Link> &middot;{" "}
            <ContactLink>Contact</ContactLink> &middot;{" "}
            <a href="https://github.com/foodaka/openllmrank">Open source CLI</a>
          </span>
        </footer>
      </main>

      <style>{`
        .site-nav {
          max-width: 1120px;
          margin: 0 auto;
          padding: 24px 28px 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .wordmark {
          font-family: var(--font-display);
          font-size: 22px;
          font-weight: 500;
          color: var(--accent);
        }
        .site-nav-links {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          gap: 24px;
        }
        .site-nav-links a {
          font-size: 14px;
          color: var(--ink);
        }
        .site-nav-links a:hover {
          color: var(--accent);
          border-bottom-color: var(--accent);
        }

        .hero {
          display: grid;
          grid-template-columns: 1.2fr 0.9fr;
          gap: 48px;
          padding-top: 64px;
          padding-bottom: 64px;
          align-items: center;
        }
        .hero-headline {
          font-size: 64px;
          line-height: 0.98;
          margin: 12px 0 20px;
        }
        .hero-sub {
          font-size: 18px;
          color: var(--muted);
          max-width: 620px;
          margin-bottom: 28px;
        }
        .hero-actions {
          display: flex;
          gap: 16px;
          align-items: center;
        }
        .hero-sample {
          background: var(--soft);
          border: 1px solid var(--line);
          border-radius: var(--radius-md);
          padding: 28px;
        }
        .sample-kicker {
          background: var(--paper);
          border: 1px solid var(--line);
          padding: 4px 8px;
          border-radius: var(--radius-pill);
          display: inline-block;
          margin-bottom: 16px;
          font-size: 10px;
        }
        .sample-question {
          font-family: var(--font-display);
          font-size: 20px;
          margin-bottom: 16px;
          color: var(--ink);
        }

        .section-headline {
          font-size: 44px;
          line-height: 1.05;
          margin: 12px 0 24px;
          max-width: 720px;
        }
        .section-sub {
          font-size: 18px;
          color: var(--muted);
          max-width: 720px;
        }

        .steps {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 48px;
          margin-top: 28px;
        }
        .step {
          display: block;
        }
        .step-num {
          font-family: var(--font-display);
          font-size: 32px;
          color: var(--accent);
          display: block;
          margin-bottom: 12px;
        }
        .step h3 {
          font-size: 22px;
          margin-bottom: 12px;
        }
        .step p {
          color: var(--muted);
          font-size: 16px;
        }

        .faq dt {
          font-family: var(--font-display);
          font-size: 22px;
          margin-top: 32px;
          margin-bottom: 12px;
          color: var(--ink);
        }
        .faq dt:first-child { margin-top: 16px; }
        .faq dd {
          margin-left: 0;
          color: var(--muted);
          font-size: 17px;
          line-height: 1.6;
          max-width: 720px;
        }

        .cta-final { padding-bottom: 96px; }
        .cta-final h2 { margin-bottom: 28px; }

        .site-footer {
          padding-top: 24px;
          padding-bottom: 48px;
          border-top: 1px solid var(--line);
          color: var(--muted);
          font-size: 14px;
        }

        @media (max-width: 820px) {
          .hero {
            grid-template-columns: 1fr;
            gap: 32px;
            padding-top: 32px;
          }
          .hero-headline { font-size: 44px; }
          .hero-actions { flex-direction: column; align-items: flex-start; }
          .btn-primary { width: 100%; text-align: center; }
          .site-nav-links { display: none; }
          .section-headline { font-size: 32px; }
          .steps { grid-template-columns: 1fr; gap: 32px; }
        }
      `}</style>
    </>
  );
}
