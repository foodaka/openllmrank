"use client";
import { track } from "@vercel/analytics";
import { publicLanding, referralSource, sanitizeAcquisition, type Acquisition } from "./acquisition";

const KEY = "openllmrank-acquisition-v1";
const TTL = 30 * 60 * 1000;
let memory: { data: Acquisition; expires: number } | undefined;

export function getAcquisition(): Acquisition {
  if (typeof window === "undefined") return { landing: "other", source: "other" };
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (typeof saved.expires === "number" && saved.expires > Date.now() && saved.expires <= Date.now() + TTL) {
        memory = { data: sanitizeAcquisition(saved.data), expires: saved.expires };
      }
    }
  } catch { /* Storage denial must never block checkout. */ }
  if (!memory || memory.expires <= Date.now()) {
    memory = { data: { landing: publicLanding(window.location.pathname), source: referralSource(document.referrer) }, expires: Date.now() + TTL };
    try { sessionStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* In-memory fallback. */ }
  }
  return memory.data;
}

export function trackFunnel(name: string, properties: Record<string, string | number> = {}) {
  try { track(name, { ...getAcquisition(), ...properties }); } catch { /* Analytics is best effort. */ }
}
