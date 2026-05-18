import type { Metadata } from "next";
import "../styles/globals.css";

// Editorial display: Fraunces (variable, opsz axis 9..144 — dramatic at hero sizes).
// Body: DM Sans (geometric, characterful, not Inter).
// Loaded via plain <link> so the same font-family literal works in our shared
// design-tokens.css across web AND the CLI's HTML report (when run in a browser).
const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?" +
  "family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700" +
  "&family=DM+Sans:wght@400;500;600;700" +
  "&display=swap";

export const metadata: Metadata = {
  title: "openllmrank — AI-search visibility report",
  description:
    "Find out exactly how ChatGPT and Claude rank your brand against your competitors. One-time $29.99.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
      </head>
      <body>{children}</body>
    </html>
  );
}
