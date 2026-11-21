/**
 * Public data access: universities, dining locations, menus and foods.
 * Everything here is request-time (connection()) so the database is never
 * touched while the app is being built.
 */
import "server-only";
import { and, desc, eq, gt, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import {
  diningLocations,
  foods,
  menuDays,
  menuItems,
  syncRuns,
  universities,
  type DisplayIntegrationStatus,
  type HoursRule,
  type MealPeriod,
  type MenuDayStatus,
  type MenuProviderKind,
} from "@/db/schema";
import { isIsoDate, todayIn, weekdayOf } from "@/lib/dates";
import type { Confidence, EstimationResult, NutrientEstimates } from "@/lib/nutrition/estimator";
import { perServingNutrients } from "@/lib/nutrition/food-nutrients";
import { highlightsFor, type NutrientHighlight } from "@/lib/nutrition/highlights";
import { servingLabel } from "@/lib/nutrition/units";
import { menuFreshness, type FreshnessInfo } from "@/lib/menus/freshness";
import { ensureDemoMenusFor } from "@/lib/menus/sync";
import { autoSyncStatus } from "@/lib/menus/providers";
import { MEAL_PERIODS, type AutoSyncStatus, type UniversityRow } from "@/lib/menus/types";

export interface UniversitySummary {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  city: string | null;
  state: string | null;
  timezone: string;
  isDemo: boolean;
  provider: MenuProviderKind;
  integrationStatus: DisplayIntegrationStatus;
  integrationNotes: string | null;
  autoSync: AutoSyncStatus;
  websiteUrl: string | null;
  menuSourceUrl: string | null;
  nutritionInfoUrl: string | null;
  allergenNotice: string | null;
  locationCount: number;
  lastSync: { at: string; status: string; trigger: string } | null;
  menuDataThrough: string | null;
}

function summarize(
  u: UniversityRow,
  locationCount: number,
  last: { at: Date; status: string; trigger: string } | undefined,
  through: string | null,
): UniversitySummary {
  const autoSync = autoSyncStatus(u);
  // A campus waiting on authorization whose sync an operator has switched on: say how it is sanctioned.
  const syncing = u.integrationStatus === "pending_authorization" && autoSync.allowed;
  const integrationStatus: DisplayIntegrationStatus = syncing ? (autoSync.mode === "authorized" ? "live" : "unofficial_sync") : u.integrationStatus;
  return {
    id: u.id,
    slug: u.slug,
    name: u.name,
    shortName: u.shortName ?? u.name,
    city: u.city,
    state: u.state,
    timezone: u.timezone,
    isDemo: u.isDemo,
    provider: u.provider,
    integrationStatus,
    integrationNotes: syncing
      ? autoSync.mode === "unofficial"
        ? "There's no agreement with Nutrislice, whose terms don't permit automated access, so syncing may stop at any time. Menus can lag behind last-minute changes."
        : autoSync.reason
      : u.integrationNotes,
    autoSync,
    websiteUrl: u.websiteUrl,
    menuSourceUrl: u.menuSourceUrl,
    nutritionInfoUrl: u.nutritionInfoUrl,
    allergenNotice: u.allergenNotice,
    locationCount,
    lastSync: last ? { at: last.at.toISOString(), status: last.status, trigger: last.trigger } : null,
    menuDataThrough: through,
  };
}

export async function listUniversities(): Promise<UniversitySummary[]> {
  await connection();
  await ensureBootstrapped();
  const db = await getDb();
  const rows = await db.select().from(universities).where(eq(universities.isActive, true)).orderBy(universities.isDemo, universities.name);
  const counts = await db
    .select({ universityId: diningLocations.universityId, n: sql<number>`count(*)::int` })
    .from(diningLocations)
    .where(eq(diningLocations.isActive, true))
    .groupBy(diningLocations.universityId);
  const lastRuns = await db
    .select({
      universityId: syncRuns.universityId,
      at: sql<Date>`max(${syncRuns.finishedAt})`,
    })
    .from(syncRuns)
    .where(inArray(syncRuns.status, ["success", "partial"]))
    .groupBy(syncRuns.universityId);
  const through = await db
    .select({ universityId: menuDays.universityId, d: sql<string>`max(${menuDays.date})::text` })
    .from(menuDays)
    .where(eq(menuDays.status, "available"))
    .groupBy(menuDays.universityId);
  return rows.map((u) => {
    const last = lastRuns.find((r) => r.universityId === u.id);
    return summarize(
      u,
      counts.find((c) => c.universityId === u.id)?.n ?? 0,
      last?.at ? { at: new Date(last.at), status: "success", trigger: "" } : undefined,
      through.find((t) => t.universityId === u.id)?.d ?? null,
    );
  });
}

export async function getUniversity(idOrSlug: string): Promise<UniversitySummary | null> {
  const all = await listUniversities();
  return all.find((u) => u.id === idOrSlug || u.slug === idOrSlug) ?? null;
}

export async function defaultUniversity(): Promise<UniversitySummary | null> {
  const all = await listUniversities();
  // Prefer a real university with menu data, then the demo campus, then anything.
  return (
    all.find((u) => !u.isDemo && u.menuDataThrough) ??
    all.find((u) => u.isDemo) ??
    all[0] ??
    null
  );
}

export interface LocationSummary {
  id: string;
  slug: string;
  name: string;
  building: string | null;
  address: string | null;
  hours: HoursRule[];
  hoursSourceUrl: string | null;
  hoursVerifiedOn: string | null;
}

export async function listLocations(universityId: string): Promise<LocationSummary[]> {
  await connection();
  await ensureBootstrapped();
  const db = await getDb();
  const rows = await db
    .select()
    .from(diningLocations)
    .where(and(eq(diningLocations.universityId, universityId), eq(diningLocations.isActive, true)))
    .orderBy(diningLocations.sortOrder, diningLocations.name);
  return rows.map((l) => ({
    id: l.id,
    slug: l.slug,
    name: l.name,
    building: l.building,
    address: l.address,
    hours: l.hours,
    hoursSourceUrl: l.hoursSourceUrl,
    hoursVerifiedOn: l.hoursVerifiedOn,
  }));
}

export function hoursFor(hours: HoursRule[], date: string): Map<MealPeriod, { open: string; close: string }> {
  const weekday = weekdayOf(date);
  const out = new Map<MealPeriod, { open: string; close: string }>();
  for (const rule of hours) {
    if (!rule.days.includes(weekday)) continue;
    for (const p of rule.periods) out.set(p.period, { open: p.open, close: p.close });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Menus                                                              */
/* ------------------------------------------------------------------ */

export type { NutrientHighlight } from "@/lib/nutrition/highlights";

export interface MenuFoodCard {
  id: string;
  name: string;
  station: string | null;
  servingLabel: string;
  energy: number | null;
  protein: number | null;
  carbohydrate: number | null;
  fat: number | null;
  sodium: number | null;
  highlights: NutrientHighlight[];
  allergens: string[];
  dietaryLabels: string[];
  confidence: Confidence;
  method: EstimationResult["method"] | null;
}

export interface MenuPeriodView {
  period: MealPeriod;
  status: MenuDayStatus | "missing";
  scheduled: { open: string; close: string } | null;
  freshness: FreshnessInfo;
  note: string | null;
  stations: { name: string; items: MenuFoodCard[] }[];
  itemCount: number;
}

export interface MenuLocationView {
  location: LocationSummary;
  periods: MenuPeriodView[];
  closedAllDay: boolean;
}

export interface MenuView {
  university: UniversitySummary;
  date: string;
  today: string;
  locations: MenuLocationView[];
}

function cardFor(row: {
  id: string;
  name: string;
  station: string | null;
  servingAmount: number | null;
  servingUnit: string | null;
  official: Record<string, number>;
  estimate: EstimationResult | null;
  allergens: string[];
  dietaryLabels: string[];
}): MenuFoodCard {
  const n = perServingNutrients({ estimate: row.estimate, official: row.official });
  return {
    id: row.id,
    name: row.name,
    station: row.station,
    servingLabel: servingLabel(row.servingAmount, row.servingUnit),
    energy: n.energy?.value ?? null,
    protein: n.protein?.value ?? null,
    carbohydrate: n.carbohydrate?.value ?? null,
    fat: n.fat?.value ?? null,
    sodium: n.sodium?.value ?? null,
    highlights: highlightsFor(n),
    allergens: row.allergens,
    dietaryLabels: row.dietaryLabels,
    confidence: row.estimate?.overallConfidence ?? "none",
    method: row.estimate?.method ?? null,
  };
}

export async function getMenuView(universityIdOrSlug: string, requestedDate?: string): Promise<MenuView | null> {
  const university = await getUniversity(universityIdOrSlug);
  if (!university) return null;
  const today = todayIn(university.timezone);
  const date = requestedDate && isIsoDate(requestedDate) ? requestedDate : today;
  const db = await getDb();
  if (university.isDemo) {
    const [row] = await db.select().from(universities).where(eq(universities.id, university.id)).limit(1);
    if (row) await ensureDemoMenusFor(row, date);
  }
  const locations = await listLocations(university.id);
  const days = await db
    .select()
    .from(menuDays)
    .where(and(eq(menuDays.universityId, university.id), eq(menuDays.date, date)));
  const dayIds = days.map((d) => d.id);
  const items = dayIds.length
    ? await db
        .select({
          menuDayId: menuItems.menuDayId,
          station: menuItems.station,
          sortOrder: menuItems.sortOrder,
          id: foods.id,
          name: foods.name,
          servingAmount: foods.servingAmount,
          servingUnit: foods.servingUnit,
          official: foods.official,
          estimate: foods.estimate,
          allergens: foods.allergens,
          dietaryLabels: foods.dietaryLabels,
        })
        .from(menuItems)
        .innerJoin(foods, eq(foods.id, menuItems.foodId))
        .where(inArray(menuItems.menuDayId, dayIds))
        .orderBy(menuItems.menuDayId, menuItems.sortOrder)
    : [];

  const now = new Date();
  const views: MenuLocationView[] = locations.map((loc) => {
    const scheduled = hoursFor(loc.hours, date);
    const locDays = days.filter((d) => d.locationId === loc.id);
    const periods = new Set<MealPeriod>([...scheduled.keys(), ...locDays.map((d) => d.period)]);
    const ordered = MEAL_PERIODS.filter((p) => periods.has(p));
    const periodViews: MenuPeriodView[] = ordered.map((period) => {
      const day = locDays.find((d) => d.period === period) ?? null;
      const dayItems = day ? items.filter((i) => i.menuDayId === day.id) : [];
      const stations = new Map<string, MenuFoodCard[]>();
      for (const it of dayItems) {
        const name = it.station ?? "Menu";
        const list = stations.get(name) ?? [];
        list.push(cardFor({ ...it, station: it.station, official: it.official as Record<string, number> }));
        stations.set(name, list);
      }
      let freshness = menuFreshness(day ? { ...day, fetchedAt: day.fetchedAt } : null, now);
      if (!day && university.provider === "nutrislice" && !university.autoSync.allowed) {
        freshness = {
          state: "unavailable",
          label: "No menu data",
          detail:
            "This campus's menus are published on Nutrislice. Automatic retrieval is off on this server and no import covers this meal yet. Check the official menu link instead.",
        };
      }
      return {
        period,
        status: day?.status ?? "missing",
        scheduled: scheduled.get(period) ?? null,
        freshness,
        note: day?.note ?? null,
        stations: [...stations.entries()].map(([name, list]) => ({ name, items: list })),
        itemCount: dayItems.length,
      };
    });
    return {
      location: loc,
      periods: periodViews,
      closedAllDay: periodViews.length === 0 || periodViews.every((p) => p.status === "closed"),
    };
  });
  return { university, date, today, locations: views };
}

/* ------------------------------------------------------------------ */
/* Foods                                                              */
/* ------------------------------------------------------------------ */

export type FoodRow = typeof foods.$inferSelect;

export interface FoodDetail {
  food: FoodRow;
  nutrients: Partial<NutrientEstimates>;
  university: UniversitySummary | null;
  /** Most recent dates this version was served, up to today. */
  appearances: { date: string; period: MealPeriod; location: string }[];
  /** Upcoming dates on stored menus. */
  upcoming: { date: string; period: MealPeriod; location: string }[];
  revisions: { id: string; revision: number; firstSeen: string; lastSeen: string }[];
}

export async function getFoodDetail(id: string): Promise<FoodDetail | null> {
  await connection();
  await ensureBootstrapped();
  const db = await getDb();
  const [food] = await db.select().from(foods).where(eq(foods.id, id)).limit(1);
  if (!food) return null;
  const university = await getUniversity(food.universityId);
  const today = todayIn(university?.timezone ?? "America/Chicago");
  const base = () =>
    db
      .select({ date: menuDays.date, period: menuDays.period, location: diningLocations.name })
      .from(menuItems)
      .innerJoin(menuDays, eq(menuDays.id, menuItems.menuDayId))
      .innerJoin(diningLocations, eq(diningLocations.id, menuDays.locationId));
  const appearances = await base()
    .where(and(eq(menuItems.foodId, food.id), lte(menuDays.date, today)))
    .orderBy(desc(menuDays.date))
    .limit(8);
  const upcoming = await base()
    .where(and(eq(menuItems.foodId, food.id), gt(menuDays.date, today)))
    .orderBy(menuDays.date)
    .limit(5);
  const revisions = await db
    .select({ id: foods.id, revision: foods.revision, firstSeen: foods.firstSeen, lastSeen: foods.lastSeen })
    .from(foods)
    .where(and(eq(foods.universityId, food.universityId), eq(foods.lineageKey, food.lineageKey)))
    .orderBy(desc(foods.revision));
  return {
    food,
    nutrients: perServingNutrients({ estimate: food.estimate, official: food.official }),
    university,
    appearances,
    upcoming,
    revisions,
  };
}

export interface FoodSearchResult {
  id: string;
  name: string;
  servingLabel: string;
  energy: number | null;
  lastSeen: string;
  confidence: Confidence;
}

/** Dining-hall foods by name (latest revision of each dish). */
export async function searchMenuFoods(universityId: string, query: string, limit = 12): Promise<FoodSearchResult[]> {
  await connection();
  const q = query.trim();
  if (q.length < 2) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(foods)
    .where(and(eq(foods.universityId, universityId), ilike(foods.name, `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)))
    .orderBy(desc(foods.lastSeen), desc(foods.revision))
    .limit(80);
  const seen = new Set<string>();
  const out: FoodSearchResult[] = [];
  for (const f of rows) {
    if (seen.has(f.lineageKey)) continue;
    seen.add(f.lineageKey);
    const n = perServingNutrients({ estimate: f.estimate, official: f.official });
    out.push({
      id: f.id,
      name: f.name,
      servingLabel: servingLabel(f.servingAmount, f.servingUnit),
      energy: n.energy?.value ?? null,
      lastSeen: f.lastSeen,
      confidence: f.estimate?.overallConfidence ?? "none",
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Foods on the menu at a location for a meal (for "add item" in the optimizer). */
export async function menuItemsFor(
  universityId: string,
  date: string,
  period: MealPeriod,
  locationId: string,
): Promise<{ id: string; name: string; station: string | null; servingLabel: string; nutrients: Partial<NutrientEstimates>; confidence: Confidence; allergens: string[]; dietaryLabels: string[]; servingUnit: string | null }[]> {
  await connection();
  const db = await getDb();
  const rows = await db
    .select({
      id: foods.id,
      name: foods.name,
      station: menuItems.station,
      servingAmount: foods.servingAmount,
      servingUnit: foods.servingUnit,
      official: foods.official,
      estimate: foods.estimate,
      allergens: foods.allergens,
      dietaryLabels: foods.dietaryLabels,
    })
    .from(menuDays)
    .innerJoin(menuItems, eq(menuItems.menuDayId, menuDays.id))
    .innerJoin(foods, eq(foods.id, menuItems.foodId))
    .where(
      and(
        eq(menuDays.universityId, universityId),
        eq(menuDays.date, date),
        eq(menuDays.period, period),
        eq(menuDays.locationId, locationId),
        eq(menuDays.status, "available"),
      ),
    )
    .orderBy(menuItems.sortOrder);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    station: r.station,
    servingLabel: servingLabel(r.servingAmount, r.servingUnit),
    nutrients: perServingNutrients({ estimate: r.estimate, official: r.official }),
    confidence: r.estimate?.overallConfidence ?? "none",
    allergens: r.allergens,
    dietaryLabels: r.dietaryLabels,
    servingUnit: r.servingUnit,
  }));
}

/** Dates around today that have stored menus, for the date picker. */
export async function menuDatesAvailable(universityId: string, from: string, to: string): Promise<string[]> {
  await connection();
  const db = await getDb();
  const rows = await db
    .selectDistinct({ date: menuDays.date })
    .from(menuDays)
    .where(and(eq(menuDays.universityId, universityId), gte(menuDays.date, from), lte(menuDays.date, to), eq(menuDays.status, "available")));
  return rows.map((r) => r.date).sort();
}
