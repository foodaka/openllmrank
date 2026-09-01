import { longDate, pct, shortDate, type RunMetric } from "@/lib/dashboard-data";
import { buildTrendSeries, type TrendSeries } from "@/lib/trend-data";

// Server-rendered inline SVG. The chart is deliberately a document: no chart
// library, no client JavaScript, and no generic dashboard controls.

const W = 720;
const H = 300;
const PAD = { top: 74, right: 126, bottom: 38, left: 18 };

function pathFor(
  values: (number | null)[],
  x: (index: number) => number,
  y: (rate: number) => number,
): string {
  let path = "";
  let hasPrevious = false;

  values.forEach((value, index) => {
    if (value === null) {
      hasPrevious = false;
      return;
    }
    path += `${hasPrevious ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)} `;
    hasPrevious = true;
  });

  return path.trim();
}

function wrapStory(text: string, maxCharacters = 66): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > maxCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function ratioPhrase(competitorRate: number, ownRate: number): string {
  if (ownRate <= 0) return "far more often";
  const ratio = competitorRate / ownRate;
  if (ratio >= 2.75) return "three times";
  if (ratio >= 1.75) return "twice";
  if (ratio >= 1.25) return `${Math.round(ratio * 10) / 10} times`;
  return "more often";
}

function storyFor(ownName: string, series: TrendSeries): string {
  if (!series.competitorName) {
    return "Your citation rate is now tracked run by run, so the next result can show what changed.";
  }

  if (series.crossoverIndex !== null) {
    const crossover = series.points[series.crossoverIndex]!;
    const before = series.points[series.crossoverIndex - 1]!;
    return `${series.competitorName} was cited ${ratioPhrase(
      before.competitorRate!,
      before.ownRate,
    )} as often as ${ownName} earlier in this view. On ${longDate(
      crossover.computedAt,
    )} you passed it for the first time.`;
  }

  const latest = series.points.at(-1)!;
  if (
    latest.competitorRate !== null &&
    latest.ownRate > latest.competitorRate
  ) {
    return `${ownName} has led ${series.competitorName} throughout this view.`;
  }

  return `${series.competitorName} remains ahead in this view. The latest run is ${pct(
    latest.competitorRate ?? 0,
  )} to ${pct(latest.ownRate)}.`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function endLabelY(
  ownY: number,
  competitorY: number | null,
  ownIsUpper: boolean,
  plotTop: number,
  baseline: number,
): number {
  if (competitorY === null || Math.abs(ownY - competitorY) >= 28) return ownY;

  const upper = Math.min(ownY, competitorY) - 12;
  const lower = Math.max(ownY, competitorY) + 24;
  return clamp(ownIsUpper ? upper : lower, plotTop + 20, baseline - 6);
}

export function TrendChart({
  metrics,
  ownName,
}: {
  metrics: RunMetric[];
  ownName: string;
}) {
  if (metrics.length < 2) return null;

  const series = buildTrendSeries(metrics);
  const rates = series.points.flatMap((point) =>
    point.competitorRate === null
      ? [point.ownRate]
      : [point.ownRate, point.competitorRate],
  );
  const rawMax = Math.max(...rates);
  const yMax = Math.min(1, Math.max(0.1, Math.ceil((rawMax + 0.05) * 10) / 10));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const baseline = PAD.top + plotH;
  const lastIndex = series.points.length - 1;

  const x = (index: number) => PAD.left + (index / lastIndex) * plotW;
  const y = (rate: number) => PAD.top + plotH - (rate / yMax) * plotH;

  const ownPath = pathFor(
    series.points.map((point) => point.ownRate),
    x,
    y,
  );
  const competitorPath = pathFor(
    series.points.map((point) => point.competitorRate),
    x,
    y,
  );
  const ownAreaPath = `${ownPath} L${x(lastIndex).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z`;
  const storyLines = wrapStory(storyFor(ownName, series));
  const labelIndices = new Set([0, lastIndex, Math.floor(lastIndex / 2)]);
  const latest = series.points[lastIndex]!;
  const ownEndY = y(latest.ownRate);
  const competitorEndY =
    latest.competitorRate === null ? null : y(latest.competitorRate);
  const ownLabelY = endLabelY(
    ownEndY,
    competitorEndY,
    competitorEndY === null || ownEndY <= competitorEndY,
    PAD.top,
    baseline,
  );
  const competitorLabelY =
    competitorEndY === null
      ? null
      : endLabelY(
          competitorEndY,
          ownEndY,
          competitorEndY <= ownEndY,
          PAD.top,
          baseline,
        );
  const storyLeaderY = 24 + (storyLines.length - 1) * 20 + 10;
  const storyLeaderX = Math.min(W - PAD.right - 80, PAD.left + 330);

  return (
    <svg
      className="trend"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Citation rate across ${metrics.length} runs for ${ownName}, from ${pct(
        series.points[0]!.ownRate,
      )} on ${shortDate(metrics[0]!.computed_at)} to ${pct(
        latest.ownRate,
      )} on ${shortDate(metrics[lastIndex]!.computed_at)}${
        series.competitorName
          ? `, compared with ${series.competitorName}`
          : ""
      }.`}
    >
      <title>{`${ownName} citation rate over time`}</title>
      <desc>{storyFor(ownName, series)}</desc>

      <text className="trend-story" x={PAD.left} y={24}>
        {storyLines.map((line, index) => (
          <tspan key={`${line}-${index}`} x={PAD.left} dy={index === 0 ? 0 : 20}>
            {line}
          </tspan>
        ))}
      </text>

      {series.points.map((point, index) =>
        point.origin === "manual" ? (
          <g key={`event-${point.computedAt}`}>
            <line
              className="trend-event-line"
              x1={x(index)}
              y1={PAD.top}
              x2={x(index)}
              y2={baseline}
            />
            <text
              className="trend-event-label"
              x={x(index) > W - PAD.right - 150 ? x(index) - 6 : x(index) + 6}
              y={PAD.top - 10}
              textAnchor={x(index) > W - PAD.right - 150 ? "end" : "start"}
            >
              {`Manual re-run, ${longDate(point.computedAt)}`}
            </text>
          </g>
        ) : null,
      )}

      <path className="trend-area" d={ownAreaPath} />
      <line
        className="trend-axis"
        x1={PAD.left}
        y1={baseline}
        x2={W - PAD.right}
        y2={baseline}
      />

      {series.crossoverIndex !== null && (
        <>
          <line
            className="trend-story-leader"
            x1={storyLeaderX}
            y1={storyLeaderY}
            x2={x(series.crossoverIndex)}
            y2={y(series.points[series.crossoverIndex]!.ownRate)}
          />
          <circle
            className="trend-crossover-dot"
            cx={x(series.crossoverIndex)}
            cy={y(series.points[series.crossoverIndex]!.ownRate)}
            r={5}
          />
        </>
      )}

      <path className="trend-line" d={ownPath} />
      {competitorPath && <path className="trend-competitor-line" d={competitorPath} />}

      {series.points.map((point, index) => (
        <g key={`point-${point.computedAt}`}>
          <circle
            className={index === lastIndex ? "trend-dot-last" : "trend-dot"}
            cx={x(index)}
            cy={y(point.ownRate)}
            r={index === lastIndex ? 5 : 3.5}
          />
          {point.competitorRate !== null && (
            <circle
              className={
                index === lastIndex
                  ? "trend-competitor-dot-last"
                  : "trend-competitor-dot"
              }
              cx={x(index)}
              cy={y(point.competitorRate)}
              r={index === lastIndex ? 4.5 : 3}
            />
          )}
        </g>
      ))}

      <text
        className="trend-end-name own"
        x={W - 8}
        y={ownLabelY - 17}
        textAnchor="end"
      >
        {ownName}
      </text>
      <text
        className="trend-end-value own"
        x={W - 8}
        y={ownLabelY + 3}
        textAnchor="end"
      >
        {pct(latest.ownRate)}
      </text>

      {latest.competitorRate !== null && competitorLabelY !== null && (
        <>
          <text
            className="trend-end-name competitor"
            x={W - 8}
            y={competitorLabelY - 17}
            textAnchor="end"
          >
            {series.competitorName}
          </text>
          <text
            className="trend-end-value competitor"
            x={W - 8}
            y={competitorLabelY + 3}
            textAnchor="end"
          >
            {pct(latest.competitorRate)}
          </text>
        </>
      )}

      {metrics.map((metric, index) =>
        labelIndices.has(index) ? (
          <text
            key={`date-${metric.run_id}`}
            className="trend-label"
            x={x(index)}
            y={H - 10}
            textAnchor={index === 0 ? "start" : index === lastIndex ? "end" : "middle"}
          >
            {shortDate(metric.computed_at)}
          </text>
        ) : null,
      )}
    </svg>
  );
}
