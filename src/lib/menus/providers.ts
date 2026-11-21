/**
 * Menu provider registry: demo generator, approved imports, and the
 * authorization-gated Nutrislice connector.
 */
import type { MenuProviderKind } from "@/db/schema";
import { dateRange, weekdayOf } from "@/lib/dates";
import { DEMO_HALLS, demoMenuFor } from "@/lib/demo/derive";
import { nutrisliceProvider } from "./nutrislice";
import type { AutoSyncStatus, MenuProvider, NormalizedMenuDay, UniversityRow } from "./types";

export const demoProvider: MenuProvider = {
  kind: "demo",
  label: "Demo generator",
  autoSync: () => ({
    allowed: true,
    label: "Demo data",
    reason: "Fictional menus generated from recipes built on USDA data, for trying the app. No real dining hall serves them.",
  }),
  async fetchRange({ locations, from, to }) {
    const days: NormalizedMenuDay[] = [];
    const warnings: string[] = [];
    for (const loc of locations) {
      const hall = DEMO_HALLS.find((h) => h.key === loc.slug || h.key === loc.externalRef);
      if (!hall) {
        warnings.push(`${loc.name}: not a demo hall; skipped.`);
        continue;
      }
      for (const date of dateRange(from, to)) {
        const menu = demoMenuFor(hall, date);
        const weekday = weekdayOf(date);
        for (const period of hall.periods) {
          if (hall.closed?.[period]?.includes(weekday)) {
            days.push({ location: loc.slug, date, period, status: "closed", items: [], note: "Closed (demo schedule)." });
            continue;
          }
          const items = menu[period] ?? [];
          days.push({
            location: loc.slug,
            date,
            period,
            status: items.length ? "available" : "no_data",
            items: items.map((it) => ({
              name: it.name,
              station: it.station,
              servingAmount: it.servingAmount,
              servingUnit: it.servingUnit,
              servingGrams: it.servingGrams,
              official: it.official,
              ingredients: it.ingredients,
              allergens: it.allergens,
              dietaryLabels: it.dietary,
              sourceRef: it.externalId,
            })),
          });
        }
      }
    }
    return { days, warnings, failures: [] };
  },
};

export const importProvider: MenuProvider = {
  kind: "import",
  label: "Approved import",
  autoSync: () => ({
    allowed: false,
    label: "Import only",
    reason: "Menus for this university are loaded from approved data files by an administrator.",
  }),
  async fetchRange() {
    throw new Error("Import-only universities have no automatic retrieval.");
  },
};

const PROVIDERS: Record<MenuProviderKind, MenuProvider> = {
  demo: demoProvider,
  import: importProvider,
  nutrislice: nutrisliceProvider,
};

export function getProvider(kind: MenuProviderKind): MenuProvider {
  return PROVIDERS[kind];
}

export function autoSyncStatus(university: UniversityRow): AutoSyncStatus {
  return getProvider(university.provider).autoSync(university);
}
