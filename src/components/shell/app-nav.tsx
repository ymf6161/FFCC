"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActive, NAV_ITEMS } from "./nav-items";

/** Phone: ink pill bar at the bottom, icon and word for each area. */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      <ul className="mx-auto flex max-w-xl items-stretch gap-1 rounded-full bg-ink p-1.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="min-w-0 flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-full px-1 text-[0.8125rem] font-semibold",
                  active ? "bg-on-ink text-ink" : "text-on-ink-muted hover:text-on-ink",
                )}
              >
                <Icon aria-hidden className="size-5" strokeWidth={2} />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Desktop: the same five areas as a vertical pill list in the ink rail. */
export function RailNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      <ul className="space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-12 items-center gap-3 rounded-full px-4 font-semibold",
                  active ? "bg-on-ink text-ink" : "text-on-ink-muted hover:text-on-ink",
                )}
              >
                <Icon aria-hidden className="size-5" strokeWidth={2} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
