import { CheckForm } from "./_components/check-form";

export const metadata = {
  title: "Free AI Crawler & Crawlability Checker",
  alternates: { canonical: "/check" },
  openGraph: {
    title: "Free AI Crawler & Crawlability Checker",
    description: "Find blocked crawlers, broken links, orphan pages, and indexing conflicts. No signup required.",
    url: "https://openllmrank.io/check",
  },
  twitter: {
    card: "summary_large_image",
    title: "Free AI Crawler & Crawlability Checker",
    description: "Find blocked crawlers, broken links, orphan pages, and indexing conflicts. No signup required.",
  },
  description:
    "Check for blocked AI crawlers, broken internal links, orphan pages, and indexing conflicts. Free crawlability check. No signup required.",
};

export default function CheckPage() {
  return (
    <article className="wrap check-hero">
          <span className="kicker">Free crawlability check</span>
          <h1>Can Google and AI crawlers access your website?</h1>
          <p className="sub">
            Our blog sat at &ldquo;Discovered &mdash; not indexed&rdquo; for
            months because broken internal links severed the crawl paths.
            Nothing errored. Nothing warned. This check finds that class of
            silent failure in about a minute: orphan pages, broken internal
            links, blocked search and AI crawlers.
          </p>

          <CheckForm />
          <p className="muted">This checks crawl access, not whether AI recommends your brand. For mention and citation evidence, <a href="/sample-report.html">see a sample visibility report</a>.</p>

          <hr className="rule" />

          <section className="check-explain">
            <h2>What it checks</h2>
            <ul>
              <li>
                <strong>Crawl paths</strong> &mdash; we walk your site the way
                Googlebot does, from the homepage, link by link, and diff what
                we reach against your sitemap. Pages in the sitemap that no
                internal link reaches are effectively invisible.
              </li>
              <li>
                <strong>Broken internal links</strong> &mdash; links on your
                own pages that lead to errors sever crawl paths for everything
                behind them.
              </li>
              <li>
                <strong>AI crawler access</strong> &mdash; the bots behind
                ChatGPT search, Claude search, and Perplexity are not the same
                bots that collect training data. We tell you exactly who your
                robots.txt blocks, by category.
              </li>
              <li>
                <strong>Indexing directives</strong> &mdash; noindex pages
                that are also in your sitemap, canonicals pointing elsewhere,
                unreadable sitemaps.
              </li>
            </ul>
            <p className="muted">
              Every finding ships with a copy-paste prompt for your coding
              agent &mdash; Claude Code, Cursor, Hermes &mdash; that fixes the
              causes in your repo and opens a PR. We crawl politely: robots.txt
              respected, up to 200 pages, one request at a time.
            </p>
          </section>
    </article>
  );
}
