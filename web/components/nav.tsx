"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-toggle";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/research", label: "Research" },
  { href: "/terminal", label: "Terminal" },
  { href: "/api-docs", label: "API" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      <Link href="/" className="brand">
        <span className="n">CALIBRA</span>
        <span className="t">EVENT CONTRACTS</span>
      </Link>
      <div className="nav-links">
        {LINKS.map((l) => {
          // Every route is a prefix of "/", so the root needs an exact match or
          // it would light up on every page.
          const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}>
              {l.label}
            </Link>
          );
        })}
      </div>
      <div className="spacer" />
      <ThemeToggle />
    </nav>
  );
}
