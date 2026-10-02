// The shareable card for the app-stack teardown: the four-product default
// stack with each product's share of answers, then the usual add-ons. Drawn
// from the same JSON as the post. Satori needs display:flex on every element
// with more than one child, and has no CSS variables.

import { ImageResponse } from "next/og";
import { colors } from "@openllmrank/shared/design-tokens";
import data from "../../../content/teardowns/ai-app-stack-2026.json";
import { sharePct, type TeardownData } from "../../../lib/teardown";
import { teardownOgSize } from "../_components/teardown-og";

export const runtime = "edge";
export const alt = "The default app stack AI engines recommend: Next.js, Supabase, Vercel and Stripe, with each one's share of 75 answers";
export const size = teardownOgSize;
export const contentType = "image/png";

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const CORE = [
  { layer: "Framework", name: "Next.js" },
  { layer: "Database + auth", name: "Supabase" },
  { layer: "Hosting", name: "Vercel" },
  { layer: "Payments", name: "Stripe" },
];
const ADD_ONS = [
  { layer: "Email", name: "Resend" },
  { layer: "Auth", name: "Clerk" },
  { layer: "Analytics", name: "PostHog" },
  { layer: "Errors", name: "Sentry" },
];

export default function Image() {
  const d = data as TeardownData;
  const total = d.run.answers;
  const pct = (name: string) => sharePct(d.brands.find((b) => b.name === name)?.answers ?? 0, total);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: colors.paper,
          padding: "52px 72px",
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
            AI search teardown
          </div>
        </div>

        <div style={{ fontSize: 48, color: colors.ink, lineHeight: 1.05, letterSpacing: "-0.015em", maxWidth: 1040 }}>
          What AI recommends you build with in 2026
        </div>

        <div style={{ display: "flex", gap: 16 }}>
          {CORE.map((c) => (
            <div
              key={c.name}
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                padding: "18px 20px",
                border: `1px solid ${colors.line}`,
                borderTop: `4px solid ${colors.accent}`,
                background: colors.soft,
              }}
            >
              <div style={{ fontSize: 14, color: colors.muted, fontFamily: SANS, textTransform: "uppercase", letterSpacing: "0.12em" }}>
                {c.layer}
              </div>
              <div style={{ fontSize: 36, color: colors.ink, marginTop: 6 }}>{c.name}</div>
              <div style={{ fontSize: 22, color: colors.accent2, fontFamily: SANS, fontWeight: 700, marginTop: 4 }}>
                {`${pct(c.name)}% of answers`}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 28, fontFamily: SANS, fontSize: 20, color: colors.ink }}>
          <div style={{ color: colors.muted }}>Then:</div>
          {ADD_ONS.map((a) => (
            <div key={a.name} style={{ display: "flex", gap: 6 }}>
              <span style={{ fontWeight: 700 }}>{a.name}</span>
              <span style={{ color: colors.muted }}>{`${a.layer.toLowerCase()} ${pct(a.name)}%`}</span>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: `1px solid ${colors.line}`,
            paddingTop: 14,
            fontSize: 17,
            color: colors.muted,
            fontFamily: SANS,
          }}
        >
          <div>{`${total} answers · ChatGPT, Claude, Gemini, Perplexity, Grok · ${d.run.date}`}</div>
          <div style={{ color: colors.accent2, fontWeight: 600 }}>openllmrank.io</div>
        </div>
      </div>
    ),
    teardownOgSize,
  );
}
