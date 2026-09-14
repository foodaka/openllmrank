import Link from "next/link";
import { notFound } from "next/navigation";
import { HostedConfigSchema, type HostedConfig } from "@openllmrank/shared/config";
import { getBrand, getRunHistory } from "@/lib/dashboard-data";
import { userClient } from "@/lib/supabase-server";
import { brandFormFromConfig } from "@/lib/brand-writes";
import { BrandForm } from "../../_components/brand-form";
import { archiveBrandAction, updateBrandAction } from "../../brands/actions";

// Brand settings (E5): edit the tracking config, or archive the brand.
// Pre-epic brands have no config_jsonb; their latest job carries the config
// that produced the report, so the form prefills from that.

const ERRORS: Record<string, string> = {
  not_found: "That brand could not be found.",
  db: "Something went wrong saving. Try again.",
};

export default async function BrandSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { brandId } = await params;
  const { error } = await searchParams;
  const brand = await getBrand(brandId);
  if (!brand || brand.archived_at) notFound();

  const supabase = await userClient();
  const { data: row } = await supabase
    .from("brands")
    .select("config_jsonb")
    .eq("id", brandId)
    .maybeSingle();
  let config: HostedConfig | null = null;
  const own = HostedConfigSchema.safeParse(row?.config_jsonb);
  if (own.success) {
    config = own.data;
  } else {
    const history = await getRunHistory(brandId);
    const latest = history[0];
    if (latest) {
      const { data: job } = await supabase
        .from("jobs")
        .select("config_jsonb")
        .eq("id", latest.id)
        .maybeSingle();
      const fromJob = HostedConfigSchema.safeParse(job?.config_jsonb);
      if (fromJob.success) config = fromJob.data;
    }
  }

  const update = updateBrandAction.bind(null, brandId);

  return (
    <>
      <span className="kicker">{brand.name}</span>
      <h1 className="standfirst">Brand settings.</h1>
      <p className="sub">
        Changes apply from the next run. Keep the questions stable if you want
        the trend to stay comparable.
      </p>
      {error && ERRORS[error] && <p className="note" role="alert">{ERRORS[error]}</p>}
      {!config && (
        <p className="note">
          This brand has no tracking configuration yet. Fill it in below to
          include it in scheduled runs.
        </p>
      )}

      <BrandForm
        action={update}
        initial={brandFormFromConfig(brand, config)}
        submitLabel="Save changes"
      />

      <hr className="rule" />

      <span className="kicker">Archive</span>
      <h2 className="editorial-close">Stop tracking {brand.name}.</h2>
      <p className="sub editorial-detail">
        Archiving stops scheduled runs for this brand. Its history stays
        readable from the run list, and archiving may return the rest of your
        brands to weekly runs.
      </p>
      <form action={archiveBrandAction}>
        <input type="hidden" name="brand_id" value={brand.id} />
        <button type="submit" className="btn-text btn-danger">
          Archive this brand
        </button>
      </form>

      <p className="brand-tools">
        <Link href={`/dashboard/${brand.id}`}>Back to {brand.name}</Link>
      </p>
    </>
  );
}
