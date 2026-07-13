import Link from "next/link";
import { ContactLink } from "../_components/contact-link";

export const metadata = {
  title: "Privacy Policy — openllmrank",
  description:
    "How openllmrank collects, uses, and protects your information.",
};

export default function PrivacyPage() {
  return (
    <>
      <nav className="site-nav">
        <Link href="/" className="wordmark">openllmrank</Link>
        <ul className="site-nav-links">
          <li><Link href="/">Home</Link></li>
          <li><Link href="/terms">Terms</Link></li>
        </ul>
      </nav>

      <main>
        <article className="wrap legal">
          <span className="kicker">Privacy Policy</span>
          <h1>Privacy Policy</h1>
          <p className="muted updated">Last updated: May 19, 2026</p>

          <p>
            openllmrank (&ldquo;we,&rdquo; &ldquo;us&rdquo;) operates the
            website at openllmrank.xyz and the related AI-search visibility
            report service. This policy explains what we collect, why, who
            we share it with, and what rights you have. We do not sell your
            personal data to anyone, ever.
          </p>

          <h2>1. What we collect</h2>
          <p>When you purchase a report, we collect:</p>
          <ul>
            <li>
              <strong>Email address</strong> &mdash; so we can deliver
              your report and any service-related messages.
            </li>
            <li>
              <strong>Brand information</strong> &mdash; the brand name,
              website, category, competitor names, and buying questions you
              provide through the signup wizard. This is the input we send
              to grounded OpenAI and Anthropic APIs on your behalf.
            </li>
            <li>
              <strong>Payment information</strong> &mdash; collected
              directly by Stripe. We never see or store your card number.
              We do store a Stripe customer ID and the payment status
              (paid, refunded) so we can issue your report and handle
              refunds.
            </li>
            <li>
              <strong>Basic site analytics</strong> &mdash; aggregate
              page views and traffic sources via Vercel Analytics, which
              is cookieless and does not identify individual visitors.
            </li>
          </ul>

          <h2>2. How we use it</h2>
          <p>We use the data above to:</p>
          <ul>
            <li>Generate and email the report you paid for.</li>
            <li>Process your payment and refunds.</li>
            <li>Improve the report format and the underlying CLI.</li>
            <li>
              Reply when you email us with a support question.
            </li>
          </ul>

          <h2>3. Who we share it with</h2>
          <p>
            We use a small number of vetted third-party providers to run
            the service. They process your data only on our behalf and
            under their own privacy commitments:
          </p>
          <ul>
            <li>
              <strong>Stripe</strong> &mdash; payment processing.
            </li>
            <li>
              <strong>Postmark</strong> &mdash; transactional email
              delivery (your report and receipts).
            </li>
            <li>
              <strong>OpenAI</strong> and <strong>Anthropic</strong>{" "}
              &mdash; we send your prompts (the buying questions you
              provide) to their APIs to generate the analysis. We do not
              send your email or payment information to either.
            </li>
            <li>
              <strong>Supabase</strong> &mdash; managed Postgres for
              storing your job record and report.
            </li>
            <li>
              <strong>Railway</strong> and <strong>Vercel</strong>{" "}
              &mdash; hosting infrastructure for the worker and website.
            </li>
          </ul>
          <p>
            We do not sell, rent, or trade your personal information to
            any third party for marketing purposes.
          </p>

          <h2>4. How long we keep it</h2>
          <p>
            We keep your job record and generated report indefinitely so
            you can request a re-send. Payment records are retained for
            seven years to satisfy tax and accounting requirements. You
            can request deletion at any time via our{" "}
            <ContactLink defaultSubject="Data deletion request">contact form</ContactLink>
            ; we will delete your job record, report, and email address
            within thirty days, except where retention is legally
            required.
          </p>

          <h2>5. Your rights</h2>
          <p>
            Depending on where you live (GDPR in the EU/UK, CCPA in
            California, and similar laws elsewhere), you may have the
            right to:
          </p>
          <ul>
            <li>Access the personal data we hold about you.</li>
            <li>Correct inaccurate data.</li>
            <li>Delete your data.</li>
            <li>Export your data in a portable format.</li>
            <li>Object to certain processing.</li>
          </ul>
          <p>
            To exercise any of these rights, use our{" "}
            <ContactLink defaultSubject="Privacy rights request">contact form</ContactLink>
            . We respond within thirty days.
          </p>

          <h2>6. Cookies and tracking</h2>
          <p>
            We do not use advertising cookies. Vercel Analytics, which
            powers our basic traffic numbers, is cookieless by design and
            does not identify individuals. Stripe sets cookies necessary
            for fraud prevention on the checkout page; see Stripe&rsquo;s
            privacy policy for details.
          </p>

          <h2>7. Security</h2>
          <p>
            All traffic to openllmrank.xyz is served over HTTPS. Payment
            information is handled by Stripe and never touches our
            servers. Database access is restricted to our worker
            processes via short-lived credentials.
          </p>

          <h2>8. Children</h2>
          <p>
            openllmrank is a B2B service intended for marketing and
            communications professionals. It is not directed at children
            under thirteen, and we do not knowingly collect data from
            children.
          </p>

          <h2>9. International transfers</h2>
          <p>
            Our service is operated from the United States. If you are
            in the EU, UK, or another region with data-localization
            laws, your data will be transferred to and processed in the
            United States by us and our processors listed above.
          </p>

          <h2>10. Changes to this policy</h2>
          <p>
            We will update the &ldquo;last updated&rdquo; date at the
            top of this page whenever this policy changes. For material
            changes (for example, a new category of data collection), we
            will email customers who have placed an order in the last
            twelve months.
          </p>

          <h2>11. Contact</h2>
          <p>
            Questions about this policy? Reach us via the{" "}
            <ContactLink defaultSubject="Privacy policy question">contact form</ContactLink>
            .
          </p>
        </article>

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
          border-bottom: none;
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

        .legal {
          max-width: 760px;
          padding-top: 48px;
          padding-bottom: 96px;
        }
        .legal h1 {
          font-size: 52px;
          line-height: 1.02;
          margin: 12px 0 8px;
        }
        .legal .updated {
          font-size: 14px;
          margin-bottom: 32px;
        }
        .legal h2 {
          font-size: 24px;
          margin-top: 40px;
          margin-bottom: 12px;
        }
        .legal p, .legal li {
          font-size: 17px;
          line-height: 1.6;
          color: var(--ink);
        }
        .legal ul {
          margin: 0 0 var(--space-md) 0;
          padding-left: 24px;
        }
        .legal li { margin-bottom: 8px; }

        .site-footer {
          padding-top: 24px;
          padding-bottom: 48px;
          border-top: 1px solid var(--line);
          color: var(--muted);
          font-size: 14px;
        }

        @media (max-width: 820px) {
          .legal h1 { font-size: 36px; }
          .legal h2 { font-size: 20px; }
          .site-nav-links { display: none; }
        }
      `}</style>
    </>
  );
}
