import Link from "next/link";
import { notFound } from "next/navigation";
import {
  direction,
  elapsedPhrase,
  getBrand,
  getMetrics,
  longDate,
  pct,
} from "@/lib/dashboard-data";
import { buildSecondaryStandfirst } from "@/lib/trend-data";
import { TrendChart } from "../_components/trend-chart";
import { RateBars } from "../_components/rate-bars";

// Brand home (E4, D11). Composition, top to bottom:
//
//   kicker      WEEK OF AUGUST 11
//   standfirst  one serif sentence saying what changed
//   trend       inline SVG, own + leading competitor rate per run
//   rate bars   you vs each competitor, latest run
//   providers   per-provider breakdown
//   link        read the full report
//
// Three states, because a dashboard is mostly empty at the start:
//   0 runs -> queued state with a refresh hint
//   1 run  -> standfirst with no direction claim, no trend line
//   2+     -> the full composition above

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Gemini",
  perplexity: "Perplexity",
  xai: "xAI",
};

export default async function BrandDashboard({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;

  const brand = await getBrand(brandId);
  // RLS returns zero rows for another tenant's brand, so this is also the
  // cross-tenant response. 404, not 403 — do not confirm the id exists.
  if (!brand) notFound();

  const metrics = await getMetrics(brandId);
  const latest = metrics.at(-1);

  if (!latest) {
    return (
      <>
        <span className="kicker">{brand.name}</span>
        <h1 className="standfirst">Your first run is on its way.</h1>
        <p className="sub">
          We are querying five grounded AI providers with your questions. Reports
          take 10 to 15 minutes. This page updates itself.
        </p>
        <meta httpEquiv="refresh" content="30" />
      </>
    );
  }

  const previous = metrics.at(-2);
  const dir = previous
    ? direction(latest.own_citation_rate, previous.own_citation_rate)
    : null;
  const secondaryStandfirst = buildSecondaryStandfirst(metrics);

  const providerEntries = Object.entries(latest.per_provider_jsonb).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <>
      <span className="kicker">Week of {longDate(latest.computed_at)}</span>

      {/* The standfirst is generated from run_metrics, never hand-written, and
          never claims a direction it cannot support from two data points. */}
      <h1 className="standfirst">
        {brand.name} is cited in{" "}
        <span className="rate">{pct(latest.own_citation_rate)}</span> of your
        tracked answers
        {previous && dir !== "flat" ? (
          <>
            , <span className={dir!}>{dir === "up" ? "up" : "down"}</span> from{" "}
            <span className="rate">{pct(previous.own_citation_rate)}</span>{" "}
            {elapsedPhrase(previous.computed_at, latest.computed_at)}.
          </>
        ) : previous ? (
          <>, unchanged since {elapsedPhrase(previous.computed_at, latest.computed_at)}.</>
        ) : (
          <>.</>
        )}
      </h1>

      {secondaryStandfirst && (
        <p className="standfirst-secondary">{secondaryStandfirst}</p>
      )}

      <p className="sub">
        Across {latest.samples_total} sampled answers from five grounded
        providers.
        {brand.next_run_at && brand.cadence !== "paused"
          ? ` Next run ${longDate(brand.next_run_at)}.`
          : ""}
      </p>

      {metrics.length >= 2 ? (
        <TrendChart metrics={metrics} ownName={brand.name} />
      ) : (
        <p className="note">
          Your trend line starts with run two. One run is a snapshot; the point
          of tracking is the direction.
        </p>
      )}

      <hr className="rule" />

      <div className="section-head">
        <span className="kicker">Where you stand</span>
        <span className="brand-meta">
          Share of voice {pct(latest.share_of_voice)}
        </span>
      </div>
      <RateBars
        ownName={brand.name}
        ownRate={latest.own_citation_rate}
        competitors={latest.per_competitor_jsonb}
      />

      <hr className="rule" />

      <span className="kicker">By provider</span>
      <div className="providers" style={{ marginTop: "16px" }}>
        {providerEntries.map(([id, rate]) => (
          <div className="provider" key={id}>
            <span className="provider-name">{PROVIDER_LABELS[id] ?? id}</span>
            <span className="provider-rate">{pct(rate)}</span>
          </div>
        ))}
      </div>

      {/* Only claim a gap when one exists. A brand that out-cites every rival
          on every tracked question should be told that, not shown "you trail
          by 0 points". */}
      {latest.top_gap_prompt && (
        <>
          <hr className="rule" />
          <span className="kicker">
            {(latest.top_gap_score ?? 0) > 0.005 ? "Biggest gap" : "Where you lead"}
          </span>
          <h2 className="editorial-close">
            {(latest.top_gap_score ?? 0) > 0.005
              ? "Your widest gap of the run, and the one worth a page."
              : "You lead this run."}
          </h2>
          <p className="sub editorial-detail">
            {(latest.top_gap_score ?? 0) > 0.005 ? (
              <>
                &ldquo;{latest.top_gap_prompt}&rdquo; — you trail the leading
                competitor by {Math.round((latest.top_gap_score ?? 0) * 100)} points
                on this question.
              </>
            ) : (
              "You out-cite every tracked competitor on all of your questions this run."
            )}
          </p>
        </>
      )}

      <hr className="rule" />

      <Link href={`/reports/${latest.job_id}`}>
        Read the full {longDate(latest.computed_at)} report →
      </Link>
      {"  ·  "}
      <Link href={`/dashboard/${brand.id}/runs`}>
        All {metrics.length} run{metrics.length === 1 ? "" : "s"}
      </Link>
    </>
  );
}
