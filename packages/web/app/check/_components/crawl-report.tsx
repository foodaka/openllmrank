"use client";

// Polls GET /api/crawl-check/[token] every ~3s until the crawl reaches a
// terminal state, then renders the findings. States rendered honestly:
//   queued/running → phase-1 facts + "checked N of M" progress
//   complete       → findings (headline tier expanded, secondary collapsed)
//   partial        → same + "checked N of M discovered pages" banner
//   failed         → phase-1 + a clear explanation — never a broken page
// Non-OK poll responses (500s) render a retryable notice — never a crash,
// never a silent forever-spinner (review finding).

import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@vercel/analytics";
// Canonical types + pure helpers come from packages/crawl so server and
// client can't drift (review finding). IMPORTANT: import from the pure
// subpaths, never the package barrel — the barrel re-exports guarded-fetch,
// which pulls node:dns/node:http into a CLIENT bundle and 500s the page.
import { isTerminalState, type Finding, type Phase1 } from "@openllmrank/crawl/types";
import { describeFinding } from "@openllmrank/crawl/describe";

/** Shape of GET /api/crawl-check/[token] — phase1 arrives with the sitemap
 * URL list replaced by a count (the list would be up to 5,000 URLs polled
 * every 3s; the client only ever renders the count). */
type ReportPhase1 = Omit<Phase1, "sitemap_urls"> & { sitemap_url_count: number };

type Report = {
  domain: string;
  state: "queued" | "running" | "complete" | "partial" | "failed";
  phase1: ReportPhase1 | null;
  findings: Finding[];
  pages_crawled: number;
  pages_discovered: number;
  failure_reason: string | null;
  superseded: boolean;
  fix_prompt: string | null;
};

const POLL_MS = 3000;

// ── First-signals task rows ─────────────────────────────────────────────────
// Live status rows (running → done/failed) with expandable detail, driven by
// REAL poll state — never scripted. Motion per DESIGN.md: minimal-functional,
// ease, ≤200ms.

type RowStatus = "running" | "done" | "warn" | "failed";

function StatusBadge({ status }: { status: RowStatus }) {
  if (status === "running") {
    return (
      <span className="task-ring" aria-label="in progress">
        <svg width="22" height="22" viewBox="0 0 22 22">
          <circle cx="11" cy="11" r="9" fill="none" stroke="var(--line)" strokeWidth="2" />
          <circle
            cx="11" cy="11" r="9" fill="none"
            stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"
            strokeDasharray="16 41"
          />
        </svg>
      </span>
    );
  }
  const tone = status === "done" ? "var(--win)" : status === "warn" ? "var(--accent-2)" : "var(--loss)";
  return (
    <span className="task-badge" style={{ background: tone }} aria-label={status}>
      {status === "done" ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--paper)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--paper)" strokeWidth="3.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
      )}
    </span>
  );
}

type TaskRowData = {
  key: string;
  status: RowStatus;
  label: string;
  meta: string;
  details: Array<{ label: string; meta: string }>;
};

function TaskRows({ rows }: { rows: TaskRowData[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="task-rows">
      {rows.map((row) => {
        const isOpen = open[row.key] ?? false;
        return (
          <div key={row.key} className="task-row">
            <button
              type="button"
              aria-expanded={isOpen}
              className="task-row-head"
              onClick={() => setOpen((cur) => ({ ...cur, [row.key]: !isOpen }))}
            >
              <StatusBadge status={row.status} />
              <span className="task-label">{row.label}</span>
              <span className="task-meta">{row.meta}</span>
              <svg
                aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="var(--muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                className="task-chevron"
                style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <div className="task-detail" style={{ gridTemplateRows: isOpen ? "1fr" : "0fr", opacity: isOpen ? 1 : 0 }}>
              <div className="task-detail-clip">
                <div className="task-detail-grid">
                  <span aria-hidden className="task-guide" />
                  <div className="task-detail-list">
                    {row.details.map((d) => (
                      <div key={d.label} className="task-detail-item">
                        <span>{d.label}</span>
                        <span className="task-detail-meta">{d.meta}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function firstSignalRows(report: Report): TaskRowData[] {
  const p = report.phase1;
  const running = !isTerminalState(report.state);
  const blockedBots = p?.bot_access.filter((b) => !b.allowed) ?? [];

  return [
    {
      key: "robots",
      status: !p ? "running" : p.robots_blocks_all ? "failed" : "done",
      label: "Read robots.txt",
      meta: !p ? "fetching…" : p.robots_txt_found ? (p.robots_blocks_all ? "blocks all crawlers" : "found") : "not found",
      details: [
        { label: "robots.txt present", meta: !p ? "…" : p.robots_txt_found ? "yes" : "no" },
        {
          label: "Blocked bots",
          meta: !p ? "…" : blockedBots.length > 0 ? blockedBots.map((b) => b.bot).join(", ") : "none",
        },
      ],
    },
    {
      key: "sitemap",
      status: !p ? "running" : p.sitemap_found ? "done" : "warn",
      label: "Discover sitemap",
      meta: !p ? "fetching…" : p.sitemap_found ? `${p.sitemap_url_count} URLs` : "not found",
      details: [
        { label: "Sitemap found", meta: !p ? "…" : p.sitemap_found ? "yes" : "no" },
        { label: "URLs listed", meta: !p ? "…" : String(p.sitemap_url_count) },
      ],
    },
    {
      key: "crawl",
      status: running ? "running" : report.state === "failed" ? "failed" : "done",
      label: "Crawl pages like Googlebot",
      meta: running
        ? `${report.pages_crawled} of ${report.pages_discovered} pages…`
        : report.state === "failed"
          ? "site unreachable"
          : `${report.pages_crawled} pages`,
      details: [
        { label: "Pages crawled", meta: String(report.pages_crawled) },
        { label: "Pages discovered", meta: String(report.pages_discovered) },
        { label: "Result", meta: report.state },
      ],
    },
  ];
}

export function CrawlReport({ token }: { token: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [transientError, setTransientError] = useState(false);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [recheckBusy, setRecheckBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/crawl-check/${token}`, { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 404 || res.status === 410) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setGone(body.error ?? "This report does not exist.");
          return;
        }
        if (!res.ok) {
          // Server hiccup: show a notice, keep polling — never crash the page.
          setTransientError(true);
          timer.current = setTimeout(poll, POLL_MS);
          return;
        }
        const body = (await res.json()) as Report;
        setTransientError(false);
        setReport((prev) => {
          // Funnel event once, when the report first reaches a terminal state
          // on this pageview (success criterion: report views vs CTA clicks).
          if (isTerminalState(body.state) && (!prev || !isTerminalState(prev.state))) {
            track("crawl_report_view", { state: body.state });
          }
          return body;
        });
        if (!isTerminalState(body.state)) {
          timer.current = setTimeout(poll, POLL_MS);
        }
      } catch {
        if (!cancelled) {
          setTransientError(true);
          timer.current = setTimeout(poll, POLL_MS);
        }
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [token]);

  const recheck = useCallback(async () => {
    if (!report || recheckBusy) return;
    setRecheckBusy(true);
    try {
      const res = await fetch("/api/crawl-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: report.domain, force: true }),
      });
      const body = (await res.json()) as { token?: string; error?: string };
      if (res.ok && body.token) {
        window.location.href = `/check/${body.token}`;
        return;
      }
      setRecheckBusy(false);
      alert(body.error ?? "Could not start a fresh check. Try again later.");
    } catch {
      setRecheckBusy(false);
    }
  }, [report, recheckBusy]);

  if (gone) {
    return (
      <>
        <span className="kicker">Crawlability report</span>
        <h1>Report unavailable</h1>
        <p className="muted">{gone}</p>
      </>
    );
  }

  if (!report) {
    return (
      <>
        <span className="kicker">Crawlability report</span>
        <h1>Loading…</h1>
        {transientError ? (
          <p className="crawl-banner" role="status">
            Temporary problem reaching the server — retrying…
          </p>
        ) : null}
      </>
    );
  }

  const headline = report.findings.filter((f) => f.tier === "headline");
  const secondary = report.findings.filter((f) => f.tier === "secondary");
  const running = !isTerminalState(report.state);

  return (
    <>
      <span className="kicker">Crawlability report</span>
      <h1>{report.domain}</h1>

      {transientError ? (
        <p className="crawl-banner" role="status">
          Temporary problem reaching the server — retrying…
        </p>
      ) : null}

      {report.superseded ? (
        <p className="crawl-banner">
          A newer check of this domain exists — these findings may be out of
          date.{" "}
          <button type="button" className="btn-text" onClick={recheck} disabled={recheckBusy}>
            {recheckBusy ? "Starting…" : "Run a fresh check now"}
          </button>
        </p>
      ) : null}

      {report.state === "partial" ? (
        <p className="crawl-banner">
          Partial crawl: checked {report.pages_crawled} of{" "}
          {report.pages_discovered} discovered pages (page or time limit
          reached). Unreached sitemap pages are labeled &ldquo;not verified
          reachable&rdquo; rather than claimed as problems.
        </p>
      ) : null}

      {report.state === "failed" ? (
        <section>
          <h2>We couldn&rsquo;t crawl this site</h2>
          <p className="muted">
            {report.failure_reason ??
              "The site was unreachable from our crawler."}
          </p>
          <p className="muted">
            The quick checks below still ran. If the site is up for you, it
            may be blocking data-center traffic — that can also mean AI
            crawlers never see it.{" "}
            <button type="button" className="btn-text" onClick={recheck} disabled={recheckBusy}>
              {recheckBusy ? "Starting…" : "Try a fresh check"}
            </button>
          </p>
        </section>
      ) : null}

      <section className="crawl-phase1">
        <h2>First signals</h2>
        <TaskRows rows={firstSignalRows(report)} />
        {running ? (
          <p className="visually-hidden" aria-live="polite">
            Crawling — checked {report.pages_crawled} of {report.pages_discovered} discovered pages
          </p>
        ) : null}
      </section>

      {running ? null : (
        <>
          <section>
            <h2>Crawl-path findings ({headline.length})</h2>
            {headline.length === 0 ? (
              <p className="muted">
                None — every sitemap page is reachable by internal links and
                no crawler is locked out. Your crawl paths are healthy.
              </p>
            ) : (
              <ul className="crawl-findings">
                {headline.map((f, i) => (
                  <li key={i} className={`crawl-finding ${f.severity}`}>
                    <span className="crawl-sev">{f.severity}</span> {describeFinding(f)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {secondary.length > 0 ? (
            <details className="crawl-secondary">
              <summary>Hygiene notes ({secondary.length})</summary>
              <ul className="crawl-findings">
                {secondary.map((f, i) => (
                  <li key={i} className={`crawl-finding ${f.severity}`}>
                    <span className="crawl-sev">{f.severity}</span> {describeFinding(f)}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {report.fix_prompt ? (
            <section className="crawl-fix">
              <h2>Fix it with your coding agent</h2>
              <p className="muted">
                Paste this into Claude Code, Cursor, or Hermes inside your
                site&rsquo;s repository — it locates the causes and opens a
                pull request. The prompt treats everything extracted from the
                site as untrusted data; review the PR before merging, as you
                would any agent&rsquo;s work.
              </p>
              <button
                className="btn-primary"
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(report.fix_prompt!);
                    setCopied("copied");
                  } catch {
                    setCopied("failed");
                  }
                  setTimeout(() => setCopied("idle"), 2000);
                }}
              >
                {copied === "copied" ? "Copied!" : copied === "failed" ? "Copy failed — select the text below" : "Copy fix prompt"}
              </button>
              <span aria-live="polite" className="visually-hidden">
                {copied === "copied" ? "Fix prompt copied to clipboard" : copied === "failed" ? "Copy failed" : ""}
              </span>
              <pre className="crawl-prompt">{report.fix_prompt}</pre>
            </section>
          ) : null}

          <hr className="rule" />
          <section className="crawl-cta">
            <h2>Reachable is step one. Cited is the goal.</h2>
            <p className="muted">
              This check tells you whether crawlers can reach your pages. The{" "}
              <a href="/" onClick={() => track("crawl_report_cta_click")}>
                openllmrank report
              </a>{" "}
              tells you whether ChatGPT, Claude, Gemini, Perplexity, and Grok
              actually cite your brand — and who they cite instead.
            </p>
          </section>
        </>
      )}
    </>
  );
}
