import { userClient } from "../../../../lib/supabase-server";
import { suggestFromWebsite } from "../../../../lib/website-suggestions";
import { handleWizardSuggest } from "../../../../lib/wizard-suggest-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: Request) {
  return handleWizardSuggest(req, {
    userId: async () => {
      const client = await userClient();
      const { data: { user }, error } = await client.auth.getUser();
      return error ? null : user?.id ?? null;
    },
    configured: () => Boolean(process.env.OPENAI_API_KEY),
    suggest: suggestFromWebsite,
  });
}
