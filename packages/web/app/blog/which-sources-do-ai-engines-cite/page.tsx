import type { Metadata } from "next";
import Link from "next/link";
import { getPostBySlug, getRelatedPosts } from "../../../lib/blog";

const SITE_URL = "https://openllmrank.io";
const SLUG = "which-sources-do-ai-engines-cite";
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

// Most-cited publisher domains across 150 grounded answers (July 2026).
// Counts are the number of answers whose grounded sources included the domain
// (deduped per answer). g2.com and learn.g2.com are combined as "G2". Gemini's
// vertexaisearch.cloud.google.com redirect wrapper is excluded (it's an API
// artifact, not a publisher).
type Dom = { domain: string; count: number; type: string };
const DOMAINS: Dom[] = [
  { domain: "g2.com (incl. learn.g2.com)", count: 30, type: "Review marketplace" },
  { domain: "youtube.com", count: 16, type: "Video / community" },
  { domain: "pcmag.com", count: 14, type: "Tech media" },
  { domain: "thedigitalprojectmanager.com", count: 13, type: "Niche review blog" },
  { domain: "salesforce.com", count: 12, type: "Vendor" },
  { domain: "techradar.com", count: 11, type: "Tech media" },
  { domain: "paymoapp.com", count: 9, type: "Vendor blog / listicle" },
  { domain: "zapier.com", count: 9, type: "Media / blog" },
  { domain: "brevo.com", count: 9, type: "Vendor" },
  { domain: "launchthedamnthing.com", count: 9, type: "Niche blog" },
  { domain: "aimers.io", count: 8, type: "Niche blog" },
  { domain: "monday.com", count: 8, type: "Vendor" },
  { domain: "plausible.io", count: 8, type: "Vendor" },
  { domain: "wpmailsmtp.com", count: 8, type: "Niche blog" },
  { domain: "techrepublic.com", count: 7, type: "Tech media" },
  { domain: "reddit.com", count: 7, type: "Community" },
  { domain: "peoplemanagingpeople.com", count: 7, type: "Niche review blog" },
  { domain: "project-management.com", count: 6, type: "Niche review blog" },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "What sources do AI engines cite when recommending software?",
    a: "Overwhelmingly third-party review sites, tech media, community threads, and niche category blogs — not vendors' own homepages. Across 150 grounded AI answers in July 2026, the single most-cited source was the review marketplace G2, followed by YouTube, PCMag, and a long tail of category-specific review blogs like thedigitalprojectmanager.com. Vendor-owned domains appeared but were the minority of the most-cited sources.",
  },
  {
    q: "Is G2 important for AI search visibility?",
    a: "Yes. In our study, G2 (g2.com plus learn.g2.com) was the most-cited source overall, appearing in the grounded sources of about a fifth of all answers. Review marketplaces like G2, Capterra, and GetApp are structured, frequently updated, and heavily linked, which makes them ideal material for an answer engine to retrieve and cite. A strong, current presence there is one of the highest-leverage AEO moves.",
  },
  {
    q: "Does citing my own website help me get recommended by AI?",
    a: "It helps, but it isn't enough. Vendor domains did appear in the most-cited list — Salesforce, Brevo, Monday.com, and Plausible all showed up — but they were outnumbered by independent sources. Models weight third-party corroboration heavily. You can't self-cite your way onto the shortlist; you need to be mentioned across the review sites, listicles, and blogs the engines actually retrieve.",
  },
  {
    q: "Do all AI engines return sources?",
    a: "Almost always, when grounding is enabled. In our study, 149 of 150 answers returned grounded web sources, and every provider returned sources on roughly 100% of calls. One note on methodology: Google's Gemini returns cited URLs through a redirect wrapper (vertexaisearch.cloud.google.com), which we excluded from the publisher counts because it's an API artifact rather than an actual source.",
  },
  {
    q: "How do I get cited by AI answer engines?",
    a: "Get onto the sources they read. Prioritize a strong, current profile on review marketplaces (G2, Capterra), earn mentions in the big listicles and category review blogs for your space, and stay active where your buyers discuss tools (relevant subreddits, YouTube). Then make your own pages easy to extract. Measuring your citation rate before and after tells you what's working.",
  },
];

export default function WhichSourcesPost() {
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
        <span>Which sources AI cites</span>
      </nav>

      <h1>Which Sources Do AI Engines Cite When Recommending Software?</h1>
      <p className="post-meta">Published July 2026 &middot; {post.readingTime}</p>

      <p className="lede">
        When we ran 150 buying questions through five grounded AI engines, 149 of
        them came back with web sources attached. So we logged every one. The
        pattern is unambiguous and it should reshape how you think about getting
        recommended: AI doesn&rsquo;t invent its opinions. It synthesizes review
        sites, listicles, and niche blogs &mdash; and your own homepage is a bit
        player in that story.
      </p>

      <h2>The Most-Cited Sources</h2>
      <p>
        Here are the domains the engines cited most across the study. The count
        is the number of answers whose grounded sources included that domain
        (deduplicated per answer, out of 150).
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Type</th>
              <th>Answers citing it</th>
            </tr>
          </thead>
          <tbody>
            {DOMAINS.map((d) => (
              <tr key={d.domain}>
                <td>
                  <strong>{d.domain}</strong>
                </td>
                <td>{d.type}</td>
                <td>{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>G2 Is the Kingmaker</h2>
      <p>
        The single most-cited source, by a wide margin, was the review
        marketplace <strong>G2</strong> &mdash; its pages appeared in the grounded
        sources of roughly one in five answers. That makes sense when you think
        about what an answer engine wants: G2 is structured, constantly updated,
        densely linked, and organized exactly around the question &ldquo;what are
        the best tools in category X?&rdquo; It is, in effect, pre-chewed for a
        model to retrieve and quote.
      </p>
      <p>
        The practical implication is direct. If your category has a G2 grid and
        you&rsquo;re not well-represented on it &mdash; current profile, volume of
        recent reviews, correct categorization &mdash; you are handing the
        engines a reason to name someone else. Review marketplaces (G2, Capterra,
        GetApp, TrustRadius) are some of the highest-leverage real estate in AEO
        precisely because the models lean on them so heavily.
      </p>

      <h2>Third-Party Beats First-Party</h2>
      <p>
        Vendor-owned domains did show up &mdash; Salesforce, Brevo, Monday.com,
        and Plausible each appeared in the top ranks. But they were the minority.
        The bulk of the most-cited sources were independent: tech media (PCMag,
        TechRadar, TechRepublic), community (Reddit, YouTube), and a striking
        number of <em>niche category review blogs</em> &mdash;
        thedigitalprojectmanager.com, peoplemanagingpeople.com,
        project-management.com, and others.
      </p>
      <p>
        This is the core lesson for anyone chasing AI visibility: <strong>you
        cannot self-cite your way onto the shortlist.</strong> Models corroborate.
        Your own site tells them what you claim; the review sites and blogs tell
        them whether the rest of the world agrees. A page on your domain saying
        &ldquo;we&rsquo;re the best&rdquo; is worth far less to a model than a
        third-party listicle that puts you in its top five.
      </p>

      <h2>Niche Blogs Punch Above Their Weight</h2>
      <p>
        One surprise: small, category-specific blogs were cited as often as major
        media. A dedicated project-management review site was cited more than most
        household tech publications. Sites like paymoapp.com, launchthedamnthing.com,
        and wpmailsmtp.com &mdash; not names you&rsquo;d recognize from a traffic
        chart &mdash; kept appearing.
      </p>
      <p>
        Why? Because they answer the exact question with depth and structure. A
        focused &ldquo;best 12 help desk tools&rdquo; post from a category expert
        is more useful to a model than a general-interest article that mentions
        the category in passing. For AEO, being genuinely comprehensive in a
        narrow niche is a real edge &mdash; both when you publish that content
        yourself and when you get featured in someone else&rsquo;s.
      </p>

      <div className="post-cta">
        <span className="kicker">Trace your own citations</span>
        <h3>See which sources cite you &mdash; and which cite your rivals</h3>
        <p>
          openllmrank runs your buying questions through five grounded engines and
          captures the actual sources behind every answer, so you can see exactly
          which pages are putting your competitors on the shortlist.
        </p>
        <Link href="/wizard/brand" className="btn-primary">
          Start tracking &mdash; $49/month
        </Link>
      </div>

      <h2>What to Do With This</h2>
      <ul>
        <li>
          <strong>Own your review-marketplace presence.</strong> A current,
          well-reviewed, correctly-categorized G2 and Capterra profile is
          table stakes. This is the single most-cited source type.
        </li>
        <li>
          <strong>Get into the listicles.</strong> Identify the &ldquo;best X&rdquo;
          roundups and category review blogs the engines actually cite in your
          space, and earn a place in them.
        </li>
        <li>
          <strong>Publish the definitive niche resource.</strong> A deep,
          structured comparison in your narrow category can itself become a cited
          source &mdash; and doubles as your own AEO content.
        </li>
        <li>
          <strong>Don&rsquo;t stop at your own site.</strong> First-party pages
          matter for extraction, but corroboration from third parties is what
          earns the citation. See{" "}
          <Link href="/blog/how-to-get-mentioned-in-chatgpt">
            how to get mentioned in ChatGPT
          </Link>{" "}
          for the full playbook.
        </li>
      </ul>
      <p>
        For the companion piece &mdash; which brands actually got recommended
        across these 150 answers &mdash; see{" "}
        <Link href="/blog/state-of-ai-search-2026">State of AI Search 2026</Link>.
      </p>

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
            versus competitors, and the sources behind every answer. $49 a
            month, first report in about fifteen minutes.
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
