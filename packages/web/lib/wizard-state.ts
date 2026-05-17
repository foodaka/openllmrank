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

export type WizardState = {
  brand?: Brand;
  competitors: Brand[];
  prompts: string[];
  providers: ProviderConfig[];
  email?: string;
};

const STORAGE_KEY = "openllmrank.wizard.v1";

const empty: WizardState = {
  competitors: [],
  prompts: [],
  providers: [
    { id: "openai", model: "gpt-4o-mini" },
    { id: "anthropic", model: "claude-haiku-4-5-20251001" },
  ],
};

export function readWizardState(): WizardState {
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    return { ...empty, ...JSON.parse(raw) };
  } catch {
    return empty;
  }
}

export function writeWizardState(patch: Partial<WizardState>): WizardState {
  const current = readWizardState();
  const next = { ...current, ...patch };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function clearWizardState(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
