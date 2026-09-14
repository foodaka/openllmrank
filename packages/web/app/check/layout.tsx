import type { Metadata } from "next";
import Link from "next/link";

// Crawl-check chrome + scoped styling, same token system as the rest of the
// site (Fraunces display, DM Sans body, warm paper, moss accent). Kept out of
// globals.css because it's scoped to /check — the blog layout does the same.

export const metadata: Metadata = {
  title: {
    template: "%s — openllmrank",
    default: "Is your site invisible? — free crawlability check",
  },
};

export default function CheckLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <nav className="site-nav">
        <Link href="/" className="wordmark">openllmrank</Link>
        <ul className="site-nav-links">
          <li><Link href="/check">Crawl check</Link></li>
          <li><Link href="/blog">Blog</Link></li>
          <li><Link href="/wizard/brand" className="nav-cta">Get my report</Link></li>
        </ul>
      </nav>

      <main>{children}</main>

      <footer className="wrap site-footer">
        <span className="muted">
          openllmrank &middot; <Link href="/">Home</Link> &middot;{" "}
          <Link href="/blog">Blog</Link> &middot;{" "}
          <Link href="/privacy">Privacy</Link> &middot;{" "}
          <Link href="/terms">Terms</Link>
        </span>
      </footer>

      <style>{`
        /* Chrome values match blog/layout.tsx exactly — same-named classes
           must not render differently between adjacent pages (design review). */
        .site-nav {
          display: flex; align-items: center; justify-content: space-between;
          padding: var(--space-md) var(--space-lg);
          border-bottom: 1px solid var(--line);
        }
        .wordmark {
          font-family: var(--font-display); font-weight: 500;
          font-size: 22px; color: var(--accent); text-decoration: none;
        }
        .site-nav-links { display: flex; align-items: center; gap: var(--space-lg); list-style: none; margin: 0; padding: 0; }
        .site-nav-links a { color: var(--ink); text-decoration: none; font-size: 14px; }
        .site-nav-links a:hover { color: var(--accent); }
        .site-nav-links a.nav-cta {
          background: var(--accent); color: var(--paper); font-weight: 600;
          padding: var(--space-sm) var(--space-md); border-radius: var(--radius-pill);
        }
        .site-nav-links a.nav-cta:hover { color: var(--paper); filter: brightness(0.95); }
        .site-footer { color: var(--muted); font-size: 14px; }
        .site-footer a { color: var(--muted); }
        .visually-hidden {
          position: absolute; width: 1px; height: 1px; overflow: hidden;
          clip: rect(0 0 0 0); white-space: nowrap;
        }

        .check-hero h1, .wrap h1 {
          font-family: var(--font-display); font-size: 44px; line-height: 1.1;
          margin: var(--space-sm) 0 var(--space-md);
        }
        .wrap h2 {
          font-family: var(--font-display); font-size: 24px;
          margin: var(--space-xl) 0 var(--space-sm);
        }
        .sub, .muted { color: var(--muted); }
        .sub { font-size: 18px; line-height: 1.6; max-width: 640px; }

        .check-form { margin: var(--space-xl) 0; max-width: 480px; }
        .check-form .btn-primary { margin-top: var(--space-md); }

        .check-explain ul { padding-left: 1.2em; }
        .check-explain li { margin-bottom: var(--space-md); line-height: 1.6; }

        .crawl-banner {
          background: var(--soft); border: 1px solid var(--line);
          border-radius: var(--radius-md); padding: var(--space-md);
          color: var(--ink);
        }
        .crawl-banner a { color: var(--accent); }

        /* First-signals task rows: live status → badge, expandable detail.
           Hairlines + paper per DESIGN.md; motion minimal-functional (≤200ms
           ease), spinner rotation is functional state, not decoration. */
        .task-rows { display: flex; flex-direction: column; gap: var(--space-sm); }
        .task-row {
          border: 1px solid var(--line); border-radius: var(--radius-md);
          background: var(--paper); overflow: hidden;
        }
        .task-row-head {
          display: flex; align-items: center; gap: var(--space-md);
          width: 100%; padding: var(--space-sm) var(--space-md);
          background: none; border: none; cursor: pointer; text-align: left;
          font: inherit; color: var(--ink); min-height: 44px;
          transition: background-color 120ms ease;
        }
        .task-row-head:hover { background: var(--soft); }
        .task-row-head:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .task-label { flex: 1; min-width: 0; font-weight: 600; font-size: 15px; }
        .task-meta {
          color: var(--muted); font-size: 14px;
          font-variant-numeric: tabular-nums; white-space: nowrap;
        }
        .task-chevron { flex-shrink: 0; transition: transform 200ms ease; }
        .task-ring { display: inline-flex; width: 22px; height: 22px; flex-shrink: 0; }
        .task-ring svg { animation: task-spin 1.1s linear infinite; }
        .task-badge {
          display: inline-flex; align-items: center; justify-content: center;
          width: 22px; height: 22px; border-radius: var(--radius-pill);
          flex-shrink: 0;
        }
        .task-detail {
          display: grid; transition: grid-template-rows 200ms ease, opacity 200ms ease;
        }
        .task-detail-clip { overflow: hidden; }
        .task-detail-grid {
          display: grid; grid-template-columns: 22px 1fr; gap: var(--space-md);
          padding: 0 var(--space-md) var(--space-sm);
        }
        .task-guide { justify-self: center; width: 1px; background: var(--line); }
        .task-detail-list { display: flex; flex-direction: column; gap: var(--space-xs); }
        .task-detail-item {
          display: flex; justify-content: space-between; gap: var(--space-md);
          font-size: 14px; color: var(--muted);
        }
        .task-detail-meta {
          font-variant-numeric: tabular-nums; color: var(--ink);
          text-align: right; word-break: break-word;
        }
        @keyframes task-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .task-ring svg { animation: none; }
          .task-chevron, .task-detail, .task-row-head { transition: none; }
        }

        .crawl-findings { list-style: none; padding: 0; }
        /* Hairlines, not boxes: severity is carried by the colored label —
           DESIGN.md explicitly refuses colored left-border card accents. */
        .crawl-finding {
          padding: var(--space-md); margin-bottom: var(--space-sm);
          border: 1px solid var(--line); border-radius: var(--radius-md);
          line-height: 1.5; word-break: break-word;
        }
        .crawl-finding.critical { background: var(--soft); }
        .crawl-sev {
          display: inline-block; font-size: 12px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.11em;
          margin-right: var(--space-sm); color: var(--ink);
        }
        .crawl-finding.critical .crawl-sev { color: var(--loss); }
        .crawl-finding.warning .crawl-sev { color: var(--accent-2); }

        .crawl-secondary { margin-top: var(--space-lg); }
        .crawl-secondary summary {
          cursor: pointer; color: var(--muted); font-weight: 600;
          margin-bottom: var(--space-md);
        }

        .crawl-prompt {
          background: var(--soft); border: 1px solid var(--line);
          border-radius: var(--radius-md); padding: var(--space-md);
          white-space: pre-wrap; word-break: break-word;
          font-family: "Berkeley Mono", "JetBrains Mono", ui-monospace, monospace;
          font-size: 14px; line-height: 1.5; max-height: 420px;
          overflow-y: auto; margin-top: var(--space-md);
        }

        .crawl-cta h2 { margin-top: var(--space-lg); }
        .crawl-cta a { color: var(--accent); }

        @media (max-width: 820px) {
          .check-hero h1, .wrap h1 { font-size: 32px; }
          .site-nav { padding: var(--space-md); }
          .site-nav-links { gap: var(--space-md); }
        }
      `}</style>
    </>
  );
}
