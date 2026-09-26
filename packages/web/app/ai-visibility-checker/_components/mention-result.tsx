"use client";

// Polls GET /api/mention-check/[token] every ~3s until the check is complete
// or failed, then renders the verdict. States rendered honestly:
//   queued/running → which assistants we're asking, live
//   complete       → verdict, per-assistant answer with the brand marked,
//                    cited sources, and the upgrade to the full report
//   failed         → the reason, and a way to try again
// Non-OK polls render a retryable notice, never a silent forever-spinner.

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  MENTION_CHECK_PROVIDERS,
  MENTION_PROVIDER_LABELS,
  type MentionAnswerResult,
  type MentionResults,
} from "@openllmrank/shared/mention-check";
import { trackFunnel } from "../../../lib/funnel-client";

type Check = {
  brand: string;
  domain: string;
  question: string;
  state: "queued" | "running" | "complete" | "failed";
  results: MentionResults | null;
  failure_reason: string | null;
};

const POLL_MS = 3000;
// Grounded answers take 10-60s; past this we stop and explain.
const GIVE_UP_MS = 4 * 60_000;

function label(provider: string): string {
  return MENTION_PROVIDER_LABELS[provider] ?? provider;
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wraps brand-name and domain matches in <mark>. React escapes the text. */
function Highlight({ text, needles }: { text: string; needles: string[] }) {
  const terms = needles.filter(Boolean).map(escapeRegex);
  if (terms.length === 0) return <>{text}</>;
  const parts = text.split(new RegExp(`(${terms.join("|")})`, "gi"));
  const lower = needles.map((n) => n.toLowerCase());
  return (
    <>
      {parts.map((part, i) =>
        lower.includes(part.toLowerCase()) ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

function Verdict({ check, results }: { check: Check; results: MentionResults }) {
  const mentioned = results.answers.filter((a) => a.status === "ok" && a.mentioned).map((a) => label(a.provider));
  const missed = results.answers.filter((a) => a.status === "ok" && !a.mentioned).map((a) => label(a.provider));

  let headline: string;
  if (mentioned.length === 0) headline = `No AI assistant mentioned ${check.brand}.`;
  else if (missed.length === 0) headline = `Every assistant mentioned ${check.brand}.`;
  else headline = `${listNames(mentioned)} mentioned ${check.brand}. ${listNames(missed)} did not.`;

  return (
    <header className="mention-verdict">
      <span className="kicker">
        {results.mentioned_count} of {results.answered_count} assistants mentioned you
      </span>
      <h1>{headline}</h1>
      <p className="sub">
        We asked: <q>{check.question}</q>
      </p>
    </header>
  );
}

function AnswerBlock({ answer, check }: { answer: MentionAnswerResult; check: Check }) {
  const name = label(answer.provider);
  const needles = [check.brand, check.domain];

  if (answer.status === "failed") {
    return (
      <section className="mention-answer">
        <div className="mention-answer-head">
          <h2>{name}</h2>
          <span className="mention-tag muted-tag">Didn&rsquo;t answer</span>
        </div>
        <p className="muted">{name} didn&rsquo;t respond this time, so it isn&rsquo;t counted.</p>
      </section>
    );
  }

  const others = answer.sources.filter((s) => !s.is_brand);
  return (
    <section className="mention-answer">
      <div className="mention-answer-head">
        <h2>{name}</h2>
        <span className={`mention-tag ${answer.mentioned ? "win-tag" : "loss-tag"}`}>
          {answer.mentioned ? "Mentioned you" : "Didn’t mention you"}
        </span>
      </div>

      {answer.mentioned && answer.excerpts.length > 0 ? (
        <>
          <p className="mention-label">Where you appear</p>
          {answer.excerpts.map((excerpt, i) => (
            <blockquote key={i} className="mention-quote">
              <Highlight text={excerpt} needles={needles} />
            </blockquote>
          ))}
        </>
      ) : (
        <>
          <p className="mention-label">{answer.mentioned ? "How you appear" : `What ${name} said instead`}</p>
          <blockquote className="mention-quote">
            <Highlight text={answer.answer_preview} needles={needles} />
          </blockquote>
          {answer.mentioned ? (
            <p className="muted">You appear through a cited source rather than by name in the answer.</p>
          ) : null}
        </>
      )}

      {answer.sources.length > 0 ? (
        <>
          <p className="mention-label">Sources it cited</p>
          <ul className="mention-sources">
            {answer.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                  {s.domain}
                </a>
                {s.is_brand ? <span className="mention-tag win-tag">you</span> : null}
                {s.title ? <span className="muted"> &middot; {s.title}</span> : null}
              </li>
            ))}
          </ul>
          {!answer.mentioned && others.length > 0 ? (
            <p className="muted">
              These are the pages {name} trusted for this question. Getting
              covered on them, or publishing a page that answers the question
              better, is how you get cited.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function UpgradeCta({ check }: { check: Check }) {
  return (
    <section className="mention-cta">
      <span className="kicker">One answer is a signal, not a verdict</span>
      <h2>See the whole picture for {check.brand}</h2>
      <p>
        AI answers change from run to run. The full report asks up to 10 buyer
        questions three times each on ChatGPT, Claude, Gemini, Perplexity and
        Grok, measures how often you&rsquo;re recommended against your
        competitors, and shows the exact pages that win each question.
      </p>
      <p className="mention-cta-actions">
        <a
          className="btn-primary"
          href="/wizard/brand"
          onClick={() => trackFunnel("mention_check_cta", { target: "report" })}
        >
          Get the full report &mdash; $79
        </a>
        <a href="/sample-report.html" onClick={() => trackFunnel("mention_check_cta", { target: "sample" })}>
          See a sample report
        </a>
      </p>
      <p className="muted">
        Want to know if AI crawlers can reach {check.domain} at all?{" "}
        <a href="/check" onClick={() => trackFunnel("mention_check_cta", { target: "crawl" })}>
          Run the free crawlability check
        </a>
        .
      </p>
    </section>
  );
}

export function MentionResult({ token }: { token: string }) {
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const startedAt = useRef(Date.now());
  const tracked = useRef(false);

  const poll = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/mention-check/${token}`, { cache: "no-store" });
      if (res.status === 404) {
        setError("We couldn't find this check. The link may be wrong.");
        return true;
      }
      if (!res.ok) {
        setError("We couldn't load the results just now. Retrying…");
        return false;
      }
      const body = (await res.json()) as Check;
      setError(null);
      setCheck(body);
      return body.state === "complete" || body.state === "failed";
    } catch {
      setError("Network error. Retrying…");
      return false;
    }
  }, [token]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const done = await poll();
      if (stopped || done) return;
      if (Date.now() - startedAt.current > GIVE_UP_MS) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [poll]);

  useEffect(() => {
    if (tracked.current || !check?.results || check.state !== "complete") return;
    tracked.current = true;
    trackFunnel("mention_check_complete", {
      mentioned: check.results.mentioned_count,
      answered: check.results.answered_count,
    });
  }, [check]);

  let body: React.ReactNode;
  if (!check) {
    body = error ? <p className="crawl-banner">{error}</p> : <p className="muted">Loading…</p>;
  } else if (check.state === "failed") {
    body = (
      <>
        <span className="kicker">AI visibility check</span>
        <h1>We couldn&rsquo;t finish this check.</h1>
        <p className="sub">{check.failure_reason ?? "Something went wrong on our side."}</p>
        <p>
          <a className="btn-primary" href="/ai-visibility-checker">Try again</a>
        </p>
      </>
    );
  } else if (check.state !== "complete" || !check.results) {
    body = (
      <>
        <span className="kicker">Checking {check.domain}</span>
        <h1>Asking the assistants&hellip;</h1>
        <p className="sub">
          We&rsquo;re asking <q>{check.question}</q> with web search on. This
          usually takes 20&ndash;60 seconds.
        </p>
        <ul className="mention-pending">
          {MENTION_CHECK_PROVIDERS.map((p) => (
            <li key={p.id}>{label(p.id)}</li>
          ))}
        </ul>
        {gaveUp ? (
          <p className="crawl-banner">
            This is taking longer than usual. Keep this page open or come back
            to this link in a few minutes; your results are saved here.
          </p>
        ) : null}
        {error ? <p className="crawl-banner">{error}</p> : null}
      </>
    );
  } else {
    body = (
      <>
        <Verdict check={check} results={check.results} />
        {check.results.answers.map((a) => (
          <AnswerBlock key={a.provider} answer={a} check={check} />
        ))}
        <UpgradeCta check={check} />
      </>
    );
  }

  return (
    <div className="mention-result">
      {body}
      <style>{`
        .mention-result q { quotes: "“" "”"; }
        .mention-verdict { margin-bottom: var(--space-lg); }
        .mention-answer {
          border-top: 1px solid var(--line);
          padding: var(--space-lg) 0;
        }
        .mention-answer-head {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: var(--space-md); flex-wrap: wrap;
        }
        /* Beat the layout's .wrap h2 margin (same specificity, later in the cascade). */
        .mention-result .mention-answer-head h2 { margin: 0; }
        .mention-tag {
          display: inline-block; font-size: 12px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.11em;
          padding: 2px var(--space-sm); border-radius: var(--radius-sm);
          margin-left: var(--space-sm);
        }
        .win-tag { color: var(--win); background: var(--soft); }
        .loss-tag { color: var(--loss); background: var(--soft); }
        .muted-tag { color: var(--muted); background: var(--soft); }
        .mention-label {
          font-size: 12px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.11em; color: var(--muted);
          margin: var(--space-md) 0 var(--space-sm);
        }
        .mention-quote {
          margin: 0 0 var(--space-sm); padding: var(--space-md);
          background: var(--soft); border: 1px solid var(--line);
          border-radius: var(--radius-md); line-height: 1.6;
          word-break: break-word;
        }
        .mention-quote mark {
          background: none; color: var(--accent); font-weight: 700;
          text-decoration: underline; text-decoration-thickness: 2px;
          text-underline-offset: 3px;
        }
        .mention-sources { list-style: none; padding: 0; margin: 0 0 var(--space-sm); }
        .mention-sources li {
          padding: var(--space-xs) 0; font-size: 15px;
          overflow-wrap: anywhere;
        }
        .mention-sources a { color: var(--accent); font-weight: 600; }
        .mention-pending { padding-left: 1.2em; color: var(--muted); }
        .mention-cta {
          border-top: 1px solid var(--line);
          padding-top: var(--space-lg); margin-top: var(--space-md);
        }
        .mention-result .mention-cta h2 { margin-top: var(--space-sm); }
        .mention-cta p { line-height: 1.6; max-width: 640px; }
        .mention-cta a { color: var(--accent); }
        .mention-cta a.btn-primary { color: var(--paper); text-decoration: none; }
        .mention-cta-actions {
          display: flex; align-items: center; gap: var(--space-lg);
          flex-wrap: wrap; margin: var(--space-lg) 0;
        }
      `}</style>
    </div>
  );
}
