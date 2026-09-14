import type { Metadata } from "next";
import Link from "next/link";
import { getPostBySlug, getRelatedPosts } from "../../../lib/blog";

const SITE_URL = "https://openllmrank.io";
const SLUG = "discovered-currently-not-indexed";
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

// GSC page-indexing statuses and what each one actually tells you. The
// extractable comparison table for this post — question-shaped, structured,
// the thing an answer engine can lift wholesale.
type Status = { status: string; meaning: string; usualCause: string };
const STATUSES: Status[] = [
  {
    status: "Discovered — currently not indexed",
    meaning:
      "Google knows the URL exists but hasn't even crawled it yet",
    usualCause:
      "Weak or severed internal links, few external links, low perceived priority",
  },
  {
    status: "Crawled — currently not indexed",
    meaning: "Google fetched the page and chose not to index it",
    usualCause: "Thin or duplicative content, quality signals, near-duplicates",
  },
  {
    status: "Excluded by 'noindex' tag",
    meaning: "You told Google not to index it",
    usualCause: "A noindex meta tag or X-Robots-Tag header — sometimes left in by mistake",
  },
  {
    status: "Blocked by robots.txt",
    meaning: "Google isn't allowed to fetch the page at all",
    usualCause: "A disallow rule covering the path — often broader than intended",
  },
  {
    status: "Alternate page with proper canonical tag",
    meaning: "Google indexed a different URL it considers the original",
    usualCause: "Canonical pointing elsewhere — intentional or a template bug",
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "What does \"Discovered — currently not indexed\" mean in Google Search Console?",
    a: "It means Google knows the URL exists — usually from your sitemap — but hasn't crawled it yet, and therefore can't index it. The page is in Google's to-do list, not its index. If pages sit in this state for weeks, it's a signal Google doesn't consider them worth fetching, most often because too few links point at them.",
  },
  {
    q: "How do I fix \"Discovered — currently not indexed\"?",
    a: "First verify the page is actually reachable by following links from your homepage — this is the step almost everyone skips. If a page is only listed in your sitemap and no internal link leads to it (an orphan page), fix the internal linking: add links from your navigation, a listing page, or related content. Then confirm robots.txt and noindex aren't interfering, and request indexing in Search Console. Sitemap submission alone rarely fixes it, because the sitemap is a hint, not a crawl path.",
  },
  {
    q: "Can broken internal links stop Google from indexing my pages?",
    a: "Yes — this is one of the most common silent causes. Googlebot discovers most pages by following links. If the link from your homepage to your blog index is broken, every post behind it loses its crawl path and can sit at \"Discovered — currently not indexed\" indefinitely, even while the sitemap dutifully lists every URL. Nothing errors and nothing warns you; the pages simply never surface.",
  },
  {
    q: "What is an orphan page?",
    a: "A page that exists and may even be in your sitemap, but that no internal link on your site points to. Crawlers that discover by following links either never find it or treat it as low priority. Orphan pages are invisible in the truest sense: your own site never vouches for them.",
  },
  {
    q: "Do broken crawl paths affect AI search engines like ChatGPT and Perplexity too?",
    a: "Yes. The crawlers behind AI search — OAI-SearchBot for ChatGPT search, Claude-SearchBot, PerplexityBot — discover pages the same way Googlebot does: by following links and reading sitemaps. A page that Googlebot can't reach is a page AI engines can't read, quote, or cite. Fixing crawl paths is a prerequisite for both traditional SEO and AI search visibility.",
  },
  {
    q: "How can I check if my site has broken crawl paths?",
    a: "Crawl your own site the way Googlebot does: start at the homepage, follow every internal link, and compare the set of pages you reached against your sitemap. Anything in the sitemap you couldn't reach is orphaned or behind a broken link. openllmrank's free crawl check does exactly this in about a minute — no signup — and hands you a fix prompt for your coding agent.",
  },
];

export default function DiscoveredNotIndexedPost() {
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
        <span>Discovered — currently not indexed</span>
      </nav>

      <h1>
        Discovered &mdash; Currently Not Indexed: The Silent Cause Nobody
        Checks
      </h1>
      <p className="post-meta">Published August 2026 &middot; {post.readingTime}</p>

      <p className="lede">
        &ldquo;Discovered &mdash; currently not indexed&rdquo; means Google
        knows your page exists but hasn&rsquo;t crawled it &mdash; and if pages
        sit there for weeks, Google is telling you it can&rsquo;t find a good
        path to them. We know because it happened to this site: every blog post
        we published sat in that state for months. The cause wasn&rsquo;t
        content quality or crawl budget. It was broken internal links severing
        the crawl paths &mdash; and we were completely blind to it.
      </p>

      <h2>The Story: A Blog Google Refused to Read</h2>
      <p>
        We ship a content blog for the usual reason: earn search traffic in a
        category we know well. Posts went out, the sitemap listed them, and
        Search Console showed them as discovered. Then&hellip; nothing. Week
        after week, every post stayed at &ldquo;Discovered &mdash; currently
        not indexed.&rdquo; No errors. No warnings. No traffic.
      </p>
      <p>
        The instinct is to blame content quality, or to resubmit the sitemap
        and wait harder. We did both. What finally cracked it was crawling our
        own site the way Googlebot does &mdash; starting at the homepage and
        following links. The crawl never reached the blog.{" "}
        <strong>
          The links that should have led there were broken, so every post
          behind them was unreachable by any crawl path.
        </strong>{" "}
        The sitemap said &ldquo;these pages exist&rdquo;; the site itself
        offered no way to walk to them. Google believed the site.
      </p>
      <p>
        One fix to the internal links later, the posts started moving into the
        index. Months of invisibility, caused by a bug that took sixty seconds
        to see &mdash; once we actually looked.
      </p>

      <h2>What Each Indexing Status Actually Tells You</h2>
      <p>
        Search Console&rsquo;s page-indexing statuses get conflated constantly.
        They mean very different things, and the fix is different for each:
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>GSC status</th>
              <th>What it means</th>
              <th>Most common cause</th>
            </tr>
          </thead>
          <tbody>
            {STATUSES.map((s) => (
              <tr key={s.status}>
                <td>
                  <strong>{s.status}</strong>
                </td>
                <td>{s.meaning}</td>
                <td>{s.usualCause}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        The one this post is about &mdash; <em>Discovered, not crawled</em>{" "}
        &mdash; is the pre-crawl state. Google hasn&rsquo;t judged your content
        at all yet. Which is exactly why content-side fixes don&rsquo;t move
        it: the problem is upstream, in whether crawlers can and want to reach
        the page.
      </p>

      <h2>Why Broken Internal Links Are the Silent Killer</h2>
      <p>
        Googlebot discovers the web by following links. Your sitemap is a
        hint, not a crawl path &mdash; a page that appears in the sitemap but
        that no internal link points to (an <strong>orphan page</strong>) is a
        page your own site never vouches for. Crawlers deprioritize it, often
        indefinitely.
      </p>
      <p>
        Broken internal links create orphans wholesale. One dead link in a
        navigation component can sever the path to an entire section &mdash;
        every page behind it loses its referrer in the link graph at once.
        And nothing tells you. The pages still render fine when you visit them
        directly. The sitemap still lists them. Analytics just shows the slow
        flatline of traffic that never arrives.
      </p>

      <h2>The Same Failure Hides You From AI Search</h2>
      <p>
        Here&rsquo;s the part most technical-SEO writeups miss: the crawlers
        behind AI answers &mdash; <strong>OAI-SearchBot</strong> (ChatGPT
        search), <strong>Claude-SearchBot</strong>,{" "}
        <strong>PerplexityBot</strong> &mdash; discover pages the same way
        Googlebot does. A severed crawl path doesn&rsquo;t just cost you
        Google rankings; it makes your pages unquotable and uncitable by every
        answer engine. If AI can&rsquo;t reach the page,{" "}
        <Link href="/blog/which-sources-do-ai-engines-cite">
          it can&rsquo;t cite you
        </Link>{" "}
        &mdash; it cites whoever it <em>could</em> reach.
      </p>

      <h2>How to Diagnose It in 60 Seconds</h2>
      <p>The check is mechanical, and you can do it by hand:</p>
      <ul>
        <li>
          <strong>Crawl from your homepage, following internal links only.</strong>{" "}
          Note every page you can reach.
        </li>
        <li>
          <strong>Diff that set against your sitemap.</strong> Anything in the
          sitemap you never reached is orphaned or behind a broken link.
        </li>
        <li>
          <strong>Check the blockers while you&rsquo;re at it:</strong>{" "}
          robots.txt rules broader than intended, stray noindex tags on pages
          you sitemap, canonicals pointing somewhere else &mdash; and whether
          your robots.txt blocks the AI search bots outright.
        </li>
      </ul>
      <p>
        Or let a crawler do it. We turned the exact diagnosis that saved this
        blog into a free tool: it walks your site like Googlebot, diffs the
        result against your sitemap, checks the robots/noindex/canonical
        blockers and AI-crawler access, and &mdash; because most of these
        fixes are one-line code changes &mdash; hands you a copy-paste prompt
        for your coding agent (Claude Code, Cursor, Hermes) that repairs the
        causes and opens a pull request.
      </p>

      <div className="post-cta">
        <span className="kicker">Free &middot; no signup</span>
        <h3>Is your site invisible? Check it in 60 seconds</h3>
        <p>
          Type your domain. See every orphan page, broken internal link, and
          blocked crawler standing between your pages and the index &mdash;
          Google&rsquo;s and AI&rsquo;s alike.
        </p>
        <Link href="/check" className="btn-primary">
          Run the free crawl check
        </Link>
      </div>

      <h2>Frequently Asked Questions</h2>
      {FAQ.map((f) => (
        <div key={f.q}>
          <h3>{f.q}</h3>
          <p>{f.a}</p>
        </div>
      ))}

      <div className="post-end">
        <div className="post-cta">
          <span className="kicker">Reachable is step one</span>
          <h3>Cited is the goal</h3>
          <p>
            The crawl check tells you whether engines can reach your pages.
            The openllmrank report tells you whether ChatGPT, Claude, Gemini,
            Perplexity, and Grok actually cite your brand &mdash; and who they
            cite instead. $29.99, delivered in about fifteen minutes.
          </p>
          <Link href="/wizard/brand" className="btn-primary">
            Get my report &mdash; $29.99
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
