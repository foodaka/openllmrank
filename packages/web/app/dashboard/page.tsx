import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getBrands,
  getLatestMetricsByBrand,
  getSubscription,
  direction,
  longDate,
  pct,
} from "@/lib/dashboard-data";

// Brand list (E5). With exactly one brand this redirects straight to it —
// a list of one is navigation for its own sake.

export default async function DashboardIndex() {
  const [brands, metricsByBrand, subscription] = await Promise.all([
    getBrands(),
    getLatestMetricsByBrand(),
    getSubscription(),
  ]);

  if (brands.length === 0) {
    return (
      <>
        <span className="kicker">Dashboard</span>
        <h1 className="standfirst">Track your first brand.</h1>
        <p className="sub">
          Tell us your brand, who you compete with, and the questions your buyers
          ask. We query five grounded AI providers and show you where you appear.
        </p>
        <Link href="/dashboard/brands/new" className="btn-primary">
          Add a brand
        </Link>
      </>
    );
  }

  if (brands.length === 1) redirect(`/dashboard/${brands[0]!.id}`);

  const throttled = brands.length > 2 && brands.every((b) => b.cadence === "monthly");

  return (
    <>
      <span className="kicker">Dashboard</span>
      <h1 className="standfirst">
        You are tracking {brands.length} brands.
      </h1>

      <div className="brand-list">
        {brands.map((b) => {
          const series = metricsByBrand.get(b.id) ?? [];
          const latest = series.at(-1);
          const prev = series.at(-2);
          const dir = latest && prev
            ? direction(latest.own_citation_rate, prev.own_citation_rate)
            : null;
          const delta =
            latest && prev
              ? (latest.own_citation_rate - prev.own_citation_rate) * 100
              : null;

          return (
            <div className="brand-row" key={b.id}>
              <div>
                <Link href={`/dashboard/${b.id}`} className="brand-name">
                  {b.name}
                </Link>
                <div className="brand-meta">
                  {series.length === 0
                    ? "First run queued"
                    : `${series.length} run${series.length === 1 ? "" : "s"}`}
                  {b.next_run_at && b.cadence !== "paused"
                    ? ` · next ${longDate(b.next_run_at)}`
                    : b.cadence === "paused"
                      ? " · paused"
                      : ""}
                </div>
              </div>
              <div className="brand-rate">
                {latest ? pct(latest.own_citation_rate) : "—"}
              </div>
              <div className={`delta ${dir ?? "flat"}`}>
                {delta === null
                  ? ""
                  : dir === "flat"
                    ? "no change"
                    : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pts`}
              </div>
            </div>
          );
        })}
      </div>

      {throttled && (
        <p className="note">
          You are tracking more than two brands, so runs are scheduled monthly
          rather than weekly. Cadence returns to weekly at two brands or fewer.
        </p>
      )}

      {subscription?.status === "past_due" && (
        <p className="note">
          Your last payment did not go through, so scheduled runs are paused.
          Everything you have already run stays readable.{" "}
          <Link href="/dashboard/billing">Update payment</Link>
        </p>
      )}

      <hr className="rule" />
      <Link href="/dashboard/brands/new" className="btn-primary">
        Add a brand
      </Link>
    </>
  );
}
