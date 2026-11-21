/**
 * Freshness labels for stored menus. Every menu shown in the app carries one
 * of three states so users can tell current data from older copies:
 *  - current:     retrieved or imported recently from the source
 *  - cached:      the latest stored copy, but older than the freshness window
 *                 (or a later retrieval failed)
 *  - unavailable: no menu was published, retrieved, or imported
 */
import type { MenuDayStatus, MenuProviderKind } from "@/db/schema";
import { timeAgo } from "@/lib/dates";

export type Freshness = "current" | "cached" | "unavailable";

export interface FreshnessInfo {
  state: Freshness;
  label: string;
  detail: string;
}

/** Hours after which a retrieved menu counts as cached rather than current. */
const WINDOW_HOURS: Record<MenuProviderKind, number> = {
  nutrislice: 36,
  demo: 24 * 30,
  import: 24 * 14,
};

export function menuFreshness(
  day: { status: MenuDayStatus; fetchedAt: Date | string; source: MenuProviderKind; note?: string | null } | null,
  now: Date = new Date(),
): FreshnessInfo {
  if (!day) {
    return {
      state: "unavailable",
      label: "No menu data",
      detail: "No menu has been published, retrieved or imported for this meal.",
    };
  }
  const fetched = typeof day.fetchedAt === "string" ? new Date(day.fetchedAt) : day.fetchedAt;
  const ago = timeAgo(fetched, now);
  if (day.status === "error") {
    return { state: "unavailable", label: "Unavailable", detail: day.note || "The source could not be reached and no earlier copy exists." };
  }
  if (day.status === "no_data") {
    return { state: "unavailable", label: "Not published", detail: `The source had no menu for this meal (checked ${ago}).` };
  }
  const ageHours = (now.getTime() - fetched.getTime()) / 3_600_000;
  const verb = day.source === "import" ? "Imported" : day.source === "demo" ? "Generated" : "Updated";
  if (ageHours <= WINDOW_HOURS[day.source]) {
    return { state: "current", label: `${verb} ${ago}`, detail: `${verb} ${ago}.` };
  }
  return {
    state: "cached",
    label: `Cached · ${ago}`,
    detail: `This is the last stored copy (${verb.toLowerCase()} ${ago}). The source may have changed since.`,
  };
}
