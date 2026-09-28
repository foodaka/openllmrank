// The social card for a teardown post: headline plus the hero chart, drawn
// from the same content/teardowns/<slug>.json as the post, at 1200x630. A
// post's opengraph-image.tsx calls this; Next serves it as og:image, and the
// PNG doubles as the image attachment for X and LinkedIn posts.
//
// next/og (Satori) needs display:flex on every element with more than one
// child, and has no CSS variables, so the tokens come from shared/design-tokens.

import { ImageResponse } from "next/og";
import { colors } from "@openllmrank/shared/design-tokens";
import { sharePct, type TeardownData } from "../../../lib/teardown";

export const teardownOgSize = { width: 1200, height: 630 };

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export function teardownOgImage({
  data,
  headline,
  kicker,
  maxRows = 6,
}: {
  data: TeardownData;
  headline: string;
  kicker: string;
  maxRows?: number;
}): ImageResponse {
  const total = data.run.answers;
  // Top rows, plus the highlighted brand if it fell below the cut.
  const top = data.brands.slice(0, maxRows);
  const mine = data.brands.find((b) => b.name === data.highlight);
  const rows = mine && !top.includes(mine) ? [...top.slice(0, maxRows - 1), mine] : top;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: colors.paper,
          padding: "56px 72px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 26, color: colors.accent }}>openllmrank</div>
          <div
            style={{
              fontSize: 14,
              color: colors.accent,
              fontFamily: SANS,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            {kicker}
          </div>
        </div>

        <div style={{ fontSize: 50, color: colors.ink, lineHeight: 1.05, letterSpacing: "-0.015em", maxWidth: 1040 }}>
          {headline}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontFamily: SANS }}>
          {rows.map((r) => {
            const pct = sharePct(r.answers, total);
            const hl = r.name === data.highlight;
            const tone = hl ? colors.accent2 : colors.accent;
            return (
              <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 18 }}>
                <div
                  style={{
                    width: 190,
                    fontSize: 22,
                    color: hl ? colors.accent2 : colors.ink,
                    fontWeight: hl ? 700 : 400,
                  }}
                >
                  {r.name}
                </div>
                <div style={{ display: "flex", width: 780, height: 22, background: colors.soft, borderRadius: 3 }}>
                  <div style={{ width: `${Math.max(pct, 1)}%`, height: 22, background: tone, borderRadius: 3 }} />
                </div>
                <div style={{ fontSize: 22, color: hl ? colors.accent2 : colors.ink, fontWeight: 700 }}>{`${pct}%`}</div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: `1px solid ${colors.line}`,
            paddingTop: 16,
            fontSize: 17,
            color: colors.muted,
            fontFamily: SANS,
          }}
        >
          <div>{`Share of ${total} AI answers naming each brand · ${data.run.engines.length} engines · ${data.run.date}`}</div>
          <div style={{ color: colors.accent2, fontWeight: 600 }}>openllmrank.io</div>
        </div>
      </div>
    ),
    teardownOgSize,
  );
}
