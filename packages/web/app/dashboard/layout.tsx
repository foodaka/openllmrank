import type { Metadata } from "next";
import "../../styles/dashboard.css";
import { getBrands } from "@/lib/dashboard-data";
import { DashSidebar } from "./_components/dash-sidebar";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // middleware.ts already guarantees a session on /dashboard/*, so a failure
  // here is a real error rather than a signed-out visitor.
  const brands = await getBrands();

  return (
    <div className="dash-shell">
      <DashSidebar brands={brands.map((b) => ({ id: b.id, name: b.name, website: b.website }))} />
      <main className="dash-wrap">{children}</main>
    </div>
  );
}
