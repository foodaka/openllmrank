"use client";

// Dashboard navigation: brand switcher, the current brand's sections, then
// account links. Editorial, not SaaS chrome (DESIGN.md): paper, serif
// wordmark, kicker labels, hairlines, no icons. The switcher is a native
// <select> so it's keyboard- and screen-reader-friendly with no menu code.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type SidebarBrand = { id: string; name: string; website: string | null };

const BRAND_PATH = /^\/dashboard\/([0-9a-f-]{36})(\/[a-z-]+)?/i;

function host(website: string | null): string | null {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function Item({ href, current, children }: { href: string; current: boolean; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} aria-current={current ? "page" : undefined}>
        {children}
      </Link>
    </li>
  );
}

export function DashSidebar({ brands }: { brands: SidebarBrand[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const match = BRAND_PATH.exec(pathname);
  const brandId = match?.[1] && brands.some((b) => b.id === match[1]) ? match[1] : null;
  const section = match?.[2] ?? "";
  const brand = brands.find((b) => b.id === brandId) ?? null;
  const base = brandId ? `/dashboard/${brandId}` : null;

  function switchBrand(id: string) {
    // Stay on the same section when switching brands.
    router.push(id ? `/dashboard/${id}${section}` : "/dashboard");
  }

  return (
    <aside className="dash-sidebar">
      <Link href="/dashboard" className="wordmark">
        openllmrank
      </Link>

      {brands.length > 0 ? (
        <div className="dash-switcher">
          <select id="dash-brand" aria-label="Brand" value={brandId ?? ""} onChange={(e) => switchBrand(e.target.value)}>
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {brand && host(brand.website) ? <p className="dash-switcher-host">{host(brand.website)}</p> : null}
        </div>
      ) : null}

      <nav aria-label="Dashboard" className="dash-sections">
        {base ? (
          <>
            <p className="dash-group">Tracking</p>
            <ul>
              <Item href={base} current={section === ""}>Overview</Item>
              <Item href={`${base}/runs`} current={section === "/runs"}>Runs</Item>
            </ul>
            <p className="dash-group">Research</p>
            <ul>
              <Item href={`${base}/questions`} current={section === "/questions"}>Question research</Item>
            </ul>
            <p className="dash-group">Brand</p>
            <ul>
              <Item href={`${base}/settings`} current={section === "/settings"}>Settings</Item>
            </ul>
          </>
        ) : null}

        <p className="dash-group">Account</p>
        <ul>
          <Item href="/dashboard" current={pathname === "/dashboard"}>All brands</Item>
          <Item href="/dashboard/brands/new" current={pathname === "/dashboard/brands/new"}>Add a brand</Item>
          <Item href="/dashboard/billing" current={pathname.startsWith("/dashboard/billing")}>Billing</Item>
          <li>
            <form action="/auth/signout" method="post">
              <button type="submit">Sign out</button>
            </form>
          </li>
        </ul>
      </nav>
    </aside>
  );
}
