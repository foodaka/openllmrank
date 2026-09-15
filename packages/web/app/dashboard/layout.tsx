import type { Metadata } from "next";
import Link from "next/link";
import "../../styles/dashboard.css";
import { getBrands } from "@/lib/dashboard-data";
import { NavLink } from "./_components/nav-link";

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
          <nav className="dash-nav" aria-label="Dashboard">
            {brands.map((b) => (
              <NavLink key={b.id} href={`/dashboard/${b.id}`}>
                {b.name}
              </NavLink>
            ))}
            <NavLink href="/dashboard/brands/new">Add a brand</NavLink>
            <NavLink href="/dashboard/billing">Billing</NavLink>
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
