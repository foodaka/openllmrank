"use server";

import { redirect } from "next/navigation";
import { serviceClient, userClient } from "@/lib/supabase-server";
import {
  archiveBrand,
  createBrand,
  updateBrand,
  type BrandFormErrors,
  type BrandFormInput,
} from "@/lib/brand-writes";

// Server actions behind the add-brand and settings forms. The same library
// backs /api/brands for tests and integrations; these actions exist so the
// form can keep the customer's ten questions on screen when one field fails.

export type BrandFormState = {
  errors?: BrandFormErrors;
  message?: string;
};

function readInput(formData: FormData): BrandFormInput {
  const text = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v : "";
  };
  return {
    name: text("name"),
    website: text("website"),
    category: text("category"),
    aliases: text("aliases"),
    competitors: text("competitors"),
    prompts: text("prompts"),
  };
}

async function session() {
  const user = await userClient();
  const {
    data: { user: u },
  } = await user.auth.getUser();
  if (!u) redirect("/login?next=/dashboard");
  return { user, userId: u.id };
}

export async function createBrandAction(
  _prev: BrandFormState,
  formData: FormData,
): Promise<BrandFormState> {
  const { user, userId } = await session();
  const result = await createBrand({
    user,
    service: serviceClient(),
    userId,
    input: readInput(formData),
  });
  if (!result.ok) {
    if ("errors" in result) return { errors: result.errors };
    return { message: result.message };
  }
  redirect(`/dashboard/${result.brandId}`);
}

export async function updateBrandAction(
  brandId: string,
  _prev: BrandFormState,
  formData: FormData,
): Promise<BrandFormState> {
  const { user, userId } = await session();
  const result = await updateBrand({
    user,
    service: serviceClient(),
    userId,
    brandId,
    input: readInput(formData),
  });
  if (!result.ok) {
    if ("errors" in result) return { errors: result.errors };
    return { message: result.message };
  }
  redirect(`/dashboard/${brandId}?saved=1`);
}

export async function archiveBrandAction(formData: FormData): Promise<void> {
  const brandId = formData.get("brand_id");
  if (typeof brandId !== "string") redirect("/dashboard");
  const { user, userId } = await session();
  const result = await archiveBrand({ user, service: serviceClient(), userId, brandId });
  if (!result.ok) redirect(`/dashboard/${brandId}/settings?error=${result.code}`);
  redirect("/dashboard?archived=1");
}
