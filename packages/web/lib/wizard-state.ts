// localStorage-backed wizard state. The wizard is 4 routes; this module is
// the one source of truth for what each step has captured.
//
// We deliberately do NOT use React context or a global store. The state
// only needs to survive route transitions and refreshes; localStorage
// handles both.

"use client";

import type {
  Brand,
  ProviderConfig,
} from "@openllmrank/shared/config";
import { HOSTED_REPORT_PROVIDERS } from "@openllmrank/shared/config";

export type WizardState = {
  brand?: Brand;
  competitors: Brand[];
  prompts: string[];
  providers: ProviderConfig[];
  email?: string;
};

export type WizardMode = "one-shot" | "add-brand";

const STORAGE_KEYS: Record<WizardMode, string> = {
  "one-shot": "openllmrank.wizard.v1",
  "add-brand": "openllmrank.wizard.add-brand.v1",
};

const empty: WizardState = {
  competitors: [],
  prompts: [],
  providers: HOSTED_REPORT_PROVIDERS.map((provider) => ({ ...provider })),
};

function storageKey(mode: WizardMode): string {
  return STORAGE_KEYS[mode];
}

function emptyState(): WizardState {
  return {
    ...empty,
    competitors: [],
    prompts: [],
    providers: HOSTED_REPORT_PROVIDERS.map((provider) => ({ ...provider })),
  };
}

export function getWizardMode(): WizardMode {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mode") === "add") {
    return "add-brand";
  }
  return "one-shot";
}

export function wizardPath(path: string, mode: WizardMode): string {
  return mode === "add-brand" ? `${path}?mode=add` : path;
}

export function readWizardState(mode: WizardMode = "one-shot"): WizardState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(storageKey(mode));
    if (!raw) return emptyState();
    return {
      ...emptyState(),
      ...JSON.parse(raw),
      // Provider selection is part of the hosted product, not a wizard input.
      // Normalize old saved sessions to the current report lineup.
      providers: HOSTED_REPORT_PROVIDERS.map((provider) => ({ ...provider })),
    };
  } catch {
    return emptyState();
  }
}

export function writeWizardState(
  patch: Partial<WizardState>,
  mode: WizardMode = "one-shot",
): WizardState {
  const current = readWizardState(mode);
  const next = { ...current, ...patch };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(storageKey(mode), JSON.stringify(next));
  }
  return next;
}

export function clearWizardState(mode: WizardMode = "one-shot"): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(storageKey(mode));
  }
}
