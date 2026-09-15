import { pct } from "@/lib/dashboard-data";

// The rate bar from the CLI's HTML report, reused here per DESIGN.md's
// data-viz note: track on --soft, own brand fill in moss, competitors in
// terra cotta, numeric value right-aligned in tabular numerals.

type Row = { name: string; rate: number; own?: boolean };

export function RateBars({
  ownName,
  ownRate,
  competitors,
}: {
  ownName: string;
  ownRate: number;
  competitors: { name: string; rate: number }[];
}) {
  const rows: Row[] = [
    { name: ownName, rate: ownRate, own: true },
    ...competitors.map((c) => ({ name: c.name, rate: c.rate })),
  ].sort((a, b) => b.rate - a.rate);

  // Scale bars against the leader, not against 100%. At a 34% ceiling every
  // bar reads as a stub, and the comparison is the point of this chart.
  const max = Math.max(...rows.map((r) => r.rate), 0.01);

  return (
    <div className="rates">
      {rows.map((r) => (
        <div className="rate-row" key={r.name}>
          <span className={`rate-name${r.own ? " own" : ""}`}>{r.name}</span>
          <span className="rate-track">
            <span
              className={`rate-fill${r.own ? " own" : ""}`}
              style={{ width: `${Math.max(2, (r.rate / max) * 100)}%` }}
            />
          </span>
          <span className={`rate-value${r.own ? " own" : ""}`}>{pct(r.rate)}</span>
        </div>
      ))}
    </div>
  );
}
