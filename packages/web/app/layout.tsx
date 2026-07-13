import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
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

const SITE_URL = "https://openllmrank.xyz";
const SITE_NAME = "openllmrank";
const SITE_DESCRIPTION =
  "A repeatable AI-search visibility benchmark with grounded OpenAI and Anthropic APIs, competitor evidence, and a prioritized action plan. One emailed report, $29.99.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "openllmrank — AI-search visibility analytics",
    template: "%s — openllmrank",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "openllmrank — AI-search visibility analytics",
    description: SITE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "openllmrank — AI-search visibility analytics",
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
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
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
