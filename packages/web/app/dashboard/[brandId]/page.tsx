import Link from "next/link";
import { notFound } from "next/navigation";
import {
  direction,
  elapsedPhrase,
  getBrand,
  getMetrics,
  getRunHistory,
  getSubscription,
  longDate,
  pct,
} from "@/lib/dashboard-data";
import { getRerunQuota } from "@/lib/rerun-quota";
import { userClient } from "@/lib/supabase-server";
import { buildSecondaryStandfirst } from "@/lib/trend-data";
import { TrendChart } from "../_components/trend-chart";
import { RateBars } from "../_components/rate-bars";
import { RerunControl } from "../_components/rerun-control";
import { SubscriptionNotice } from "../_components/subscription-notice";

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

const RERUN_MESSAGES: Record<string, string> = {
  quota: "You have used this period's manual re-runs. The schedule continues as planned.",
  in_flight: "A run is already in progress. Results land in about fifteen minutes.",
  no_subscription: "Manual re-runs need an active subscription.",
  no_config: "This brand has no tracking configuration yet. Add one in settings first.",
  not_found: "That brand could not be found.",
};

export default async function BrandDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{ queued?: string; rerun?: string }>;
}) {
  const { brandId } = await params;
  const query = await searchParams;

  const brand = await getBrand(brandId);
  // RLS returns zero rows for another tenant's brand, so this is also the
  // cross-tenant response. 404, not 403 — do not confirm the id exists.
  if (!brand) notFound();

  const [metrics, history, subscription] = await Promise.all([
    getMetrics(brandId),
    getRunHistory(brandId),
    getSubscription(),
  ]);
  const latest = metrics.at(-1);
  const inFlight = history.some((job) => job.status === "paid" || job.status === "running");
  // First-run states, because the page a customer lands on after paying must
  // never say "nothing is happening" while something is:
  //   queued/running  -> on its way (page refreshes)
  //   due within 2min -> starting (the scheduler ticks every minute)
  //   last job failed -> we know, we retry, nothing to do on their end
  const dueSoon =
    !inFlight &&
    brand.cadence !== "paused" &&
    brand.next_run_at !== null &&
    new Date(brand.next_run_at).getTime() <= Date.now() + 2 * 60_000;
  const latestJob = history[0];
  const lastFailed = !inFlight && latestJob?.status === "failed";
  const providerCount = latest
    ? Object.keys(latest.per_provider_jsonb).length
    : null;
  const providerPhrase = providerCount
    ? `${providerCount} grounded provider${providerCount === 1 ? "" : "s"}`
    : "grounded AI providers";

  const quota =
    subscription?.status === "active"
      ? await getRerunQuota(await userClient(), subscription.current_period_end)
      : null;

  const flashes = (
    <>
      {query.queued === "1" && (
        <p className="note" role="status">
          Re-run queued. Results land in about fifteen minutes; this page updates
          itself.
        </p>
      )}
      {query.rerun && RERUN_MESSAGES[query.rerun] && (
        <p className="note" role="alert">{RERUN_MESSAGES[query.rerun]}</p>
      )}
      <SubscriptionNotice subscription={subscription} brandName={brand.name} />
    </>
  );

  const settingsLink = (
    <p className="brand-tools">
      <Link href={`/dashboard/${brand.id}/settings`}>Brand settings</Link>
    </p>
  );

  if (!latest) {
    const headline = inFlight || dueSoon
      ? "Your first run is on its way."
      : lastFailed
        ? "Your first run hit a problem on our side."
        : "No runs yet.";
    const body = inFlight
      ? "We are querying five grounded AI providers with your questions right now. Reports take 10 to 15 minutes and land in your inbox; this page updates itself."
      : dueSoon
        ? "It starts within the next minute. Reports take 10 to 15 minutes and land in your inbox; this page updates itself."
        : lastFailed
          ? `A provider on our side failed during the run${brand.next_run_at ? `, and we will retry automatically at ${longDate(brand.next_run_at)}` : ""}. You have not been charged for it and there is nothing to do on your end; reply to your receipt email if you want a hand.`
          : subscription?.status === "active"
            ? "The next scheduled run will start shortly. You can also start one now."
            : "Runs start when a subscription is active.";
    return (
      <>
        <span className="kicker">{brand.name}</span>
        <h1 className="standfirst">{headline}</h1>
        <p className="sub">{body}</p>
        {flashes}
        {quota && !dueSoon && <RerunControl brandId={brand.id} quota={quota} inFlight={inFlight} />}
        {settingsLink}
        {(inFlight || dueSoon) && <meta httpEquiv="refresh" content="30" />}
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
        Across {latest.samples_total} sampled answers from {providerPhrase}.
        {brand.next_run_at && brand.cadence !== "paused"
          ? ` Next run ${longDate(brand.next_run_at)}.`
          : ""}
      </p>

      {flashes}

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
      <div className="providers">
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

      <p className="brand-footer-links">
        <Link href={`/reports/${latest.job_id}`}>
          Read the full {longDate(latest.computed_at)} report →
        </Link>
        {"  ·  "}
        <Link href={`/dashboard/${brand.id}/runs`}>
          All {metrics.length} run{metrics.length === 1 ? "" : "s"}
        </Link>
      </p>
      {quota && <RerunControl brandId={brand.id} quota={quota} inFlight={inFlight} />}
      {settingsLink}
    </>
  );
}
