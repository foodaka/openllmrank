import type { Metadata } from "next";
import Link from "next/link";
import { getPostBySlug, getRelatedPosts } from "../../../lib/blog";

const SITE_URL = "https://openllmrank.io";
const SLUG = "state-of-ai-search-2026";
const post = getPostBySlug(SLUG)!;

export const metadata: Metadata = {
  title: post.title,
  description: post.description,
  keywords: post.keywords,
  alternates: { canonical: `/blog/${SLUG}` },
  openGraph: {
    type: "article",
    url: `${SITE_URL}/blog/${SLUG}`,
    siteName: "openllmrank",
    title: post.title,
    description: post.description,
    publishedTime: post.date,
    modifiedTime: post.dateModified ?? post.date,
  },
  twitter: {
    card: "summary_large_image",
    title: post.title,
    description: post.description,
  },
};

// The dataset, transcribed from the study run (150 grounded answers, July 2026).
// "always" = named in all 15 runs (5 engines x 3 samples). "sometimes" =
// named in some runs, with the % of the 15 runs it appeared in. "never" =
// zero mentions across all 15 runs.
type Cat = {
  label: string;
  question: string;
  always: string[];
  sometimes: { name: string; pct: number }[];
  never: string[];
};

const CATS: Cat[] = [
  {
    label: "CRM",
    question: "Best CRM for a B2B SaaS company",
    always: ["Salesforce", "HubSpot", "Pipedrive"],
    sometimes: [
      { name: "Attio", pct: 73 },
      { name: "Zoho CRM", pct: 60 },
    ],
    never: ["Freshsales", "Insightly", "Nutshell"],
  },
  {
    label: "Project management",
    question: "Best PM tool for a software engineering team",
    always: ["Jira"],
    sometimes: [
      { name: "Linear", pct: 87 },
      { name: "ClickUp", pct: 67 },
      { name: "Asana", pct: 53 },
      { name: "Monday.com", pct: 47 },
      { name: "Trello", pct: 13 },
      { name: "Wrike", pct: 7 },
    ],
    never: ["Notion", "Basecamp", "Smartsheet"],
  },
  {
    label: "Email marketing",
    question: "Best email platform for a small business",
    always: ["Brevo"],
    sometimes: [
      { name: "Klaviyo", pct: 87 },
      { name: "Mailchimp", pct: 80 },
      { name: "ActiveCampaign", pct: 60 },
      { name: "HubSpot", pct: 40 },
      { name: "ConvertKit", pct: 33 },
      { name: "Constant Contact", pct: 33 },
      { name: "Beehiiv", pct: 7 },
    ],
    never: [],
  },
  {
    label: "Help desk",
    question: "Best customer support help desk",
    always: ["Zendesk", "Freshdesk"],
    sometimes: [
      { name: "Help Scout", pct: 73 },
      { name: "Zoho Desk", pct: 67 },
      { name: "Intercom", pct: 47 },
      { name: "HappyFox", pct: 33 },
      { name: "Gorgias", pct: 27 },
    ],
    never: ["Kustomer"],
  },
  {
    label: "Web analytics",
    question: "Best privacy-friendly analytics tool",
    always: ["Plausible", "Matomo", "Umami"],
    sometimes: [
      { name: "Fathom", pct: 80 },
      { name: "Google Analytics", pct: 67 },
      { name: "Simple Analytics", pct: 27 },
      { name: "PostHog", pct: 20 },
    ],
    never: ["Cloudflare Web Analytics"],
  },
  {
    label: "Password manager",
    question: "Best password manager for a small team",
    always: ["1Password", "Bitwarden", "Keeper"],
    sometimes: [
      { name: "NordPass", pct: 73 },
      { name: "LastPass", pct: 33 },
      { name: "Dashlane", pct: 27 },
      { name: "Proton Pass", pct: 13 },
    ],
    never: [],
  },
  {
    label: "Accounting",
    question: "Best accounting software for a small business",
    always: ["QuickBooks", "Xero", "FreshBooks", "Zoho Books"],
    sometimes: [
      { name: "Sage", pct: 20 },
      { name: "Wave Accounting", pct: 20 },
    ],
    never: ["NetSuite"],
  },
  {
    label: "E-signature",
    question: "Best e-signature software",
    always: ["DocuSign"],
    sometimes: [
      { name: "PandaDoc", pct: 93 },
      { name: "Adobe Acrobat Sign", pct: 93 },
      { name: "SignNow", pct: 80 },
      { name: "Dropbox Sign", pct: 67 },
    ],
    never: ["Signeasy"],
  },
  {
    label: "Website builder",
    question: "Best website builder for a small business",
    always: ["Squarespace", "Wix", "Shopify"],
    sometimes: [
      { name: "WordPress", pct: 60 },
      { name: "Webflow", pct: 47 },
      { name: "GoDaddy", pct: 7 },
      { name: "Framer", pct: 7 },
    ],
    never: ["Carrd"],
  },
  {
    label: "Video conferencing",
    question: "Best video conferencing for remote teams",
    always: ["Zoom", "Google Meet", "Microsoft Teams"],
    sometimes: [
      { name: "Webex", pct: 87 },
      { name: "Whereby", pct: 20 },
      { name: "Zoho Meeting", pct: 20 },
      { name: "GoTo Meeting", pct: 7 },
    ],
    never: [],
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Which AI engines were tested?",
    a: "Five grounded (web-search-enabled) models, in July 2026: OpenAI gpt-5.4-mini, Anthropic claude-haiku-4-5, Google gemini-3.5-flash, Perplexity sonar, and xAI grok-4.3. Each of 10 buying questions was run three times per engine — 150 answers total. We used the providers' grounded APIs, not the consumer apps, so treat results as a reproducible directional benchmark rather than a promise of what any single user sees.",
  },
  {
    q: "Do different AI engines recommend different brands?",
    a: "Less than you'd expect. In every one of the 10 categories, at least one brand was named in all 15 runs across all five engines. The engines converge on the same short list of leaders and largely draw recommendations from it. The variation shows up in the middle tier — challenger brands that some engines name and others skip.",
  },
  {
    q: "How consistent are AI recommendations run to run?",
    a: "The leaders are rock-solid; the challengers flicker. Overall, 25% of brand appearances were inconsistent across the three identical runs — a brand named in one run but not the next. But that inconsistency is concentrated in mid-tier brands. The top brands in each category appeared in all three runs, every time. A single query is still a sample size of one, which is why measuring visibility requires repeated runs.",
  },
  {
    q: "Can a well-known brand be invisible in AI search?",
    a: "Yes, and that's the most important finding. Eleven established brands were never named once across 150 answers — including Notion (for engineering project management), NetSuite, and Carrd. Others were named far less than their reputation implies: Mailchimp missed one run in five, LastPass appeared in only a third of runs. Brand awareness in the market does not equal visibility in AI answers.",
  },
  {
    q: "How much did this study cost to run?",
    a: "About six dollars in API calls. The entire benchmark — 150 grounded queries across five providers — was produced with the open-source openllmrank CLI for $6.01. That's the same workflow the hosted tracker runs every week for a single brand and its competitors.",
  },
];

export default function StateOfAiSearchPost() {
  const related = getRelatedPosts(SLUG);

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.dateModified ?? post.date,
    author: { "@type": "Organization", name: "openllmrank", url: SITE_URL },
    publisher: { "@type": "Organization", name: "openllmrank", url: SITE_URL },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${SITE_URL}/blog/${SLUG}`,
    },
    keywords: post.keywords.join(", "),
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <article className="post">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span className="sep" aria-hidden>
          /
        </span>
        <Link href="/blog">Blog</Link>
        <span className="sep" aria-hidden>
          /
        </span>
        <span>State of AI Search 2026</span>
      </nav>

      <h1>State of AI Search 2026: We Asked 5 AI Engines to Recommend Software</h1>
      <p className="post-meta">Published July 2026 &middot; {post.readingTime}</p>

      <p className="lede">
        We took 10 ordinary buying questions &mdash; &ldquo;what&rsquo;s the best
        CRM?&rdquo;, &ldquo;what&rsquo;s the best password manager?&rdquo; &mdash;
        and ran each one three times through five grounded AI engines: ChatGPT,
        Claude, Gemini, Perplexity, and Grok. That&rsquo;s 150 real answers. Then
        we counted every brand each engine named. The result is a clear, and
        slightly unnerving, picture of who AI recommends &mdash; and who it has
        quietly erased.
      </p>

      <h2>Three Findings, Up Front</h2>
      <p>
        If you read nothing else, read these:
      </p>
      <ul>
        <li>
          <strong>Every category has a locked shortlist.</strong> In all 10
          categories, at least one brand was named in all 15 runs (five engines,
          three times each). The engines converge hard on the same handful of
          leaders. On average, the top three brands captured{" "}
          <strong>66% of all mentions</strong> in a category.
        </li>
        <li>
          <strong>The leaders are stable; the challengers flicker.</strong>{" "}
          Overall, 25% of brand appearances were inconsistent across three
          identical runs &mdash; but that noise is concentrated in the middle
          tier. The top brands showed up every single time. Ask once and you
          might miss a challenger; ask three times and the leaders never move.
        </li>
        <li>
          <strong>Well-known brands can be completely invisible.</strong> Eleven
          established products were <strong>never named once</strong> across 150
          answers. Notion did not appear for engineering project management.
          NetSuite did not appear for accounting. Carrd did not appear for
          website builders. Reputation in the market is not the same as
          visibility in AI.
        </li>
      </ul>

      <h2>Who AI Recommends, by Category</h2>
      <p>
        Here is the full board. &ldquo;Always named&rdquo; means the brand
        appeared in all 15 runs. &ldquo;Sometimes named&rdquo; shows the share of
        the 15 runs a brand appeared in. &ldquo;Never named&rdquo; means zero
        mentions across every engine and every run.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Always named (15/15)</th>
              <th>Sometimes named</th>
              <th>Never named</th>
            </tr>
          </thead>
          <tbody>
            {CATS.map((c) => (
              <tr key={c.label}>
                <td>
                  <strong>{c.label}</strong>
                  <br />
                  <span style={{ color: "var(--muted)", fontSize: "13px" }}>
                    {c.question}
                  </span>
                </td>
                <td>{c.always.length ? c.always.join(", ") : "—"}</td>
                <td>
                  {c.sometimes.length
                    ? c.sometimes.map((s) => `${s.name} (${s.pct}%)`).join(", ")
                    : "—"}
                </td>
                <td>{c.never.length ? c.never.join(", ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>The Consensus Is Real &mdash; and It&rsquo;s a Moat</h2>
      <p>
        The striking thing isn&rsquo;t that AI has opinions. It&rsquo;s how much
        the five engines agree. Ask any of them for the best CRM and you get
        Salesforce, HubSpot, and Pipedrive &mdash; every time, from every model.
        Best help desk? Zendesk and Freshdesk, universally. Best video
        conferencing? Zoom, Google Meet, Microsoft Teams, no exceptions.
      </p>
      <p>
        This convergence is a moat for whoever is inside it. When five different
        AI systems, trained by five different companies, all reach for the same
        two or three names, that shortlist becomes self-reinforcing: they cite
        the sources that mention those brands, which makes those brands the
        default answer, which generates more content mentioning them. If
        you&rsquo;re on the list, you compound. If you&rsquo;re not, you have to
        break in from outside.
      </p>

      <h2>Being Famous Isn&rsquo;t Being Visible</h2>
      <p>
        The most useful column in that table is the last one. These are not
        obscure products &mdash; they are brands with real customers and real
        market share that AI simply did not surface:
      </p>
      <ul>
        <li>
          <strong>Notion</strong> &mdash; zero mentions for &ldquo;best project
          management tool for a software engineering team.&rdquo; The engines
          read &ldquo;engineering&rdquo; and reached for Jira and Linear;
          Notion&rsquo;s enormous general-purpose brand didn&rsquo;t register for
          the specific query.
        </li>
        <li>
          <strong>NetSuite, Kustomer, Signeasy, Carrd, Cloudflare Web
          Analytics, Freshsales, Insightly, Nutshell, Basecamp, Smartsheet</strong>{" "}
          &mdash; all named zero times in their categories.
        </li>
      </ul>
      <p>
        And plenty of household names were only <em>partly</em> visible.{" "}
        <strong>Mailchimp</strong>, arguably the most recognized email brand on
        earth, was named in only 80% of runs &mdash; it missed one in five.{" "}
        <strong>LastPass</strong> appeared in just a third. <strong>GoDaddy</strong>,
        despite blanketing the world in advertising, showed up in 7% of website-builder
        answers. The lesson is blunt: the marketing budget that wins mindshare with
        humans does not automatically win a citation from a model.
      </p>

      <div className="post-cta">
        <span className="kicker">Your brand, your category</span>
        <h3>Is your brand on the shortlist or in the void?</h3>
        <p>
          This study used generic categories. openllmrank runs the exact same
          engine on <em>your</em> brand and <em>your</em> competitors &mdash; five
          grounded providers, your real buying questions, your citation rate with
          the evidence and a plan to close the gaps.
        </p>
        <Link href="/wizard/brand" className="btn-primary">
          Start tracking &mdash; $49/month
        </Link>
      </div>

      <h2>Why You Can&rsquo;t Trust a Single Check</h2>
      <p>
        A quarter of all brand appearances were inconsistent between identical
        runs. Same question, same model, same day &mdash; different answer. If
        you had checked ChatGPT once and seen your brand, you might have relaxed;
        if you&rsquo;d checked once and missed it, you might have panicked. Both
        would be wrong, because one query is a coin flip on the challengers.
      </p>
      <p>
        The signal only appears with repetition. Run each question several times
        across several engines and a stable picture emerges: the locked leaders,
        the flickering middle, the invisible tail. That&rsquo;s the difference
        between an anecdote and a measurement, and it&rsquo;s the whole reason a
        real visibility check runs prompts in triplicate rather than once.
      </p>

      <h2>What This Means for Your AEO Strategy</h2>
      <p>
        Four takeaways if you want to move from the invisible tail toward the
        locked shortlist:
      </p>
      <ul>
        <li>
          <strong>Know which bucket you&rsquo;re in.</strong> Always-named,
          sometimes-named, or never-named is the only diagnosis that matters, and
          you can only know it by measuring across engines and repeated runs.
        </li>
        <li>
          <strong>Specificity beats fame.</strong> Notion lost the engineering
          query it could plausibly win because the model associates the category
          with Jira and Linear. Win the <em>specific</em> phrasing your buyers
          use, not just general awareness.
        </li>
        <li>
          <strong>Get into the sources the engines read.</strong> Every category
          leader shares a trait: it&rsquo;s everywhere in the review sites and
          listicles models cite. We break down exactly which domains in{" "}
          <Link href="/blog/which-sources-do-ai-engines-cite">
            which sources AI engines cite
          </Link>
          .
        </li>
        <li>
          <strong>Re-measure after you ship.</strong> Because answers move,
          you&rsquo;ll only know your content worked by re-running the same
          prompts and watching the rate climb. See{" "}
          <Link href="/blog/how-to-get-mentioned-in-chatgpt">
            how to get mentioned in ChatGPT
          </Link>{" "}
          for the tactics.
        </li>
      </ul>

      <h2>Methodology</h2>
      <p>
        We want this to be reproducible, so here&rsquo;s exactly what we did and
        where it&rsquo;s limited.
      </p>
      <ul>
        <li>
          <strong>Scope:</strong> 10 software categories, one buying question
          each, run in July 2026.
        </li>
        <li>
          <strong>Engines:</strong> five grounded (web-search-enabled) models
          &mdash; OpenAI gpt-5.4-mini, Anthropic claude-haiku-4-5, Google
          gemini-3.5-flash, Perplexity sonar, xAI grok-4.3.
        </li>
        <li>
          <strong>Runs:</strong> three samples per question per engine = 150
          answers. 149 of 150 returned grounded web sources.
        </li>
        <li>
          <strong>Counting:</strong> a brand counts as &ldquo;named&rdquo; when
          its name or a known alias appears in the answer text. We deliberately
          excluded candidate brands whose names are common English words (to
          avoid false matches) and used full product names where needed.
        </li>
        <li>
          <strong>Limits:</strong> we queried grounded provider APIs, not the
          consumer apps, which can use different model versions and
          personalization. Ten categories and three runs is a directional
          sample, not a census. Substring matching can miss an oblique reference
          or, rarely, over-count. Treat the numbers as a reproducible benchmark,
          not gospel.
        </li>
        <li>
          <strong>Tooling and cost:</strong> the whole study ran on the
          open-source{" "}
          <a href="https://github.com/foodaka/openllmrank">openllmrank CLI</a> and
          cost $6.01 in API calls.
        </li>
      </ul>

      <h2>Frequently Asked Questions</h2>
      {FAQ.map((f) => (
        <div key={f.q}>
          <h3>{f.q}</h3>
          <p>{f.a}</p>
        </div>
      ))}

      <div className="post-end">
        <div className="post-cta">
          <span className="kicker">Measure it</span>
          <h3>Find out what AI says about your brand</h3>
          <p>
            One emailed report, five grounded providers, your citation rate
            versus competitors, and what to do about it. $49 a month, first
            report in about fifteen minutes.
          </p>
          <Link href="/wizard/brand" className="btn-primary">
            Start tracking &mdash; $49/month
          </Link>
        </div>

        {related.length > 0 && (
          <div className="related">
            <h2>Keep reading</h2>
            <div className="related-list">
              {related.map((r) => (
                <Link key={r.slug} href={`/blog/${r.slug}`}>
                  {r.title}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
