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
          <li>
            {/* Deliberately a static link, not a session check: keeping this
                page statically rendered matters for SEO. /login redirects to
                /dashboard when a session already exists, so one link is
                correct whether you are signed in or not. */}
            <Link href="/login" className="nav-signin">
              Sign in
            </Link>
          </li>
        </ul>
      </nav>

      <main>
        <section className="hero wrap">
          <div className="hero-text">
            <span className="kicker">AI-search visibility report</span>
            <h1 className="hero-headline">
              When buyers ask AI,<br />does your brand<br /><em>make the shortlist?</em>
            </h1>
            <p className="hero-sub">
              See where your brand gets cited, who shows up instead, and
              what to improve next. One clear report, backed by responses
              and sources from five AI providers.
            </p>
            <p className="hero-actions">
              <Link href="/wizard/brand" className="btn-primary">
                Start tracking &mdash; $49/month
              </Link>
              <a href="#sample" className="btn-text">
                See a sample report
              </a>
            </p>
            <p className="hero-plan-note">Track weekly for $49/month. Or get one report for $79.</p>
          </div>

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

          <aside className="hero-sample" aria-label="Sample report data">
            <div className="sample-masthead">
              <span className="kicker">Inside your report</span>
              <span className="sample-badge">Illustrative sample</span>
            </div>
            <p className="sample-question">
              &ldquo;What&rsquo;s the best CRM<br />for B2B SaaS?&rdquo;
            </p>
            <div className="sample-score">
              <div><strong>12<span>%</span></strong><span className="sample-caption">Your brand&rsquo;s citation rate</span></div>
              <p><b>55 percentage points</b><br />behind the leading competitor</p>
            </div>
            <div className="sample-rankings" aria-label="Illustrative citation rates">
              <div className="sample-ranking own"><span>Your brand</span><div className="sample-track"><span style={{ width: "12%" }} /></div><strong>12%</strong></div>
              <div className="sample-ranking"><span>Competitor A</span><div className="sample-track"><span style={{ width: "67%" }} /></div><strong>67%</strong></div>
              <div className="sample-ranking"><span>Competitor B</span><div className="sample-track"><span style={{ width: "41%" }} /></div><strong>41%</strong></div>
            </div>
            <div className="sample-takeaway">
              <span className="kicker">From insight to action</span>
              <p>Find the questions you&rsquo;re missing.<br />See the evidence. Know what to fix.</p>
              <Link href="/sample-report.html">Explore a sample report <span aria-hidden="true">↗</span></Link>
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
            <dt>What does it cost?</dt>
            <dd>
              Tracking is $49 a month: your first report today, a fresh run
              every week across all five engines including Claude, Gemini,
              and Grok, and a dashboard that shows whether your citation rate
              is moving. Weekly runs cover up to two brands; past that the
              schedule is monthly. Cancel any time from the billing portal. A
              single report is $79 if you only want a snapshot.
            </dd>

            <dt>What is in a report?</dt>
            <dd>
              Citation rates per prompt, a gap analysis versus your
              competitors, and concrete content recommendations to close the
              gaps we found, delivered by email within fifteen minutes. If we
              can&rsquo;t generate it, we refund the report automatically
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

            <dt>Why track instead of buying one report?</dt>
            <dd>
              A single run is a snapshot with sampling noise in it. The
              question that matters is whether the pages you ship move the
              number, and that takes a second run to answer. Tracking re-runs
              the same questions every week and charts the answer; a one-off
              report is there for a quick look, or use the open-source CLI to
              run it on your own schedule.
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
              Start tracking &mdash; $49/month
            </Link>
          </p>
        </section>

        <footer className="wrap site-footer">
          <span className="muted">
            openllmrank &middot; Privacy-friendly, open-source analytics for AI search visibility &middot;{" "}
            <Link href="/login">Sign in</Link> &middot;{" "}
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
          display: inline-flex;
          align-items: center;
          min-height: 44px;
          font-size: 14px;
          color: var(--ink);
        }
        .site-nav-links a:hover {
          color: var(--accent);
          border-bottom-color: var(--accent);
        }
        .site-nav-links a.nav-signin {
          color: var(--accent);
          font-weight: 600;
        }

        .hero {
          display: grid;
          grid-template-columns: 1.16fr 1fr;
          column-gap: 64px;
          row-gap: 48px;
          padding-top: 64px;
          padding-bottom: 48px;
          align-items: center;
        }
        .hero-text { grid-column: 1; grid-row: 1; }
        .hero-headline { font-size: clamp(44px, 4.8vw, 64px); line-height: 1.02; letter-spacing: -.025em; margin: 20px 0 24px; }
        .hero-headline em { color: var(--accent); font-weight: 500; }
        .hero-sub { font-size: 18px; color: var(--muted); max-width: 480px; margin-bottom: 28px; line-height: 1.6; }
        .hero-actions { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
        .hero-plan-note { color: var(--muted); font-size: 14px; margin: 16px 0 0; }
        .report-providers { grid-column: 1 / -1; grid-row: 2; display: flex; align-items: center; gap: 40px; padding: 28px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
        .report-providers > .kicker { max-width: 130px; flex-shrink: 0; line-height: 1.6; }
        .report-providers ul { flex: 1; list-style: none; margin: 0; padding: 0; display: flex; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
        .report-providers li { display: flex; align-items: center; gap: 8px; min-height: 36px; }
        .provider-logo { display: block; width: 20px; height: 20px; flex: 0 0 20px; }
        .report-providers strong { font-family: var(--font-display); font-size: 18px; font-weight: 500; }
        .hero-sample { grid-column: 2; grid-row: 1; background: var(--paper); border: 1px solid var(--line); border-top: 3px solid var(--accent); border-radius: 3px; padding: 28px; box-shadow: 8px 8px 0 var(--soft); }
        .sample-masthead { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .sample-badge { color: var(--muted); font-size: 12px; }
        .sample-question { font-family: var(--font-display); font-size: 28px; line-height: 1.2; margin: 24px 0; color: var(--ink); }
        .sample-score { display: flex; align-items: flex-end; gap: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--line); }
        .sample-score strong { display: block; font-family: var(--font-display); font-size: 68px; line-height: 1; font-weight: 500; letter-spacing: -.04em; color: var(--accent); }
        .sample-score strong span { font-size: 36px; margin-left: 4px; }
        .sample-caption { display: block; color: var(--muted); font-size: 13px; margin-top: 8px; }
        .sample-score p { font-size: 13px; color: var(--muted); margin: 0 0 2px; line-height: 1.5; }
        .sample-score b { font-weight: 500; color: var(--loss); }
        .sample-rankings { display: grid; gap: 16px; padding: 24px 0; }
        .sample-ranking { display: grid; grid-template-columns: 108px 1fr 34px; gap: 12px; align-items: center; font-size: 14px; color: var(--muted); }
        .sample-ranking strong { color: var(--ink); font-variant-numeric: tabular-nums; text-align: right; font-weight: 500; }
        .sample-ranking.own > span { color: var(--accent); font-weight: 500; }
        .sample-track { height: 7px; border-radius: 2px; background: var(--soft); overflow: hidden; }
        .sample-track span { display: block; height: 100%; background: var(--accent-2); border-radius: 2px; }
        .sample-ranking.own .sample-track span { background: var(--accent); }
        .sample-takeaway { border-top: 1px solid var(--line); padding-top: 20px; }
        .sample-takeaway p { font-size: 16px; line-height: 1.5; margin: 8px 0; }
        .sample-takeaway a { display: inline-flex; align-items: center; gap: 12px; min-height: 44px; font-size: 14px; font-weight: 500; }

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
          .hero-headline { font-size: clamp(36px, 8vw, 52px); }
          .hero-text, .hero-sample, .report-providers { grid-column: 1; grid-row: auto; }
          .hero-sample { order: 2; padding: 24px; margin-right: 8px; }
          .hero-text { order: 1; }
          .report-providers { order: 3; display: block; padding: 24px 0; }
          .report-providers > .kicker { max-width: none; }
          .report-providers ul { display: grid; margin-top: 16px; gap: 12px 20px; }
          .sample-score { gap: 16px; }
          .sample-question { font-size: 26px; }
          .sample-ranking { grid-template-columns: 100px 1fr 34px; gap: 8px; }
          .hero-actions { flex-direction: column; align-items: flex-start; }
          .report-providers ul { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .btn-primary { width: 100%; text-align: center; }
          .site-nav { display: block; padding: 20px 16px 0; }
          .site-nav-links { flex-wrap: wrap; gap: 0 20px; margin-top: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
          .site-nav-links a { font-size: 14px; }
          .site-nav-links li:last-child { margin-left: auto; }
          .section-headline { font-size: 32px; }
          .steps { grid-template-columns: 1fr; gap: 32px; }
          .home-posts { grid-template-columns: 1fr; gap: 0; }
        }
      `}</style>
    </>
  );
}
