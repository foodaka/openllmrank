import type { Metadata } from "next";
import "../styles/globals.css";

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
      <body>{children}</body>
    </html>
  );
}
