import { ChartBar, House, List, Settings, Wallet } from "lucide-react";

/** The five areas (BUILD_PLAN section 6, DESIGN.md icons: house, list, wallet, bar chart, settings). */
export const NAV_ITEMS = [
  { href: "/", label: "Home", icon: House },
  { href: "/activity", label: "Activity", icon: List },
  { href: "/plan", label: "Plan", icon: Wallet },
  { href: "/reports", label: "Reports", icon: ChartBar },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
