"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getAcquisition, trackFunnel } from "../../lib/funnel-client";
import { publicLanding } from "../../lib/acquisition";

export function AcquisitionTracker() {
  const path = usePathname();
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    getAcquisition();
    if (path === lastPath.current) return;
    lastPath.current = path;
    if (publicLanding(path) !== "other") trackFunnel("acquisition_page_view", { page: path });
    if (path === "/wizard/brand") trackFunnel("wizard_start");
    if (["/wizard/competitors", "/wizard/prompts", "/wizard/review"].includes(path)) {
      trackFunnel("wizard_step_view", { step: path.split("/").pop()! });
    }
  }, [path]);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest("a");
      if (!link) return;
      const url = new URL(link.href, window.location.origin);
      if (url.origin !== window.location.origin || publicLanding(path) === "other") return;
      const destination = url.pathname;
      if (!["/wizard/brand", "/check", "/sample-report.html"].includes(destination)) return;
      trackFunnel("product_cta_click", {
        page: path, destination,
        location: link.dataset.ctaLocation ?? (link.closest("nav") ? "navigation" : link.closest(".hero") ? "hero" : link.closest(".post-end") ? "article_end" : "body"),
      });
    };
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, [path]);
  return null;
}
