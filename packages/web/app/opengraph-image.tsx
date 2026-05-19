import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt =
  "openllmrank — Privacy-friendly, open-source analytics for AI search visibility";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#fbf8f0";
const INK = "#241f19";
const MUTED = "#756c60";
const LINE = "#e3d8c6";
const ACCENT = "#376b5b";
const TERRA = "#b86b2b";

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: PAPER,
          padding: "72px 80px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontSize: 28,
              color: ACCENT,
              fontWeight: 500,
              letterSpacing: "-0.01em",
            }}
          >
            openllmrank
          </div>
          <div
            style={{
              fontSize: 14,
              color: ACCENT,
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            AI-search visibility report
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 28,
          }}
        >
          <div
            style={{
              fontSize: 76,
              color: INK,
              lineHeight: 1.02,
              letterSpacing: "-0.015em",
              fontWeight: 500,
              maxWidth: 980,
            }}
          >
            Is ChatGPT recommending your competitors over you?
          </div>
          <div
            style={{
              fontSize: 24,
              color: MUTED,
              lineHeight: 1.45,
              maxWidth: 880,
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            }}
          >
            Privacy-friendly, open-source analytics for AI search visibility.
            One emailed report, $29.99.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            borderTop: `1px solid ${LINE}`,
            paddingTop: 24,
          }}
        >
          <div
            style={{
              fontSize: 18,
              color: MUTED,
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            }}
          >
            openllmrank.xyz
          </div>
          <div
            style={{
              fontSize: 18,
              color: TERRA,
              fontWeight: 600,
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            }}
          >
            Get the report &rarr;
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
