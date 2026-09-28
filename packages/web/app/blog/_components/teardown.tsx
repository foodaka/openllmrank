// Building blocks for teardown posts: data posts rendered from one CLI run
// (content/teardowns/<slug>.json, written by scripts/teardown-data.ts).
// Every number on the page comes from that file, so a re-run regenerates the
// post's figures without retyping. Styling lives with the rest of the blog's
// article CSS in app/blog/layout.tsx (.td-* classes).

import Link from "next/link";
import {
  engineLabel,
  sharePct,
  type TeardownBrandCount,
  type TeardownData,
} from "../../../lib/teardown";

export function ShareChart({
  title,
  unit,
  rows,
  total,
  highlight,
  notes = {},
}: {
  title: string;
  unit: string;
  rows: TeardownBrandCount[];
  total: number;
  highlight?: string | null;
  notes?: Record<string, string>;
}) {
  return (
    <figure className="td-chart">
      <figcaption>
        <span className="td-chart-title">{title}</span>
        <span className="td-chart-unit">{unit}</span>
      </figcaption>
      <ol className="td-bars">
        {rows.map((r) => {
          const pct = sharePct(r.answers, total);
          const note = notes[r.name];
          return (
            <li key={r.name} className={r.name === highlight ? "is-highlight" : undefined}>
              <span className="td-bar-name">
                {r.name}
                {note && <span className="td-bar-note">{note}</span>}
              </span>
              <span className="td-bar-track" aria-hidden>
                <span className="td-bar-fill" style={{ width: `${Math.max(pct, 1)}%` }} />
              </span>
              <span className="td-bar-value">
                {pct}%<span className="td-bar-count"> {r.answers}/{total}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

export function EngineSplit({ data }: { data: TeardownData }) {
  const highlight = data.highlight;
  return (
    <div className="table-scroll">
      <table className="td-table">
        <thead>
          <tr>
            <th>Engine</th>
            <th>Most named</th>
            <th>Runner-up</th>
            {highlight && <th>{highlight}</th>}
          </tr>
        </thead>
        <tbody>
          {data.by_engine.map((e) => {
            const [first, second] = e.brands;
            const mine = highlight ? e.brands.find((b) => b.name === highlight) : undefined;
            return (
              <tr key={e.provider}>
                <td>
                  <strong>{engineLabel(e.provider)}</strong>
                  <span className="td-sub">{e.model}</span>
                </td>
                <td>{first && `${first.name} (${first.answers}/${e.answers})`}</td>
                <td>{second && `${second.name} (${second.answers}/${e.answers})`}</td>
                {highlight && <td className="td-num">{mine?.answers ?? 0}/{e.answers}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CitedSources({ data, limit = 8 }: { data: TeardownData; limit?: number }) {
  return (
    <div className="table-scroll">
      <table className="td-table">
        <thead>
          <tr>
            <th>Site the engines cited</th>
            <th className="td-num">Answers citing it</th>
            <th className="td-num">Times cited</th>
          </tr>
        </thead>
        <tbody>
          {data.domains.slice(0, limit).map((d) => (
            <tr key={d.domain}>
              <td>{d.domain}</td>
              <td className="td-num">
                {d.answers}/{data.run.answers}
              </td>
              <td className="td-num">{d.citations}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EngineQuote({ quote }: { quote: TeardownData["quotes"][number] }) {
  return (
    <figure className="td-quote">
      <blockquote>{quote.text}</blockquote>
      <figcaption>
        {engineLabel(quote.provider)} ({quote.model}), asked &ldquo;{quote.question}&rdquo;
      </figcaption>
    </figure>
  );
}

export function MethodBox({ data }: { data: TeardownData }) {
  const { run } = data;
  return (
    <aside className="td-method">
      <span className="kicker">Method</span>
      <ul>
        <li>
          <strong>Run:</strong> {run.date}, {run.questions.length} counted questions &times; {run.engines.length} engines
          &times; {run.samples} samples = {run.answers} answers, ${run.cost_usd.toFixed(2)} in API fees.
        </li>
        <li>
          <strong>Engines:</strong>{" "}
          {run.engines.map((e) => `${engineLabel(e.provider)} (${e.model})`).join(", ")}. Grounded
          (web-search) provider APIs, not the consumer apps.
        </li>
        <li>
          <strong>Counting:</strong> a brand counts when the answer text names it or its domain. A
          brand that only appears in a cited link does not count.
        </li>
        <li>
          <strong>Questions:</strong>
          <ol>
            {run.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </li>
        {run.excluded_questions.length > 0 && (
          <li>
            <strong>Run but not counted:</strong>{" "}
            {run.excluded_questions.map((q) => `“${q}”`).join(", ")}. These name brands
            themselves, which inflates those brands, so they&rsquo;re left out of every figure
            above. Their answers are in the full report.
          </li>
        )}
        <li>
          <strong>Receipts:</strong> every answer, verbatim, in the{" "}
          <a href={`/teardowns/${data.slug}/report.html`}>full report for this run</a>. Produced with the
          open-source <a href="https://github.com/foodaka/openllmrank">openllmrank CLI</a>.
        </li>
      </ul>
    </aside>
  );
}

export function TeardownCta({ category }: { category: string }) {
  return (
    <div className="post-cta">
      <span className="kicker">Your category</span>
      <h3>Track what AI recommends in your category, every week</h3>
      <p>
        This teardown is one snapshot of {category}. AI answers differ by engine and shift as new
        pages get published. openllmrank re-asks your buyers&rsquo; questions across all five
        engines every week, with every answer and source, so you see when you or a competitor moves.
      </p>
      <Link href="/wizard/brand" className="btn-primary">
        Start tracking &mdash; $49/month
      </Link>
      <p className="td-cta-alt">Prefer a single snapshot? A one-time report is $79.</p>
    </div>
  );
}
