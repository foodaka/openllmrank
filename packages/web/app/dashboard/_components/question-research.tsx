"use client";

// Question research UI: search a topic, see buyer questions ranked by
// demand, "Track" the ones worth measuring. Server contract lives in
// app/api/brands/[brandId]/questions and lib/question-research.ts.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RecentSearch, ResearchOutcome, ResearchQuestion } from "../../../lib/question-research";

type Props = {
  brandId: string;
  defaultTopic: string;
  markets: { code: number; label: string }[];
  tracked: string[];
  maxTracked: number;
  canSearch: boolean;
  hasConfig: boolean;
  recent: RecentSearch[];
  initial: ResearchOutcome | null;
};

const fmt = new Intl.NumberFormat("en-US");

function num(value: number | null): string {
  return value === null ? "–" : fmt.format(value);
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const w = 72;
  const h = 20;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="qr-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="12-month Google search trend" role="img">
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function QuestionResearch(props: Props) {
  const router = useRouter();
  const [topic, setTopic] = useState(props.initial?.results.topic ?? props.defaultTopic);
  const [market, setMarket] = useState(props.initial?.results.location_code ?? props.markets[0]!.code);
  const [outcome, setOutcome] = useState<ResearchOutcome | null>(props.initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracked, setTracked] = useState<string[]>(props.tracked);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const isTracked = (q: string) => tracked.some((t) => t.trim().toLowerCase() === q.trim().toLowerCase());
  const full = tracked.length >= props.maxTracked;

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/brands/${props.brandId}/questions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic, location_code: market }),
      });
      const body = (await res.json()) as ResearchOutcome & { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Try again.");
        return;
      }
      setOutcome(body);
      router.replace(`/dashboard/${props.brandId}/questions?search=${body.id}`, { scroll: false });
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function track(q: ResearchQuestion) {
    if (pending) return;
    setPending(q.question);
    setTrackError(null);
    try {
      const res = await fetch(`/api/brands/${props.brandId}/prompts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q.question }),
      });
      const body = (await res.json()) as { prompts?: string[]; error?: string };
      if (!res.ok || !body.prompts) {
        setTrackError(body.error ?? "Couldn't add that question. Try again.");
        return;
      }
      setTracked(body.prompts);
    } catch {
      setTrackError("Network error. Try again.");
    } finally {
      setPending(null);
    }
  }

  const results = outcome?.results;

  return (
    <div className="qr">
      <form className="qr-form" onSubmit={search}>
        <div className="field qr-topic">
          <label htmlFor="qr-topic">Topic</label>
          <input
            id="qr-topic"
            type="text"
            placeholder="corporate step challenge app"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={80}
            disabled={busy}
            required
          />
        </div>
        <div className="field qr-market">
          <label htmlFor="qr-market">Market</label>
          <select id="qr-market" value={market} onChange={(e) => setMarket(Number(e.target.value))} disabled={busy}>
            {props.markets.map((m) => (
              <option key={m.code} value={m.code}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary qr-submit" type="submit" disabled={busy || !props.canSearch || topic.trim().length < 2}>
          {busy ? "Researching…" : "Find questions"}
        </button>
      </form>

      {!props.canSearch ? (
        <p className="note">
          Question research is part of the tracking plan.{" "}
          <a href="/dashboard/billing">Start tracking</a> to run searches.
        </p>
      ) : null}
      {busy ? <p className="note" role="status">Pulling Google and AI search demand and grouping it into questions. This takes 10–30 seconds.</p> : null}
      {error ? <p className="note" role="alert">{error}</p> : null}

      {props.recent.length > 0 && !results ? (
        <section className="qr-recent">
          <h2 className="section-head">Recent searches</h2>
          <ul>
            {props.recent.map((r) => (
              <li key={r.id}>
                <a href={`/dashboard/${props.brandId}/questions?search=${r.id}`}>{r.topic}</a>
                <span className="muted"> &middot; {props.markets.find((m) => m.code === r.location_code)?.label ?? r.location_code} &middot; {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {results ? (
        <section className="qr-results" aria-live="polite">
          <div className="qr-results-head">
            <h2 className="section-head">
              {results.questions.length > 0
                ? `${results.questions.length} questions for “${results.topic}”`
                : `Keywords for “${results.topic}”`}
            </h2>
            <p className="qr-tracked-count">
              {tracked.length} of {props.maxTracked} questions tracked
            </p>
          </div>
          {results.notes.map((n) => (
            <p key={n} className="note">{n}</p>
          ))}
          {!props.hasConfig ? (
            <p className="note">Save this brand once in <a href={`/dashboard/${props.brandId}/settings`}>Brand settings</a> before adding questions.</p>
          ) : null}
          {trackError ? <p className="note" role="alert">{trackError}</p> : null}

          <ol className="qr-list">
            {results.questions.map((q) => {
              const on = isTracked(q.question);
              return (
                <li key={q.question} className="qr-row">
                  <div className="qr-main">
                    <p className="qr-question">{q.question}</p>
                    <p className="qr-meta">
                      <span className="qr-num">{num(q.volume)}</span> Google/mo
                      <span className="qr-sep">&middot;</span>
                      <span className="qr-num">{num(q.ai_volume)}</span> AI/mo
                      {q.intent ? (
                        <>
                          <span className="qr-sep">&middot;</span>
                          <span className="origin">{q.intent}</span>
                        </>
                      ) : null}
                      <Sparkline values={q.trend} />
                    </p>
                    <p className="qr-keywords">
                      From: {q.keywords.slice(0, 4).join(", ")}
                      {q.keywords.length > 4 ? ` +${q.keywords.length - 4} more` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={on ? "btn-text qr-track on" : "btn-text qr-track"}
                    onClick={() => track(q)}
                    disabled={on || pending !== null || (full && !on) || !props.hasConfig}
                    title={full && !on ? `You already track ${props.maxTracked} questions` : undefined}
                  >
                    {on ? "Tracked" : pending === q.question ? "Adding…" : "Track"}
                  </button>
                </li>
              );
            })}
          </ol>

          {results.keywords.length > 0 ? (
            <details className="qr-keyword-table">
              <summary>All keywords ({results.keywords.length})</summary>
              <div className="qr-scroll">
                <table className="runs">
                  <thead>
                    <tr>
                      <th>Keyword</th>
                      <th>Google/mo</th>
                      <th>AI/mo</th>
                      <th>Difficulty</th>
                      <th>Intent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.keywords.map((k) => (
                      <tr key={k.keyword}>
                        <td>{k.keyword}</td>
                        <td>{num(k.volume)}</td>
                        <td>{num(k.ai_volume)}</td>
                        <td>{num(k.difficulty)}</td>
                        <td>{k.intent ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}

          <p className="qr-footnote muted">
            Demand is monthly searches for the keywords behind each question:
            Google search volume, and DataForSEO&rsquo;s estimate of how often
            the keyword comes up in AI assistants. Google reports one shared
            figure for close variants of a phrase, so several questions can
            show the same number. Nobody measures exact questions, so treat
            these as relative, not literal.
            {outcome?.cached ? " Figures are from a search in the last 7 days." : ""}
          </p>
        </section>
      ) : null}
    </div>
  );
}
