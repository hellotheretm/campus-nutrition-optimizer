import {
  CalendarClock,
  LayoutDashboard,
  NotebookPen,
  School,
  Settings,
  Sparkles,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Other path prefixes that should highlight this item. */
  also?: string[];
}

export const APP_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/optimizer", label: "Meal optimizer", icon: Sparkles },
  { href: "/diary", label: "Food diary", icon: NotebookPen },
  { href: "/menus", label: "Menus", icon: UtensilsCrossed, also: ["/foods"] },
  { href: "/history", label: "History", icon: CalendarClock },
  { href: "/universities", label: "Universities", icon: School, also: ["/request-university"] },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Bottom navigation on phones (the rest live under "More"). */
export const MOBILE_PRIMARY = ["/dashboard", "/menus", "/optimizer", "/diary"];

export function isActive(pathname: string, item: NavItem): boolean {
  const prefixes = [item.href, ...(item.also ?? [])];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
