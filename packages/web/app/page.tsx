import Link from "next/link";
import { ContactLink } from "./_components/contact-link";
import { getAllPosts } from "../lib/blog";

// Marketing landing page. Editorial long-scroll, mirrors the approved
// hero mockup at:
// ~/.gstack/projects/foodaka-openllmrank/designs/marketing-hero-20260517/variant-A.png
// Same visual system as packages/cli/src/core/render-html.ts.

const SITE_URL = "https://openllmrank.io";

// How many posts get a direct homepage link. Every post listed here is one hop
// from the only page Google has actually crawled — see the "Field notes"
// section below for why that matters.
const HOMEPAGE_POST_COUNT = 6;

export default function HomePage() {
  const latestPosts = getAllPosts().slice(0, HOMEPAGE_POST_COUNT);

  // Entity schema for the site itself. The blog posts each ship Article +
  // FAQPage JSON-LD; the homepage had none, so nothing tied the pages to a
  // publisher.
  const siteJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: "openllmrank",
        url: SITE_URL,
        description:
          "AI-search visibility analytics across five grounded AI providers.",
        sameAs: ["https://github.com/foodaka/openllmrank"],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: "openllmrank",
        url: SITE_URL,
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
      />
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
            <Link href="/check">Free crawl check</Link>
          </li>
          <li>
            <Link href="/blog">Blog</Link>
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
              five grounded AI APIs, watch what they recommend,
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
            <div className="report-providers" aria-label="Providers included in every report">
              <span className="kicker">Included in every report</span>
              <ul>
                <li>
                  <img className="provider-logo" src="/providers/openai.svg" alt="" width="24" height="24" />
                  <strong>OpenAI</strong>
                </li>
                <li>
                  <img className="provider-logo" src="/providers/anthropic.svg" alt="" width="24" height="24" />
                  <strong>Anthropic</strong>
                </li>
                <li>
                  <img className="provider-logo" src="/providers/google-gemini.svg" alt="" width="24" height="24" />
                  <strong>Google Gemini</strong>
                </li>
                <li>
                  <img className="provider-logo" src="/providers/perplexity.svg" alt="" width="24" height="24" />
                  <strong>Perplexity</strong>
                </li>
                <li>
                  <img className="provider-logo" src="/providers/xai.svg" alt="" width="24" height="24" />
                  <strong>xAI Grok</strong>
                </li>
              </ul>
            </div>
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
                OpenAI, Anthropic, Google Gemini, Perplexity, and xAI Grok
                models with web search, capture every
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

        {/* Free tool: top-of-funnel entry for the paid report. The crawl
            check was born from this site's own "Discovered — currently not
            indexed" incident (see the blog post of the same name). */}
        <section id="crawl-check" className="wrap">
          <hr className="rule" />
          <span className="kicker">Free tool &middot; no signup</span>
          <h2 className="section-headline">Is your site invisible?</h2>
          <p className="section-sub">
            Our own blog sat unindexed for months because broken internal
            links severed the crawl paths &mdash; and nothing warned us. The
            free crawl check walks your site the way Googlebot does and shows
            you every orphan page, broken internal link, and blocked AI
            crawler in about a minute. Fixes ship as a copy-paste prompt for
            your coding agent.
          </p>
          <p className="hero-actions">
            <Link href="/check" className="btn-primary">
              Check my site &mdash; free
            </Link>
            <Link href="/blog/discovered-currently-not-indexed" className="btn-text">
              Read the story behind it
            </Link>
          </p>
        </section>

        {/* Direct links to every post. The nav and footer only ever pointed at
            /blog, which left each post two hops from the homepage behind a hub
            page Google had not crawled — the whole blog showed up in Search
            Console as "Discovered, currently not indexed". These links put each
            post one hop from the only URL with any crawl history. */}
        <section id="field-notes" className="wrap">
          <hr className="rule" />
          <span className="kicker">From the blog</span>
          <h2 className="section-headline">Field notes on AI search.</h2>
          <p className="section-sub">
            Working notes on answer engine optimization &mdash; how ChatGPT,
            Perplexity, and Gemini decide which brands to recommend, and what
            the data actually shows.
          </p>

          <ul className="home-posts">
            {latestPosts.map((post) => (
              <li key={post.slug}>
                <Link href={`/blog/${post.slug}`}>{post.title}</Link>
                <p>{post.description}</p>
                <span className="home-post-meta">{post.readingTime}</span>
              </li>
            ))}
          </ul>

          <p>
            <Link href="/blog" className="btn-text">
              Read all field notes &rarr;
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
            <Link href="/check">Free crawl check</Link> &middot;{" "}
            <Link href="/blog">Blog</Link> &middot;{" "}
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
        .report-providers {
          margin-top: 32px;
          padding-top: 20px;
          border-top: 1px solid var(--line);
          max-width: 620px;
        }
        .report-providers ul {
          list-style: none;
          margin: 12px 0 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px 24px;
        }
        .report-providers li {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          min-height: 36px;
        }
        .provider-logo {
          display: block;
          width: 22px;
          height: 22px;
          flex: 0 0 22px;
        }
        .report-providers strong {
          font-family: var(--font-display);
          font-size: 20px;
          font-weight: 500;
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

        /* Homepage post list — mirrors .post-list-item in the blog layout so
           the two surfaces read as the same publication. */
        .home-posts {
          list-style: none;
          margin: 8px 0 32px;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0 48px;
        }
        .home-posts li {
          padding: 28px 0;
          border-top: 1px solid var(--line);
        }
        .home-posts a {
          font-family: var(--font-display);
          font-size: 22px;
          line-height: 1.15;
          color: var(--ink);
          border-bottom: none;
        }
        .home-posts a:hover { color: var(--accent); }
        .home-posts p {
          color: var(--muted);
          font-size: 16px;
          line-height: 1.6;
          margin: 10px 0 8px;
        }
        .home-post-meta {
          font-size: 13px;
          color: var(--muted);
          font-variant-numeric: tabular-nums;
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
          .report-providers ul { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .btn-primary { width: 100%; text-align: center; }
          .site-nav-links { display: none; }
          .section-headline { font-size: 32px; }
          .steps { grid-template-columns: 1fr; gap: 32px; }
          .home-posts { grid-template-columns: 1fr; gap: 0; }
        }
      `}</style>
    </>
  );
}
