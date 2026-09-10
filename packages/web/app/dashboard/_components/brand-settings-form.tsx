"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  HostedConfigSchema,
  HOSTED_CAPS,
  type Brand,
  type HostedConfig,
} from "@openllmrank/shared/config";
import {
  MAX_WEEKLY_BRANDS,
  normalizeCadence,
  type BrandCadence,
} from "@/lib/brand-cadence";

const MAX_COMPETITORS = 10;
type Cadence = BrandCadence;

type BrandSettingsFormProps = {
  brandId: string;
  initialConfig: HostedConfig;
  initialCadence: Cadence;
  activeBrandCount: number;
  completedRuns: number;
  nextRunAt: string | null;
};

function splitNames(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeWebsite(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function ordinal(day: number): string {
  const suffix =
    day % 100 >= 11 && day % 100 <= 13
      ? "th"
      : day % 10 === 1
        ? "st"
        : day % 10 === 2
          ? "nd"
          : day % 10 === 3
            ? "rd"
            : "th";
  return `${day}${suffix}`;
}

function formatRunDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
}

export function BrandSettingsForm({
  brandId,
  initialConfig,
  initialCadence,
  activeBrandCount,
  completedRuns,
  nextRunAt,
}: BrandSettingsFormProps) {
  const router = useRouter();
  const weeklyLocked = activeBrandCount > MAX_WEEKLY_BRANDS;
  const [name, setName] = useState(initialConfig.brand.name);
  const [website, setWebsite] = useState(initialConfig.brand.website ?? "");
  const [category, setCategory] = useState(initialConfig.brand.category ?? "");
  const [aliases, setAliases] = useState(initialConfig.brand.aliases.join(", "));
  const [competitors, setCompetitors] = useState<Brand[]>(
    initialConfig.competitors.map((competitor) => ({ ...competitor })),
  );
  const [prompts, setPrompts] = useState([...initialConfig.prompts]);
  const [competitorDraft, setCompetitorDraft] = useState("");
  const [addingCompetitor, setAddingCompetitor] = useState(false);
  const [cadence, setCadence] = useState<Cadence>(
    normalizeCadence(initialCadence, activeBrandCount),
  );
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promptCount = prompts.filter((prompt) => prompt.trim()).length;
  const answersPerRun =
    promptCount * HOSTED_CAPS.max_samples_per_prompt * HOSTED_CAPS.max_providers;
  const formattedNextRun = formatRunDate(nextRunAt);

  function addCompetitor() {
    const competitorName = competitorDraft.trim();
    if (!competitorName) return;
    if (competitors.length >= MAX_COMPETITORS) {
      setError(`At most ${MAX_COMPETITORS} competitors.`);
      return;
    }
    if (
      competitors.some(
        (competitor) =>
          competitor.name.toLowerCase() === competitorName.toLowerCase(),
      )
    ) {
      setError("Each competitor should appear only once.");
      return;
    }
    setCompetitors([...competitors, { name: competitorName, aliases: [] }]);
    setCompetitorDraft("");
    setAddingCompetitor(false);
    setError(null);
  }

  function removeCompetitor(index: number) {
    setCompetitors(competitors.filter((_, itemIndex) => itemIndex !== index));
  }

  function resetForm() {
    setName(initialConfig.brand.name);
    setWebsite(initialConfig.brand.website ?? "");
    setCategory(initialConfig.brand.category ?? "");
    setAliases(initialConfig.brand.aliases.join(", "));
    setCompetitors(
      initialConfig.competitors.map((competitor) => ({ ...competitor })),
    );
    setPrompts([...initialConfig.prompts]);
    setCompetitorDraft("");
    setAddingCompetitor(false);
    setCadence(normalizeCadence(initialCadence, activeBrandCount));
    setError(null);
  }

  async function saveSettings() {
    setSaving(true);
    setError(null);

    const cleanedCompetitors = competitors
      .map((competitor) => ({
        ...competitor,
        name: competitor.name.trim(),
      }))
      .filter((competitor) => competitor.name);
    const competitorNames = new Set<string>();
    if (
      cleanedCompetitors.some((competitor) => {
        const key = competitor.name.toLowerCase();
        if (competitorNames.has(key)) return true;
        competitorNames.add(key);
        return false;
      })
    ) {
      setError("Each competitor should appear only once.");
      setSaving(false);
      return;
    }

    const normalizedWebsite = normalizeWebsite(website);
    if (normalizedWebsite) {
      try {
        const parsedWebsite = new URL(normalizedWebsite);
        if (!parsedWebsite.hostname.includes(".")) throw new Error("invalid");
      } catch {
        setError("Enter a valid website, such as acme.com.");
        setSaving(false);
        return;
      }
    }

    const configResult = HostedConfigSchema.safeParse({
      ...initialConfig,
      brand: {
        name: name.trim(),
        aliases: splitNames(aliases),
        ...(normalizedWebsite ? { website: normalizedWebsite } : {}),
        ...(category.trim() ? { category: category.trim() } : {}),
      },
      competitors: cleanedCompetitors,
      prompts: prompts.map((prompt) => prompt.trim()).filter(Boolean),
    });
    if (!configResult.success) {
      setError(configResult.error.issues.map((issue) => issue.message).join(" "));
      setSaving(false);
      return;
    }

    try {
      const response = await fetch(`/api/brands/${brandId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          config: configResult.data,
          cadence: normalizeCadence(cadence, activeBrandCount),
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Could not save brand settings.");
        setSaving(false);
        return;
      }
      router.push(`/dashboard/${brandId}`);
      router.refresh();
    } catch (requestError) {
      setError((requestError as Error).message || "Network error.");
      setSaving(false);
    }
  }

  async function archiveBrand() {
    if (!window.confirm("Archive this brand? Its reports will remain readable.")) return;
    setArchiving(true);
    setError(null);
    try {
      const response = await fetch(`/api/brands/${brandId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Could not archive brand.");
        setArchiving(false);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (requestError) {
      setError((requestError as Error).message || "Network error.");
      setArchiving(false);
    }
  }

  return (
    <div className="settings-form">
      <details className="settings-disclosure">
        <summary>Brand identity</summary>
        <div className="settings-identity">
          <div className="field">
            <label htmlFor="settings-name">Brand name</label>
            <input
              id="settings-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="settings-website">Website</label>
            <input
              id="settings-website"
              type="url"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="e.g. acme.com"
            />
          </div>
          <div className="field">
            <label htmlFor="settings-category">Category</label>
            <input
              id="settings-category"
              type="text"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="e.g. B2B product analytics platforms"
            />
          </div>
          <div className="field">
            <label htmlFor="settings-aliases">Other names you go by</label>
            <input
              id="settings-aliases"
              type="text"
              value={aliases}
              onChange={(event) => setAliases(event.target.value)}
              placeholder="Comma-separated names"
            />
          </div>
        </div>
      </details>

      <section>
        <div className="settings-section-label">
          <span className="kicker">Questions</span>
        </div>
        <label className="sr-only" htmlFor="settings-prompts">
          Questions customers ask AI
        </label>
        <textarea
          id="settings-prompts"
          className="settings-question-input"
          value={prompts.join("\n")}
          onChange={(event) => setPrompts(event.target.value.split(/\r?\n/))}
          rows={7}
          placeholder="One customer question per line"
        />
        <p className="settings-meta">
          {promptCount} of {HOSTED_CAPS.max_prompts} · {answersPerRun} answers per run
        </p>
      </section>

      <hr className="rule" />

      <section>
        <div className="section-head settings-section-label">
          <span className="kicker">Competitors</span>
          <span className="brand-meta">{competitors.length} listed</span>
        </div>
        <div className="competitor-chips" aria-label="Competitors">
          {competitors.map((competitor, index) => (
            <span className="competitor-chip" key={`${competitor.name}-${index}`}>
              {competitor.name}
              <button
                type="button"
                onClick={() => removeCompetitor(index)}
                aria-label={`Remove ${competitor.name}`}
              >
                ×
              </button>
            </span>
          ))}
          {addingCompetitor ? (
            <div className="competitor-add-form">
              <label className="sr-only" htmlFor="new-competitor">
                New competitor
              </label>
              <input
                id="new-competitor"
                type="text"
                value={competitorDraft}
                onChange={(event) => setCompetitorDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCompetitor();
                  }
                }}
                placeholder="Competitor name"
                autoFocus
              />
              <button type="button" className="btn-text" onClick={addCompetitor}>
                Add
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="settings-add-chip"
              onClick={() => setAddingCompetitor(true)}
              disabled={competitors.length >= MAX_COMPETITORS}
            >
              + Add competitor
            </button>
          )}
        </div>
      </section>

      <hr className="rule" />

      <section>
        <span className="kicker">Cadence</span>
        <div className="cadence-options" role="radiogroup" aria-label="Tracking cadence">
          {["weekly", "monthly", "paused"].map((option) => {
            const cadenceOption = option as Cadence;
            const disabled = cadenceOption === "weekly" && weeklyLocked;
            const description =
              cadenceOption === "weekly"
                ? disabled
                  ? `Unavailable while you track ${activeBrandCount} brands. Archive one and this unlocks.`
                  : formattedNextRun
                    ? `Next run ${formattedNextRun}, then every week.`
                    : "Runs once a week."
                : cadenceOption === "monthly"
                  ? formattedNextRun
                    ? `Next run ${formattedNextRun}, then the ${ordinal(new Date(nextRunAt!).getDate())} of each month.`
                    : "Runs once a month after you save."
                  : completedRuns > 0
                    ? `No scheduled runs. Manual re-runs still work, and the ${completedRuns} run${completedRuns === 1 ? "" : "s"} you have stay readable.`
                    : "No scheduled runs. Manual re-runs still work.";

            return (
              <label className={`cadence-option${disabled ? " disabled" : ""}`} key={option}>
                <input
                  type="radio"
                  name="cadence"
                  value={cadenceOption}
                  checked={cadence === cadenceOption}
                  disabled={disabled}
                  onChange={() => setCadence(cadenceOption)}
                />
                <span className="cadence-copy">
                  <span className="cadence-name">
                    {cadenceOption[0]!.toUpperCase() + cadenceOption.slice(1)}
                  </span>
                  <span className="cadence-description">{description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="settings-archive-section">
        <span className="kicker">Archive</span>
        <p className="settings-archive-copy">
          Archiving stops scheduling and removes {name || "this brand"} from your
          dashboard. Previous reports remain readable by direct link. We do not
          delete run history.
        </p>
        <button
          type="button"
          className="btn-text settings-archive-button"
          onClick={archiveBrand}
          disabled={saving || archiving}
        >
          {archiving ? "Archiving..." : `Archive ${name || "brand"}`}
        </button>
      </section>

      {error && (
        <p className="submit-error" role="alert">
          {error}
        </p>
      )}

      <footer className="settings-footer">
        <button
          type="button"
          className="btn-text"
          onClick={resetForm}
          disabled={saving || archiving}
        >
          Discard changes
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={saveSettings}
          disabled={saving || archiving}
        >
          {saving ? "Saving..." : "Save for next run"}
        </button>
      </footer>
    </div>
  );
}
