import type { Metadata } from "next";
import CheckLayout from "../check/layout";

// Same chrome and base styles as /check (nav, footer, .wrap typography,
// .check-form, .field). Snapshot-specific styles live in snapshot-styles.tsx.

export const metadata: Metadata = {
  title: {
    template: "%s — openllmrank",
    default: "Free AI visibility snapshot",
  },
};

export default function SnapshotLayout({ children }: { children: React.ReactNode }) {
  return <CheckLayout>{children}</CheckLayout>;
}
