/**
 * Nutrislice connector.
 *
 * UW–Madison (and many other campuses) publish menus through Nutrislice's
 * public menu API (`https://<subdomain>.api.nutrislice.com/menu/api`), the
 * same endpoint other student projects read. The connector has two modes:
 *
 *   NUTRISLICE_SYNC_AUTHORIZED=true + NUTRISLICE_AUTHORIZATION_REF="…"
 *     An agreement with Nutrislice / the dining operator is on file.
 *
 *   NUTRISLICE_SYNC_ENABLED=true
 *     Unofficial sync, chosen by the operator WITHOUT an agreement. Nutrislice's
 *     General Terms of Use (section on restrictions, items vii and viii) don't
 *     permit automated access outside its public user interfaces, so this mode
 *     may be blocked at any time. The interface labels these menus as
 *     unofficial and never claims permission.
 *
 * Either way, requests are few and slow: one per location, meal and week,
 * with a delay between them (NUTRISLICE_REQUEST_DELAY_MS, default 1500).
 *
 * Locations are matched to Nutrislice "schools" by discovering them from
 * `/schools/` (by the location's externalRef or slug), and meals come from
 * each school's active menu types. NUTRISLICE_LOCATION_MAP or
 * providerConfig.locations can override that. The same parser also reads
 * Nutrislice-format JSON exports that a dining operator provides for import.
 */
import type { MealPeriod, OfficialNutrients } from "@/db/schema";
import { addDays, dateRange, weekdayOf } from "@/lib/dates";
import type { NutrientId } from "@/lib/nutrition/nutrients";
import { splitLabels } from "./labels";
import type {
  AutoSyncStatus,
  MenuProvider,
  NormalizedMenuDay,
  NormalizedMenuItem,
  ProviderFailure,
  UniversityRow,
} from "./types";

/* ------------------------------------------------------------------ */
/* Parsing                                                            */
/* ------------------------------------------------------------------ */

/** Nutrislice rounded_nutrition_info keys → app nutrient ids (value multipliers). */
const NUTRIENT_KEYS: Record<string, [NutrientId, number]> = {
  calories: ["energy", 1],
  g_fat: ["fat", 1],
  g_saturated_fat: ["saturated_fat", 1],
  g_trans_fat: ["trans_fat", 1],
  mg_cholesterol: ["cholesterol", 1],
  mg_sodium: ["sodium", 1],
  g_carbs: ["carbohydrate", 1],
  g_fiber: ["fiber", 1],
  g_sugar: ["sugars", 1],
  g_added_sugar: ["added_sugars", 1],
  g_protein: ["protein", 1],
  mg_potassium: ["potassium", 1],
  mg_calcium: ["calcium", 1],
  mg_iron: ["iron", 1],
  mg_vitamin_c: ["vitamin_c", 1],
  mcg_vitamin_d: ["vitamin_d", 1],
  iu_vitamin_d: ["vitamin_d", 1 / 40],
  mcg_vitamin_a: ["vitamin_a", 1],
  // Vitamin A in IU or "RE" needs assumptions about its chemical form, so it is not converted.
  // "mg_vitamin_d" is not mapped: UW's feed fills it with values that are implausible in mg,
  // so its real unit is unknown and it is treated as missing rather than guessed.
};

type Json = Record<string, unknown>;

function asObject(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Parses "1", "0.5", "1/2", "1 1/2" into a number. */
export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const s = asString(v);
  if (!s) return null;
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseNutrition(info: Json | null): OfficialNutrients {
  const out: OfficialNutrients = {};
  if (!info) return out;
  for (const [key, [id, factor]] of Object.entries(NUTRIENT_KEYS)) {
    const raw = info[key];
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n < 0) continue;
    if (out[id] !== undefined) continue;
    out[id] = n * factor;
  }
  return out;
}

function iconNames(food: Json): string[] {
  const icons = asObject(food.icons);
  const list = Array.isArray(icons?.food_icons) ? icons.food_icons : Array.isArray(food.icons) ? food.icons : [];
  const names: string[] = [];
  for (const icon of list) {
    const o = asObject(icon);
    const name = asString(o?.synced_name) ?? asString(o?.name) ?? asString(o?.slug);
    if (name) names.push(name);
  }
  return names;
}

export function parseNutrisliceFood(food: Json, station: string | null): NormalizedMenuItem | null {
  const name = asString(food.name);
  if (!name) return null;
  const serving = asObject(food.serving_size_info);
  const labels = splitLabels(iconNames(food));
  let servingAmount = parseAmount(serving?.serving_size_amount);
  let servingUnit = asString(serving?.serving_size_unit);
  // Feeds often send amount "1" with a unit that carries its own quantity ("6 oz", "1/2 cup"):
  // fold that into one amount + unit so it reads "6 oz", not "1 6 oz".
  const embedded = servingUnit?.match(/^(\d+(?:\.\d+)?|\d+\/\d+|\d+\s+\d+\/\d+)\s+(\S.*)$/);
  if (embedded && (servingAmount === null || servingAmount === 1)) {
    const inner = parseAmount(embedded[1]);
    if (inner) {
      servingAmount = inner;
      servingUnit = embedded[2];
    }
  }
  return {
    name,
    description: asString(food.description),
    station,
    servingAmount,
    servingUnit,
    servingGrams: null,
    official: parseNutrition(asObject(food.rounded_nutrition_info)),
    ingredients: asString(food.ingredients),
    allergens: labels.allergens,
    dietaryLabels: labels.dietary,
    sourceRef: food.id !== undefined && food.id !== null ? `nutrislice:food:${String(food.id)}` : null,
  };
}

/**
 * Parses a Nutrislice "week" document for one location and meal period.
 * Days outside [from, to] are skipped. A listed day without items becomes
 * "no_data" (nothing published), never an empty menu presented as real.
 */
export function parseNutrisliceWeek(
  doc: unknown,
  opts: { location: string; period: MealPeriod; from?: string; to?: string },
): NormalizedMenuDay[] {
  const root = asObject(doc);
  const days = Array.isArray(root?.days) ? root.days : [];
  const out: NormalizedMenuDay[] = [];
  for (const d of days) {
    const day = asObject(d);
    const date = asString(day?.date);
    if (!day || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if ((opts.from && date < opts.from) || (opts.to && date > opts.to)) continue;
    const entries = Array.isArray(day.menu_items) ? day.menu_items : [];
    // Station names live in day.menu_info[menu_id].section_options.display_name;
    // older feeds use header rows (is_station_header) instead.
    const info = asObject(day.menu_info);
    const sectionName = (menuId: unknown): string | null => {
      if (menuId === undefined || menuId === null || !info) return null;
      const section = asObject(asObject(info[String(menuId)])?.section_options);
      return asString(section?.display_name);
    };
    const items: NormalizedMenuItem[] = [];
    let header: string | null = null;
    for (const e of entries) {
      const entry = asObject(e);
      if (!entry) continue;
      if (entry.is_station_header) {
        header = asString(entry.text) ?? header;
        continue;
      }
      const food = asObject(entry.food);
      if (!food) continue;
      // Mobile-ordering placeholders ("… OrderIt") aren't dishes served on the line.
      if (/orderit/i.test(asString(food.name) ?? "")) continue;
      const item = parseNutrisliceFood(food, sectionName(entry.menu_id) ?? header);
      if (item) items.push(item);
    }
    out.push({
      location: opts.location,
      date,
      period: opts.period,
      status: items.length ? "available" : "no_data",
      items,
      note: items.length ? null : "No items were published for this meal.",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Retrieval                                                          */
/* ------------------------------------------------------------------ */

export interface NutrisliceLocationConfig {
  school: string;
  menuTypes: Partial<Record<MealPeriod, string>>;
}

/** Explicit mapping, if configured; otherwise locations are discovered from /schools/. */
function configuredLocationMap(university: UniversityRow): Record<string, NutrisliceLocationConfig> | null {
  const fromEnv = process.env.NUTRISLICE_LOCATION_MAP?.trim();
  if (fromEnv) {
    try {
      return JSON.parse(fromEnv) as Record<string, NutrisliceLocationConfig>;
    } catch {
      return null;
    }
  }
  const cfg = university.providerConfig as { locations?: Record<string, NutrisliceLocationConfig> };
  return cfg.locations && Object.keys(cfg.locations).length ? cfg.locations : null;
}

const OFF_REASON =
  "Automatic menu retrieval from Nutrislice is turned off. Menus appear here only after an administrator imports menu data.";

const UNOFFICIAL_REASON =
  "Menus are copied from the dining operator's public Nutrislice menus without an agreement with Nutrislice, whose terms don't permit automated access. This isn't an official integration and may stop working at any time.";

export function nutrisliceAutoSync(university: UniversityRow): AutoSyncStatus {
  const ref = process.env.NUTRISLICE_AUTHORIZATION_REF?.trim();
  if (process.env.NUTRISLICE_SYNC_AUTHORIZED === "true" && ref) {
    return { allowed: true, mode: "authorized", label: "Live (authorized)", reason: `Authorized feed. Reference: ${ref}` };
  }
  if (process.env.NUTRISLICE_SYNC_ENABLED === "true") {
    if (!(university.providerConfig as { subdomain?: string }).subdomain && !process.env.NUTRISLICE_API_BASE) {
      return { allowed: false, label: "Not configured", reason: "No Nutrislice subdomain is configured for this university." };
    }
    return { allowed: true, mode: "unofficial", label: "Live (unofficial)", reason: UNOFFICIAL_REASON };
  }
  return { allowed: false, label: "Off", reason: OFF_REASON };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sunday of the week containing `date`, which is how Nutrislice groups menus. */
function weekStart(date: string): string {
  return addDays(date, -weekdayOf(date));
}

const PERIOD_SLUGS: Record<string, MealPeriod> = { breakfast: "breakfast", brunch: "brunch", lunch: "lunch", dinner: "dinner" };

/** Builds the location map from the provider's own list of schools and their active menu types. */
export function locationMapFromSchools(schools: unknown, locations: { slug: string; externalRef: string | null }[]) {
  const list = Array.isArray(schools) ? schools : [];
  const bySlug = new Map<string, Json>();
  for (const s of list) {
    const o = asObject(s);
    const slug = asString(o?.slug);
    if (o && slug) bySlug.set(slug, o);
  }
  const map: Record<string, NutrisliceLocationConfig> = {};
  for (const loc of locations) {
    const school = bySlug.get(loc.externalRef ?? loc.slug) ?? bySlug.get(loc.slug);
    if (!school) continue;
    const menuTypes: Partial<Record<MealPeriod, string>> = {};
    for (const t of Array.isArray(school.active_menu_types) ? school.active_menu_types : []) {
      const slug = asString(asObject(t)?.slug);
      const period = slug ? PERIOD_SLUGS[slug] : undefined;
      if (slug && period && !menuTypes[period]) menuTypes[period] = slug;
    }
    if (Object.keys(menuTypes).length) map[loc.slug] = { school: String(school.slug), menuTypes };
  }
  return map;
}

export const nutrisliceProvider: MenuProvider = {
  kind: "nutrislice",
  label: "Nutrislice",
  autoSync: nutrisliceAutoSync,
  async fetchRange({ university, locations, from, to }) {
    const status = nutrisliceAutoSync(university);
    if (!status.allowed) throw new Error(status.reason);
    const cfg = university.providerConfig as { subdomain?: string };
    const base = (process.env.NUTRISLICE_API_BASE || `https://${cfg.subdomain}.api.nutrislice.com`).replace(/\/+$/, "");
    const delay = Math.max(500, Number(process.env.NUTRISLICE_REQUEST_DELAY_MS ?? 1500) || 1500);
    const userAgent =
      status.mode === "authorized"
        ? `CampusNutritionOptimizer/1.0 (authorized integration; ${process.env.NUTRISLICE_AUTHORIZATION_REF})`
        : "CampusNutritionOptimizer/1.0 (student menu planner; low-volume daily sync)";
    const get = async (path: string) => {
      let res: Response;
      try {
        res = await fetch(`${base}/menu/api${path}`, {
          headers: { Accept: "application/json", "User-Agent": userAgent },
          signal: AbortSignal.timeout(20_000),
        });
      } catch (e) {
        // Node reports network problems as "fetch failed" with the real reason in `cause`.
        const cause = (e as { cause?: { code?: string; message?: string } }).cause;
        throw new Error(cause ? `network error: ${cause.code ?? cause.message}` : (e as Error).message);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<unknown>;
    };

    const days: NormalizedMenuDay[] = [];
    const failures: ProviderFailure[] = [];
    const warnings: string[] = [];

    let map = configuredLocationMap(university);
    if (!map) {
      try {
        map = locationMapFromSchools(await get("/schools/"), locations);
      } catch (e) {
        throw new Error(`couldn't load the list of dining locations from Nutrislice (${(e as Error).message})`);
      }
      await sleep(delay);
    }

    const weeks = [...new Set(dateRange(from, to).map(weekStart))];
    for (const loc of locations) {
      const lc = map[loc.slug] ?? (loc.externalRef ? map[loc.externalRef] : undefined);
      if (!lc) {
        warnings.push(`${loc.name}: not found among Nutrislice's locations; skipped.`);
        continue;
      }
      for (const [period, menuType] of Object.entries(lc.menuTypes) as [MealPeriod, string][]) {
        for (const week of weeks) {
          const [y, m, d] = week.split("-");
          try {
            const doc = await get(`/weeks/school/${encodeURIComponent(lc.school)}/menu-type/${encodeURIComponent(menuType)}/${y}/${m}/${d}/`);
            days.push(...parseNutrisliceWeek(doc, { location: loc.slug, period, from, to }));
          } catch (e) {
            for (const date of dateRange(week < from ? from : week, addDays(week, 6) > to ? to : addDays(week, 6))) {
              failures.push({ location: loc.slug, date, period, error: (e as Error).message });
            }
          }
          await sleep(delay);
        }
      }
    }
    return { days, failures, warnings };
  },
};
