import Link from "next/link";

export const metadata = {
  title: "Terms of Service — openllmrank",
  description:
    "Terms governing your use of the openllmrank service.",
};

export default function TermsPage() {
  return (
    <>
      <nav className="site-nav">
        <Link href="/" className="wordmark">openllmrank</Link>
        <ul className="site-nav-links">
          <li><Link href="/">Home</Link></li>
          <li><Link href="/privacy">Privacy</Link></li>
        </ul>
      </nav>

      <main>
        <article className="wrap legal">
          <span className="kicker">Terms of Service</span>
          <h1>Terms of Service</h1>
          <p className="muted updated">Last updated: May 19, 2026</p>

          <p>
            These Terms of Service (&ldquo;Terms&rdquo;) govern your use
            of openllmrank.xyz (the &ldquo;Service&rdquo;), operated by
            openllmrank (&ldquo;we,&rdquo; &ldquo;us&rdquo;). By
            purchasing a report or otherwise using the Service, you
            agree to these Terms. If you do not agree, do not use the
            Service.
          </p>

          <h2>1. The Service</h2>
          <p>
            openllmrank generates an AI-search visibility report that
            measures how often the brand you specify is cited by
            ChatGPT and Claude in response to buying questions you
            provide. The report is delivered by email, typically within
            fifteen minutes of payment.
          </p>

          <h2>2. Price and payment</h2>
          <p>
            The Service costs <strong>USD 29.99</strong> per report, as
            a one-time charge. Payment is processed by Stripe at the
            time of order. Prices are exclusive of any applicable
            taxes, which we will add at checkout where required.
          </p>

          <h2>3. Refund policy</h2>
          <p>
            We offer the following refunds:
          </p>
          <ul>
            <li>
              <strong>Automatic refund</strong> &mdash; If we are unable
              to generate your report for any technical reason (API
              outage, internal error, etc.), we will issue a full refund
              automatically within one hour and notify you by email.
            </li>
            <li>
              <strong>Quality refund</strong> &mdash; If you receive
              your report but believe it is materially incomplete or
              inaccurate, email{" "}
              <a href="mailto:hello@openllmrank.xyz">
                hello@openllmrank.xyz
              </a>{" "}
              within seven days with the specifics. We will review and,
              at our discretion, issue a partial or full refund.
            </li>
            <li>
              <strong>No general refund after delivery</strong> &mdash;
              Because the report is a digital good delivered
              immediately, we do not offer change-of-mind refunds once
              the report has been generated and emailed.
            </li>
          </ul>

          <h2>4. AI-generated content disclaimer</h2>
          <p>
            <strong>
              The Service generates analysis using third-party large
              language models (ChatGPT, Claude) and their web search
              tools. Outputs are probabilistic and may contain factual
              errors, hallucinated citations, or out-of-date
              information.
            </strong>{" "}
            We make best efforts to surface only reliable signal &mdash;
            multiple runs per prompt, multiple models, post-processing
            to catch obvious errors &mdash; but we do not guarantee
            accuracy or completeness. You should treat the report as a
            directional signal, not as a factual ranking. Do not rely on
            the report alone for legal, financial, or other
            consequential decisions.
          </p>

          <h2>5. Acceptable use</h2>
          <p>You agree not to use the Service to:</p>
          <ul>
            <li>
              Submit prompts that are illegal, harassing, defamatory,
              or that attempt to extract personal information about
              third parties.
            </li>
            <li>
              Attempt to reverse-engineer, scrape, or systematically
              extract content from the Service.
            </li>
            <li>
              Resell or redistribute reports as if they were your own
              original analysis without attribution.
            </li>
            <li>
              Interfere with the operation of the Service, attempt to
              bypass payment, or probe for vulnerabilities outside of a
              good-faith security disclosure.
            </li>
          </ul>
          <p>
            We may suspend or refuse service to anyone who violates
            this section.
          </p>

          <h2>6. Open-source CLI</h2>
          <p>
            The underlying analysis is also available as an open-source
            CLI on{" "}
            <a href="https://github.com/foodaka/openllmrank">
              GitHub
            </a>{" "}
            under the MIT license. The CLI is governed by its own
            license; these Terms apply only to the hosted Service at
            openllmrank.xyz.
          </p>

          <h2>7. Intellectual property</h2>
          <p>
            The report we deliver is yours to use however you like for
            internal analysis, marketing decisions, presentations to
            colleagues or clients, and so on. The Service itself, the
            report template, and the openllmrank brand remain our
            property. You may not republish the report verbatim as a
            standalone publication without permission.
          </p>

          <h2>8. No warranties</h2>
          <p>
            THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS
            AVAILABLE,&rdquo; WITHOUT WARRANTIES OF ANY KIND, EITHER
            EXPRESS OR IMPLIED, INCLUDING ANY IMPLIED WARRANTIES OF
            MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
            ACCURACY, OR NON-INFRINGEMENT.
          </p>

          <h2>9. Limitation of liability</h2>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, OUR
            TOTAL LIABILITY ARISING OUT OF OR RELATING TO THE SERVICE
            IS LIMITED TO THE AMOUNT YOU PAID US IN THE TWELVE MONTHS
            PRECEDING THE EVENT GIVING RISE TO THE LIABILITY, OR USD
            29.99, WHICHEVER IS GREATER. WE ARE NOT LIABLE FOR
            INDIRECT, INCIDENTAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES.
          </p>

          <h2>10. Indemnity</h2>
          <p>
            You agree to indemnify and hold us harmless from any claim
            arising out of your misuse of the Service, your violation
            of these Terms, or your violation of any law or third-party
            right.
          </p>

          <h2>11. Termination</h2>
          <p>
            We may terminate or suspend your access to the Service at
            any time, with or without notice, for conduct that we
            believe violates these Terms or is otherwise harmful to
            the Service or other users. Sections 4, 7, 8, 9, 10, and
            12 survive termination.
          </p>

          <h2>12. Governing law</h2>
          <p>
            These Terms are governed by the laws of the State of
            California, United States, without regard to its conflict
            of laws principles. Any dispute will be resolved in the
            state or federal courts located in San Francisco County,
            California, and you consent to personal jurisdiction
            there.
          </p>

          <h2>13. Changes to these Terms</h2>
          <p>
            We may update these Terms from time to time. The current
            version is always at openllmrank.xyz/terms with the date at
            the top. Material changes will be emailed to customers who
            have placed an order in the last twelve months.
          </p>

          <h2>14. Contact</h2>
          <p>
            Questions? Email{" "}
            <a href="mailto:hello@openllmrank.xyz">
              hello@openllmrank.xyz
            </a>
            .
          </p>
        </article>

        <footer className="wrap site-footer">
          <span className="muted">
            openllmrank &middot; Privacy-friendly, open-source analytics for AI search visibility &middot;{" "}
            <Link href="/privacy">Privacy</Link> &middot;{" "}
            <Link href="/terms">Terms</Link> &middot;{" "}
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
