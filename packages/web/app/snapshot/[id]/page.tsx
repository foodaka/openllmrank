import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { HostedConfigSchema, type HostedConfig } from "@openllmrank/shared/config";
import { reportLinkSecret, verifyReportToken } from "@openllmrank/shared/report-token";
import { serviceClient, userClient } from "../../../lib/supabase-server";
import { loadReportData } from "../../../lib/report-data";
import { summarizeSnapshot, websiteDomain, type SnapshotSummary } from "../../../lib/snapshot";
import { AutoRefresh, TrackCta } from "../_components/snapshot-client";
import { SnapshotStyles } from "../_components/snapshot-styles";

// Result page for a free snapshot. Private by signed link (same HMAC token as
// report emails) or by the owner's session; never indexed.

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your AI visibility snapshot",
  robots: { index: false, follow: false },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ENGINE_NAMES: Record<string, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
  perplexity: "Perplexity",
  xai: "Grok",
};

type JobRow = {
  id: string;
  user_id: string;
  status: string;
  origin: string;
  config_jsonb: unknown;
  cli_run_id: string | null;
  created_at: string;
  email_to: string;
};

async function canView(job: JobRow, token: string | undefined): Promise<boolean> {
  const claims = verifyReportToken(token, reportLinkSecret());
  if (claims && claims.jobId === job.id) return true;
  try {
    const { data: { user } } = await (await userClient()).auth.getUser();
    return user?.id === job.user_id;
  } catch {
    return false;
  }
}

export default async function SnapshotResultPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await props.params;
  const { t } = await props.searchParams;
  if (!UUID_RE.test(id)) notFound();

  const supabase = serviceClient();
  const { data } = await supabase
    .from("jobs")
    .select("id,user_id,status,origin,config_jsonb,cli_run_id,created_at,email_to")
    .eq("id", id)
    .maybeSingle();
  const job = data as JobRow | null;
  if (!job || !(await canView(job, t))) {
    return (
      <article className="wrap check-hero">
        <span className="kicker">Snapshot</span>
        <h1>This link doesn&rsquo;t work.</h1>
        <p className="sub">
          It may have expired. <Link href="/snapshot">Run a new snapshot</Link>, or{" "}
          <Link href="/login">sign in</Link> to see your reports.
        </p>
        <SnapshotStyles />
      </article>
    );
  }
  if (job.origin !== "snapshot") {
    redirect(`/reports/${job.id}${t ? `?t=${encodeURIComponent(t)}` : ""}`);
  }

  const cfg = HostedConfigSchema.parse(job.config_jsonb);

  if (job.status === "paid" || job.status === "running") {
    return <Running cfg={cfg} startedAt={job.created_at} email={job.email_to} />;
  }
  if (job.status !== "completed" || !job.cli_run_id) {
    return (
      <article className="wrap check-hero">
        <span className="kicker">Snapshot</span>
        <h1>We couldn&rsquo;t finish this snapshot.</h1>
        <p className="sub">
          One of the AI engines didn&rsquo;t answer. We&rsquo;ve been notified and
          will email the result to {job.email_to} once it runs.
        </p>
        <SnapshotStyles />
      </article>
    );
  }

  const report = await loadReportData(supabase, {
    id: job.id,
    user_id: job.user_id,
    config_jsonb: job.config_jsonb,
    cli_run_id: job.cli_run_id,
  });
  const summary = summarizeSnapshot({
    rates: report.rates,
    brandName: report.brandName,
    competitorNames: report.competitorNames,
    promptOrder: cfg.prompts,
    providerOrder: cfg.providers.map((p) => p.id),
  });

  return <Result cfg={cfg} summary={summary} email={job.email_to} />;
}

function Running({ cfg, startedAt, email }: { cfg: HostedConfig; startedAt: string; email: string }) {
  return (
    <article className="wrap check-hero">
      <span className="kicker">Snapshot · {cfg.brand.website ? websiteDomain(cfg.brand.website) : cfg.brand.name}</span>
      <h1>Asking five AI engines about {cfg.brand.name}…</h1>
      <p className="sub">
        This usually takes two to four minutes. The page updates itself, and
        we&rsquo;ll email the link to {email} as well.
      </p>
      <p className="snapshot-progress">
        <span className="snapshot-dot" aria-hidden="true" />
        Running <AutoRefresh startedAt={startedAt} />
      </p>

      <h2>The questions we&rsquo;re asking</h2>
      <ol className="snapshot-questions">
        {cfg.prompts.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ol>
      <h2>Who we&rsquo;re comparing you with</h2>
      <p className="sub">
        {cfg.competitors.map((c) => c.name).join(", ")}. We picked these from
        your site and category; with tracking you choose your own.
      </p>
      <SnapshotStyles />
    </article>
  );
}

function Result({ cfg, summary, email }: { cfg: HostedConfig; summary: SnapshotSummary; email: string }) {
  const { you, topCompetitor, totalAnswers } = summary;
  const ctaProps = { brand: cfg.brand, competitors: cfg.competitors, prompts: cfg.prompts, email };
  const leading = summary.rank === 1 && you.mentions > 0;
  const enginesWithYou = summary.byProvider.filter((p) => p.mentions > 0).length;
  const [firstQuestion, ...lockedQuestions] = summary.questions;
  const maxRate = Math.max(...summary.leaderboard.map((s) => s.rate), 0.01);

  return (
    <article className="wrap snapshot-result">
      <span className="kicker">Free AI visibility snapshot · {cfg.brand.website ? websiteDomain(cfg.brand.website) : cfg.brand.name}</span>
      <h1>
        {you.mentions === 0
          ? `AI didn’t mention ${cfg.brand.name} in any of ${totalAnswers} answers.`
          : `${cfg.brand.name} came up in ${you.mentions} of ${totalAnswers} AI answers.`}
      </h1>
      <p className="sub">
        {topCompetitor && topCompetitor.mentions > you.mentions
          ? `${topCompetitor.name} came up in ${topCompetitor.mentions} of ${topCompetitor.answers}. `
          : leading
            ? "You lead this sample. Tracking shows whether that holds week to week. "
            : ""}
        {enginesWithYou} of {summary.byProvider.length} engines named you at least once.
      </p>

      <section className="snapshot-card">
        <h2>Who AI recommends</h2>
        <p className="muted snapshot-note">
          Share of {totalAnswers} answers ({cfg.prompts.length} questions × {cfg.providers.length} engines) that named each brand.
        </p>
        <ol className="snapshot-board">
          {summary.leaderboard.map((s) => (
            <li key={s.name} className={s.isYou ? "is-you" : undefined}>
              <span className="board-name">{s.name}{s.isYou ? " (you)" : ""}</span>
              <span className="board-bar" aria-hidden="true">
                <span style={{ width: `${Math.round((s.rate / maxRate) * 100)}%` }} />
              </span>
              <span className="board-count">{s.mentions}/{s.answers}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="snapshot-card">
        <h2>Engine by engine</h2>
        <ul className="snapshot-engines">
          {summary.byProvider.map((p) => (
            <li key={p.provider}>
              <span>{ENGINE_NAMES[p.provider] ?? p.provider}</span>
              <span className={p.mentions > 0 ? "engine-yes" : "engine-no"}>
                {p.answers === 0 ? "no answer" : p.mentions > 0 ? `named you in ${p.mentions} of ${p.answers}` : `didn’t name you (0 of ${p.answers})`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="snapshot-card">
        <h2>Question by question</h2>
        {firstQuestion ? <QuestionBlock q={firstQuestion} you={cfg.brand.name} /> : null}
        {lockedQuestions.map((q) => (
          <div key={q.promptText} className="snapshot-question">
            <p className="question-text">&ldquo;{q.promptText}&rdquo;</p>
            <Locked label="See who each engine recommended" />
          </div>
        ))}
      </section>

      <section className="snapshot-card">
        <h2>Sources AI cited, and what to fix</h2>
        <p className="muted snapshot-note">
          The pages each engine relied on, where your competitors get mentioned
          and you don&rsquo;t, and a prioritized action plan.
        </p>
        <Locked label="Unlock the sources and the action plan" tall />
      </section>

      <section className="snapshot-cta" id="track">
        <h2>See all of it, every week.</h2>
        <ul>
          <li>Every answer from all five engines, with the sources they cite</li>
          <li>Three samples per question, so one odd answer doesn&rsquo;t mislead you</li>
          <li>Your questions and your competitors, re-run weekly with a trend line</li>
          <li>A prioritized action plan; cancel any time</li>
        </ul>
        <TrackCta {...ctaProps} placement="result_footer" />
        <p className="muted snapshot-note">
          This snapshot used one sample per engine, so small numbers can swing.
          Want to see the method? <Link href="/methodology">How we measure</Link>.
        </p>
      </section>
      <SnapshotStyles />
    </article>
  );
}

function QuestionBlock({ q, you }: { q: SnapshotSummary["questions"][number]; you: string }) {
  return (
    <div className="snapshot-question">
      <p className="question-text">&ldquo;{q.promptText}&rdquo;</p>
      <ul className="snapshot-engines">
        {q.byProvider.map((p) => (
          <li key={p.provider}>
            <span>{ENGINE_NAMES[p.provider] ?? p.provider}</span>
            <span className={p.mentioned.includes(you) ? "engine-yes" : "engine-no"}>
              {!p.answered ? "no answer" : p.mentioned.length === 0 ? "named none of these brands" : p.mentioned.join(", ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Placeholder rows only: nothing real sits under the blur, so the locked
// data can't be read from the page source.
function Locked({ label, tall = false }: { label: string; tall?: boolean }) {
  const rows = tall ? 5 : 3;
  return (
    <div className="snapshot-locked">
      <div className="locked-fake" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="locked-row">
            <span style={{ width: `${30 + ((i * 17) % 40)}%` }} />
            <span style={{ width: `${18 + ((i * 11) % 22)}%` }} />
          </div>
        ))}
      </div>
      <div className="locked-over">
        <span className="locked-label">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          {label}
        </span>
        <a href="#track" className="locked-link">with tracking, $49/month</a>
      </div>
    </div>
  );
}
