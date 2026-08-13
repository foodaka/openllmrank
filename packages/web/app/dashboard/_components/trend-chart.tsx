import { pct, shortDate, type RunMetric } from "@/lib/dashboard-data";

// Server-rendered inline SVG. No chart library, on purpose:
//
//   1. DESIGN.md rejects the generic-dashboard aesthetic that every charting
//      default ships with (gridlines everywhere, tooltips, legends, gradient
//      fills). Getting a library to look editorial costs more code than this.
//   2. It ships zero client JavaScript. The page is a document.
//
// Draws own-brand citation rate over time, one point per run.

const W = 720;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 38 };

export function TrendChart({ metrics }: { metrics: RunMetric[] }) {
  if (metrics.length < 2) return null;

  const rates = metrics.map((m) => m.own_citation_rate);
  const rawMax = Math.max(...rates);

  // Round the ceiling up to the next 10% so the line never touches the top
  // edge and the axis labels land on readable numbers.
  const yMax = Math.min(1, Math.ceil((rawMax + 0.05) * 10) / 10);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const x = (i: number) =>
    PAD.left + (metrics.length === 1 ? plotW / 2 : (i / (metrics.length - 1)) * plotW);
  const y = (rate: number) => PAD.top + plotH - (rate / yMax) * plotH;

  const path = metrics
    .map((m, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(m.own_citation_rate).toFixed(1)}`)
    .join(" ");

  // Gridlines every 10%, capped so a low-rate brand does not get 10 lines.
  const step = yMax > 0.5 ? 0.2 : 0.1;
  const gridValues: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) gridValues.push(Number(v.toFixed(2)));

  // Label first, last, and roughly the middle. More than three crowds at 375px.
  const labelIdx = new Set([0, metrics.length - 1, Math.floor((metrics.length - 1) / 2)]);

  const lastIdx = metrics.length - 1;

  return (
    <svg
      className="trend"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Citation rate across ${metrics.length} runs, from ${pct(
        rates[0]!,
      )} on ${shortDate(metrics[0]!.computed_at)} to ${pct(rates[lastIdx]!)} on ${shortDate(
        metrics[lastIdx]!.computed_at,
      )}.`}
    >
      {gridValues.map((v) => (
        <g key={v}>
          <line className="trend-grid" x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} />
          <text className="trend-label" x={PAD.left - 8} y={y(v) + 4} textAnchor="end">
            {Math.round(v * 100)}%
          </text>
        </g>
      ))}

      <line
        className="trend-axis"
        x1={PAD.left}
        y1={PAD.top + plotH}
        x2={W - PAD.right}
        y2={PAD.top + plotH}
      />

      <path className="trend-line" d={path} />

      {metrics.map((m, i) => (
        <circle
          key={m.run_id}
          className={i === lastIdx ? "trend-dot-last" : "trend-dot"}
          cx={x(i)}
          cy={y(m.own_citation_rate)}
          r={i === lastIdx ? 5 : 3.5}
        />
      ))}

      {metrics.map((m, i) =>
        labelIdx.has(i) ? (
          <text
            key={`l-${m.run_id}`}
            className="trend-label"
            x={x(i)}
            y={H - 8}
            textAnchor={i === 0 ? "start" : i === lastIdx ? "end" : "middle"}
          >
            {shortDate(m.computed_at)}
          </text>
        ) : null,
      )}
    </svg>
  );
}
