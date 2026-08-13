import type { Metadata } from "next";
import Link from "next/link";
import "../../styles/dashboard.css";
import { getBrands } from "@/lib/dashboard-data";

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
    <>
      <header className="dash-header">
        <div className="dash-header-inner">
          <Link href="/dashboard" className="wordmark">
            openllmrank
          </Link>
          <nav className="dash-nav">
            {brands.map((b) => (
              <Link key={b.id} href={`/dashboard/${b.id}`}>
                {b.name}
              </Link>
            ))}
            <Link href="/dashboard/billing">Billing</Link>
            <form action="/auth/signout" method="post">
              <button type="submit">Sign out</button>
            </form>
          </nav>
        </div>
      </header>
      <main className="dash-wrap">{children}</main>
    </>
  );
}
