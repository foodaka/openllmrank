import { MentionResult } from "../_components/mention-result";

// Result pages are private-by-URL (unguessable token) and noindexed; the
// tool page is the indexable asset (same rule as /check/[token]).
export const metadata = {
  title: "AI visibility check | openllmrank",
  robots: { index: false, follow: false },
};

export default async function MentionResultPage(props: {
  params: Promise<{ token: string }> | { token: string };
}) {
  const { token } = await props.params;
  return (
    <article className="wrap">
      <MentionResult token={token} />
    </article>
  );
}
