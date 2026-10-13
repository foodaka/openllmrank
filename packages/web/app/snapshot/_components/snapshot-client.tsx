"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Brand } from "@openllmrank/shared/config";
import { writeWizardState } from "../../../lib/wizard-state";
import { trackFunnel } from "../../../lib/funnel-client";

/** Re-render the server page every few seconds while the run is in flight. */
export function AutoRefresh({ startedAt }: { startedAt: string }) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(() => secondsSince(startedAt));

  useEffect(() => {
    const refresh = setInterval(() => router.refresh(), 4_000);
    const tick = setInterval(() => setElapsed(secondsSince(startedAt)), 1_000);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [router, startedAt]);

  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return (
    <span className="snapshot-elapsed" aria-live="off">
      {m}:{String(s).padStart(2, "0")} elapsed
    </span>
  );
}

function secondsSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

/**
 * Carry the snapshot's brand, competitors and questions into the wizard and
 * land on the plan step, so starting tracking is one click plus checkout.
 */
export function TrackCta(props: {
  brand: Brand;
  competitors: Brand[];
  prompts: string[];
  email: string;
  label?: string;
  placement: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn-primary"
      onClick={() => {
        writeWizardState({
          brand: props.brand,
          competitors: props.competitors,
          prompts: props.prompts,
          email: props.email,
        });
        trackFunnel("snapshot_track_click", { placement: props.placement });
        router.push("/wizard/review");
      }}
    >
      {props.label ?? "Track this weekly — $49/month"}
    </button>
  );
}
