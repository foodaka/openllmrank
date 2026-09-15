import { userClient } from "@/lib/supabase-server";
import WizardBrandForm from "./brand-form";

export const dynamic = "force-dynamic";

export default async function WizardBrandPage() {
  let authenticated = false;
  try {
    const client = await userClient();
    const { data: { user }, error } = await client.auth.getUser();
    authenticated = !error && Boolean(user);
  } catch { /* Manual setup remains available without configured auth. */ }
  return <WizardBrandForm authenticated={authenticated} />;
}
