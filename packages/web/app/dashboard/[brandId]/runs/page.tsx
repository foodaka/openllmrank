import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getBrand,
  getMetrics,
  getRunHistory,
  longDate,
  pct,
} from "@/lib/dashboard-data";

// Run history. Shows origin per run, because "why did this run happen" is
// the first question a subscriber asks when they see a charge or a report
// they did not expect.

const ORIGIN_LABEL: Record<string, string> = {
  one_shot: "Purchase",
  scheduled: "Scheduled",
  manual: "Re-run",
};

export default async function RunsPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;

  const brand = await getBrand(brandId);
  if (!brand) notFound();

  const [jobs, metrics] = await Promise.all([
    getRunHistory(brandId),
    getMetrics(brandId),
  ]);

  const rateByJob = new Map(metrics.map((m) => [m.job_id, m.own_citation_rate]));

  return (
    <>
      <span className="kicker">{brand.name}</span>
      <h1 className="standfirst">Every run.</h1>

      <div className="runs-scroll">
        <table className="runs">
          <thead>
            <tr>
              <th>Date</th>
              <th>Trigger</th>
              <th>Rate</th>
              <th>Answers</th>
              <th>Report</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const rate = rateByJob.get(job.id);
              return (
                <tr key={job.id}>
                  <td>{longDate(job.succeeded_at ?? job.created_at)}</td>
                  <td>
                    <span className={`origin ${job.origin}`}>
                      {ORIGIN_LABEL[job.origin] ?? job.origin}
                    </span>
                  </td>
                  <td>{rate === undefined ? "—" : pct(rate)}</td>
                  <td>{job.succeeded_count ?? "—"}</td>
                  <td>
                    {job.status === "completed" ? (
                      <Link href={`/reports/${job.id}`}>Read</Link>
                    ) : job.status === "failed" ? (
                      job.origin === "one_shot"
                        ? "Failed"
                        : "Run failed, we are looking into it"
                    ) : (
                      "Running"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <hr className="rule" />
      <Link href={`/dashboard/${brand.id}`}>← Back to {brand.name}</Link>
    </>
  );
}
