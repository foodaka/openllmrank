"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WizardShell } from "../wizard-shell";
import { readWizardState, writeWizardState } from "@/lib/wizard-state";

export default function WizardBrandPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [category, setCategory] = useState("");
  const [aliasInput, setAliasInput] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const s = readWizardState();
    if (s.brand?.name) setName(s.brand.name);
    if (s.brand?.website) setWebsite(s.brand.website);
    if (s.brand?.category) setCategory(s.brand.category);
    if (s.brand?.aliases?.length) setAliasInput(s.brand.aliases.join(", "));
    setHydrated(true);
  }, []);

  function validate(): boolean {
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) {
      nextErrors.name = "Brand name is required.";
    }
    if (!category.trim()) {
      nextErrors.category = "Category is required so we can draft useful discovery prompts.";
    }
    try {
      const normalized = /^https?:\/\//i.test(website.trim())
        ? website.trim()
        : `https://${website.trim()}`;
      const url = new URL(normalized);
      if (!website.trim() || !url.hostname.includes(".")) throw new Error("invalid");
    } catch {
      nextErrors.website = "Enter a valid website, such as acme.com.";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleNext() {
    if (!validate()) return;
    const aliases = aliasInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const normalizedWebsite = /^https?:\/\//i.test(website.trim())
      ? website.trim()
      : `https://${website.trim()}`;
    writeWizardState({
      brand: {
        name: name.trim(),
        aliases,
        website: new URL(normalizedWebsite).toString(),
        category: category.trim(),
      },
    });
    router.push("/wizard/competitors");
  }

  if (!hydrated) return null;

  return (
    <WizardShell
      step={1}
      kicker="Your brand"
      heading="What brand are we tracking?"
      onNext={handleNext}
      nextDisabled={!name.trim() || !website.trim() || !category.trim()}
    >
      <div className="field">
        <label htmlFor="brand-name">Brand name</label>
        <input
          id="brand-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Acme"
          autoFocus
          aria-invalid={errors.name ? "true" : "false"}
          aria-describedby={errors.name ? "brand-name-error" : undefined}
        />
        {errors.name && (
          <span className="field-error" id="brand-name-error" role="alert">
            {errors.name}
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="brand-website">Website</label>
        <input
          id="brand-website"
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="e.g. acme.com"
          aria-invalid={errors.website ? "true" : "false"}
          aria-describedby={errors.website ? "brand-website-error" : "brand-website-help"}
        />
        {errors.website ? (
          <span className="field-error" id="brand-website-error" role="alert">
            {errors.website}
          </span>
        ) : (
          <span className="field-help" id="brand-website-help">
            Used to make the report&rsquo;s recommendations specific to your site.
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="brand-category">What category do buyers put you in?</label>
        <input
          id="brand-category"
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. B2B product analytics platforms"
          aria-invalid={errors.category ? "true" : "false"}
          aria-describedby={errors.category ? "brand-category-error" : "brand-category-help"}
        />
        {errors.category ? (
          <span className="field-error" id="brand-category-error" role="alert">
            {errors.category}
          </span>
        ) : (
          <span className="field-help" id="brand-category-help">
            Use the phrase a customer would type, not an internal positioning statement.
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="brand-aliases">Other names you go by (optional)</label>
        <input
          id="brand-aliases"
          type="text"
          value={aliasInput}
          onChange={(e) => setAliasInput(e.target.value)}
          placeholder="e.g. Acme Corp, AcmeApp"
          aria-describedby="brand-aliases-help"
        />
        <span className="field-help" id="brand-aliases-help">
          Comma-separated. We&rsquo;ll count any of these as a mention.
        </span>
      </div>
    </WizardShell>
  );
}
