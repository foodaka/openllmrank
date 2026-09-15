"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Nav item that knows whether it is the current page. The only client
// JavaScript on the dashboard read path, and it renders identically on the
// server for the first paint.
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}
