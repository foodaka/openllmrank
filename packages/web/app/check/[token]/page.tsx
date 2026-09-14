import { CrawlReport } from "../_components/crawl-report";

// Report pages are private-by-URL (unguessable token) and noindexed —
// the /check tool page is the indexable asset (eng review decision 7A).
export const metadata = {
  title: "Crawlability report | openllmrank",
  robots: { index: false, follow: false },
};

export default async function CrawlReportPage(props: {
  params: Promise<{ token: string }> | { token: string };
}) {
  const { token } = await props.params;
  return (
    <article className="wrap">
      <CrawlReport token={token} />
    </article>
  );
}
