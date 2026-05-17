"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WizardShell } from "../wizard-shell";
import { readWizardState, writeWizardState } from "@/lib/wizard-state";

export default function WizardBrandPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [aliasInput, setAliasInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const s = readWizardState();
    if (s.brand?.name) setName(s.brand.name);
    if (s.brand?.aliases?.length) setAliasInput(s.brand.aliases.join(", "));
    setHydrated(true);
  }, []);

  function validate(): boolean {
    if (!name.trim()) {
      setError("Brand name is required.");
      return false;
    }
    setError(null);
    return true;
  }

  function handleNext() {
    if (!validate()) return;
    const aliases = aliasInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    writeWizardState({ brand: { name: name.trim(), aliases } });
    router.push("/wizard/competitors");
  }

  if (!hydrated) return null;

  return (
    <WizardShell
      step={1}
      kicker="Your brand"
      heading="What brand are we tracking?"
      onNext={handleNext}
      nextDisabled={!name.trim()}
    >
      <div className="field">
        <label htmlFor="brand-name">Brand name</label>
        <input
          id="brand-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={validate}
          placeholder="e.g. Acme"
          autoFocus
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? "brand-name-error" : undefined}
        />
        {error && (
          <span className="field-error" id="brand-name-error" role="alert">
            {error}
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
