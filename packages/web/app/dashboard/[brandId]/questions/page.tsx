import { notFound } from "next/navigation";
import { HOSTED_CAPS, HostedConfigSchema } from "@openllmrank/shared/config";
import { getBrand, getSubscription } from "@/lib/dashboard-data";
import { userClient } from "@/lib/supabase-server";
import { MARKETS, researchPageData } from "@/lib/question-research";
import { QuestionResearch } from "../../_components/question-research";

// Question research: which buyer questions are worth tracking for this
// brand, ranked by Google and AI-assistant demand. Subscribers run
// searches; the page itself (recent searches, a saved search) is readable
// by the brand's owner either way.

export default async function QuestionResearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{ search?: string }>;
}) {
  const { brandId } = await params;
  const { search } = await searchParams;
  const brand = await getBrand(brandId);
  if (!brand || brand.archived_at) notFound();

  const supabase = await userClient();
  const [{ data: row }, subscription] = await Promise.all([
    supabase.from("brands").select("config_jsonb").eq("id", brandId).maybeSingle(),
    getSubscription(),
  ]);
  const config = HostedConfigSchema.safeParse(row?.config_jsonb);
  const tracked = config.success ? config.data.prompts : [];

  const pageData = await researchPageData(supabase, brandId, search);
  if (!pageData) notFound();
  const { recent, initial } = pageData;

  return (
    <>
      <span className="kicker">{brand.name}</span>
      <h1 className="standfirst">Which questions are worth tracking?</h1>
      <p className="sub">
        Enter a topic your buyers search for. We pull real search demand from
        Google and from AI assistants, group it into the questions people ask,
        and rank them. Add the ones that matter to your tracked questions.
      </p>

      <QuestionResearch
        brandId={brand.id}
        defaultTopic={brand.category ?? ""}
        markets={MARKETS.map((m) => ({ code: m.code, label: m.label }))}
        tracked={tracked}
        maxTracked={HOSTED_CAPS.max_prompts}
        canSearch={subscription?.status === "active"}
        hasConfig={config.success}
        recent={recent}
        initial={initial}
      />
    </>
  );
}
