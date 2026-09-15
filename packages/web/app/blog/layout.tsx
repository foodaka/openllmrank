import type { Metadata } from "next";
import Link from "next/link";
import { ContactLink } from "../_components/contact-link";

// Blog chrome + editorial article styling. openllmrank has no Tailwind / prose
// utility, so long-form typography is defined here in the same token system as
// the rest of the site (Fraunces display, DM Sans body, warm paper, moss
// accent). Kept out of globals.css because it's scoped to the blog.

export const metadata: Metadata = {
  title: {
    template: "%s — openllmrank",
    default: "Blog — openllmrank",
  },
  description:
    "Field notes on AI search visibility, answer engine optimization (AEO), and getting your brand cited by ChatGPT, Perplexity, and Gemini.",
};

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Feed autodiscovery on every blog URL, index and post alike. React 19
          hoists this into <head>. It lives here rather than in each page's
          `alternates` because a child's `alternates` replaces the parent's
          wholesale, and every post already sets its own canonical there. */}
      <link
        rel="alternate"
        type="application/rss+xml"
        title="openllmrank — Field notes on AI search visibility"
        href="/blog/feed.xml"
      />

      <nav className="site-nav">
        <Link href="/" className="wordmark">
          openllmrank
        </Link>
        <ul className="site-nav-links">
          <li>
            <Link href="/blog">Blog</Link>
          </li>
          <li>
            <Link href="/#how-it-works">How it works</Link>
          </li>
          <li>
            <Link href="/login">Sign in</Link>
          </li>
          <li>
            <Link href="/wizard/brand" className="nav-cta">
              Get my report
            </Link>
          </li>
        </ul>
      </nav>

      <main>{children}</main>

      <footer className="wrap site-footer">
        <span className="muted">
          openllmrank &middot; Privacy-friendly, open-source analytics for AI
          search visibility &middot; <Link href="/login">Sign in</Link> &middot;{" "}
          <Link href="/blog">Blog</Link> &middot;{" "}
          <Link href="/privacy">Privacy</Link> &middot;{" "}
          <Link href="/terms">Terms</Link> &middot;{" "}
          <ContactLink>Contact</ContactLink> &middot;{" "}
          <a href="https://github.com/foodaka/openllmrank">Open source CLI</a>
        </span>
      </footer>

      <style>{`
        /* --- Shared chrome (mirrors the homepage nav / footer) --- */
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
          border-bottom: 1px solid transparent;
        }
        .wordmark:hover { border-bottom-color: transparent; }
        .site-nav-links {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          gap: 24px;
          align-items: center;
        }
        .site-nav-links a {
          font-size: 14px;
          color: var(--ink);
        }
        .site-nav-links a:hover {
          color: var(--accent);
          border-bottom-color: var(--accent);
        }
        .site-nav-links a.nav-cta {
          background: var(--accent);
          color: var(--paper);
          padding: 8px 16px;
          border-radius: var(--radius-md);
          font-weight: 600;
        }
        .site-nav-links a.nav-cta:hover {
          filter: brightness(0.95);
          border-bottom-color: transparent;
        }
        .site-footer {
          padding-top: 24px;
          padding-bottom: 48px;
          border-top: 1px solid var(--line);
          color: var(--muted);
          font-size: 14px;
        }

        /* --- Blog index --- */
        .blog-wrap {
          max-width: 760px;
          margin: 0 auto;
          padding: 48px 28px 96px;
        }
        .blog-head { margin-bottom: 8px; }
        .blog-head .headline {
          font-size: 52px;
          line-height: 1.02;
          margin: 12px 0 16px;
          letter-spacing: -0.02em;
        }
        .blog-head .sub {
          font-size: 19px;
          color: var(--muted);
          max-width: 620px;
        }
        .post-list { margin-top: 8px; }
        .post-list-item {
          padding: 32px 0;
          border-top: 1px solid var(--line);
        }
        .post-list-item .meta {
          font-size: 13px;
          color: var(--muted);
          font-variant-numeric: tabular-nums;
          margin-bottom: 8px;
          display: flex;
          gap: 12px;
          align-items: center;
        }
        .post-list-item .meta .tag { color: var(--accent-2); }
        .post-list-item h2 {
          font-size: 30px;
          line-height: 1.08;
          margin-bottom: 10px;
        }
        .post-list-item h2 a {
          color: var(--ink);
          border-bottom: none;
        }
        .post-list-item h2 a:hover { color: var(--accent); }
        .post-list-item p {
          color: var(--muted);
          font-size: 17px;
          line-height: 1.6;
          margin: 0;
          max-width: 640px;
        }

        /* --- Article --- */
        .post {
          max-width: 720px;
          margin: 0 auto;
          padding: 40px 28px 96px;
        }
        .breadcrumb {
          font-size: 13px;
          color: var(--muted);
          margin-bottom: 28px;
        }
        .breadcrumb a { color: var(--muted); }
        .breadcrumb a:hover { color: var(--accent); }
        .breadcrumb .sep { margin: 0 8px; }

        .post h1 {
          font-size: 46px;
          line-height: 1.04;
          letter-spacing: -0.02em;
          margin-bottom: 16px;
        }
        .post .post-meta {
          font-size: 14px;
          color: var(--muted);
          font-variant-numeric: tabular-nums;
          margin-bottom: 40px;
        }
        .post .lede {
          font-size: 21px;
          line-height: 1.5;
          color: var(--ink);
          margin-bottom: 32px;
        }
        .post h2 {
          font-size: 30px;
          line-height: 1.1;
          letter-spacing: -0.01em;
          margin: 56px 0 16px;
        }
        .post h3 {
          font-size: 21px;
          margin: 36px 0 12px;
        }
        .post p {
          font-size: 17px;
          line-height: 1.65;
          color: var(--ink);
          margin: 0 0 20px;
        }
        .post ul, .post ol {
          font-size: 17px;
          line-height: 1.65;
          color: var(--ink);
          padding-left: 24px;
          margin: 0 0 20px;
        }
        .post li { margin-bottom: 10px; }
        .post strong { font-weight: 600; }

        .post .table-scroll {
          overflow-x: auto;
          margin: 0 0 24px;
        }
        .post table {
          width: 100%;
          border-collapse: collapse;
          font-size: 15px;
          line-height: 1.5;
        }
        .post th, .post td {
          text-align: left;
          padding: 12px 16px 12px 0;
          border-bottom: 1px solid var(--line);
          vertical-align: top;
        }
        .post th {
          font-family: var(--font-body);
          font-weight: 700;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--accent);
          border-bottom: 2px solid var(--line);
        }
        .post td:last-child, .post th:last-child { padding-right: 0; }

        .post blockquote {
          margin: 24px 0;
          padding: 4px 0 4px 20px;
          border-left: 2px solid var(--accent-2);
          font-family: var(--font-display);
          font-size: 22px;
          line-height: 1.35;
          color: var(--ink);
        }

        /* In-article CTA callout */
        .post-cta {
          background: var(--soft);
          border: 1px solid var(--line);
          border-radius: var(--radius-md);
          padding: 32px;
          margin: 48px 0;
        }
        .post-cta h3 {
          font-size: 26px;
          margin: 8px 0 10px;
        }
        .post-cta p {
          color: var(--muted);
          font-size: 16px;
          margin-bottom: 20px;
          max-width: 520px;
        }

        .post-end {
          margin-top: 64px;
          padding-top: 40px;
          border-top: 1px solid var(--line);
        }
        .related h2 { font-size: 22px; margin-bottom: 20px; }
        .related-list { display: grid; gap: 16px; }
        .related-list a {
          color: var(--ink);
          border-bottom: none;
          font-family: var(--font-display);
          font-size: 19px;
        }
        .related-list a:hover { color: var(--accent); }

        @media (max-width: 820px) {
          .site-nav { padding: 20px 20px 0; }
          .site-nav-links { gap: 16px; }
          .blog-wrap { padding: 32px 20px 64px; }
          .blog-head .headline { font-size: 38px; }
          .post { padding: 24px 20px 64px; }
          .post h1 { font-size: 34px; }
          .post h2 { font-size: 26px; margin-top: 44px; }
          .post .lede { font-size: 19px; }
        }
      `}</style>
    </>
  );
}
