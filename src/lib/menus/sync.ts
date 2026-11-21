/**
 * Menu sync engine.
 *
 * Stores normalized menu days from any provider (demo generator, approved
 * import, authorized connector):
 *  - foods are deduplicated by a content hash; a changed recipe for the same
 *    dish becomes a new revision in the same lineage, so history is kept;
 *  - a menu day's items are replaced only when its content changed;
 *  - every run is recorded in sync_runs with counts and warnings;
 *  - failures never delete what was stored before (it stays visible as cached).
 * Nutrient estimates are computed once per food revision and tagged with the
 * estimator version, so they can be recomputed when the method improves.
 */
import { createHash } from "node:crypto";
import { and, eq, gte, isNull, lte, max, ne, or, sql } from "drizzle-orm";
import { getDb, newId, type Db } from "@/db/client";
import {
  diningLocations,
  foods,
  menuDays,
  menuItems,
  syncRuns,
  universities,
  type MenuProviderKind,
  type SyncStats,
} from "@/db/schema";
import { addDays, dateRange, diffDays, todayIn } from "@/lib/dates";
import { withStaples } from "./staples";
import { ESTIMATOR_VERSION, estimateNutrition, type EstimationResult } from "@/lib/nutrition/estimator";
import { getProvider } from "./providers";
import type { LocationRow, NormalizedMenuDay, NormalizedMenuItem, UniversityRow } from "./types";

export type SyncTrigger = "cron" | "manual" | "import" | "bootstrap" | "on_demand";

export interface SyncResult {
  runId: string | null;
  status: "success" | "partial" | "failed" | "skipped";
  stats: SyncStats;
  error?: string;
}

function emptyStats(): SyncStats {
  return {
    days: 0,
    closed: 0,
    items: 0,
    newFoods: 0,
    changedFoods: 0,
    unchangedFoods: 0,
    changedDays: 0,
    estimated: 0,
    warnings: [],
  };
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sortedObject<T>(obj: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

export function foodContentHash(item: NormalizedMenuItem): string {
  const canonical = JSON.stringify({
    name: item.name.trim(),
    description: item.description?.trim() || null,
    servingAmount: item.servingAmount ?? null,
    servingUnit: item.servingUnit?.trim().toLowerCase() || null,
    servingGrams: item.servingGrams ?? null,
    official: sortedObject(item.official as Record<string, number>),
    ingredients: item.ingredients?.trim() || null,
    allergens: [...item.allergens].sort(),
    dietaryLabels: [...item.dietaryLabels].sort(),
    // Only present when set, so hashes of ordinary menu items are unchanged.
    ...(item.fdcId ? { fdcId: item.fdcId } : {}),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 40);
}

function dayContentHash(day: NormalizedMenuDay, foodIds: { foodId: string; station: string | null }[]): string {
  const canonical = JSON.stringify({
    status: day.status,
    note: day.note ?? null,
    items: foodIds.map((f) => [f.foodId, f.station ?? ""]),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 40);
}

async function estimateFor(item: NormalizedMenuItem): Promise<EstimationResult | null> {
  try {
    return await estimateNutrition({
      name: item.name,
      servingAmount: item.servingAmount,
      servingUnit: item.servingUnit,
      servingGrams: item.servingGrams,
      official: item.official,
      ingredients: item.ingredients,
      fdcIdOverride: item.fdcId ?? null,
    });
  } catch (e) {
    console.error(`[sync] estimate failed for "${item.name}":`, e);
    return null;
  }
}

interface FoodCacheEntry {
  id: string;
}

async function upsertFood(
  db: Db,
  universityId: string,
  item: NormalizedMenuItem,
  date: string,
  stats: SyncStats,
  cache: Map<string, FoodCacheEntry>,
): Promise<string> {
  const hash = foodContentHash(item);
  const cached = cache.get(hash);
  if (cached) {
    await touchFood(db, cached.id, date);
    return cached.id;
  }
  const existing = await db
    .select({ id: foods.id })
    .from(foods)
    .where(and(eq(foods.universityId, universityId), eq(foods.contentHash, hash)))
    .limit(1);
  if (existing[0]) {
    stats.unchangedFoods++;
    await touchFood(db, existing[0].id, date);
    cache.set(hash, { id: existing[0].id });
    return existing[0].id;
  }
  const normalized = normalizeName(item.name);
  const lineageKey = normalized;
  const [prev] = await db
    .select({ rev: max(foods.revision) })
    .from(foods)
    .where(and(eq(foods.universityId, universityId), eq(foods.lineageKey, lineageKey)));
  const revision = (prev?.rev ?? 0) + 1;
  if (revision > 1) stats.changedFoods++;
  else stats.newFoods++;

  const estimate = await estimateFor(item);
  if (estimate) stats.estimated++;
  else stats.warnings.push(`Could not estimate nutrients for "${item.name}".`);

  const id = newId("food");
  const inserted = await db
    .insert(foods)
    .values({
      id,
      universityId,
      lineageKey,
      revision,
      name: item.name.trim(),
      normalizedName: normalized,
      description: item.description ?? null,
      station: item.station ?? null,
      servingAmount: item.servingAmount ?? null,
      servingUnit: item.servingUnit ?? null,
      servingGrams: item.servingGrams ?? null,
      official: item.official,
      ingredients: item.ingredients ?? null,
      allergens: item.allergens,
      dietaryLabels: item.dietaryLabels,
      sourceRef: item.sourceRef ?? null,
      fdcOverride: item.fdcId ?? null,
      contentHash: hash,
      estimate,
      estimateVersion: estimate ? ESTIMATOR_VERSION : null,
      estimatedAt: estimate ? new Date() : null,
      firstSeen: date,
      lastSeen: date,
    })
    .onConflictDoNothing()
    .returning({ id: foods.id });
  let foodId = inserted[0]?.id;
  if (!foodId) {
    // Another sync inserted the same content concurrently.
    const again = await db
      .select({ id: foods.id })
      .from(foods)
      .where(and(eq(foods.universityId, universityId), eq(foods.contentHash, hash)))
      .limit(1);
    foodId = again[0].id;
  }
  cache.set(hash, { id: foodId });
  return foodId;
}

async function touchFood(db: Db, id: string, date: string): Promise<void> {
  await db
    .update(foods)
    .set({
      lastSeen: sql`greatest(${foods.lastSeen}, ${date}::date)`,
      firstSeen: sql`least(${foods.firstSeen}, ${date}::date)`,
    })
    .where(eq(foods.id, id));
}

async function writeDay(
  db: Db,
  university: UniversityRow,
  location: LocationRow,
  day: NormalizedMenuDay,
  source: MenuProviderKind,
  runId: string,
  stats: SyncStats,
  cache: Map<string, FoodCacheEntry>,
): Promise<void> {
  stats.days++;
  if (day.status === "closed") stats.closed++;
  const resolved: { foodId: string; station: string | null }[] = [];
  for (const item of day.items) {
    const foodId = await upsertFood(db, university.id, item, day.date, stats, cache);
    resolved.push({ foodId, station: item.station ?? null });
  }
  stats.items += resolved.length;
  const hash = dayContentHash(day, resolved);
  const [existing] = await db
    .select({ id: menuDays.id, contentHash: menuDays.contentHash })
    .from(menuDays)
    .where(and(eq(menuDays.locationId, location.id), eq(menuDays.date, day.date), eq(menuDays.period, day.period)))
    .limit(1);
  const now = new Date();
  if (existing && existing.contentHash === hash) {
    await db.update(menuDays).set({ fetchedAt: now, syncRunId: runId, source }).where(eq(menuDays.id, existing.id));
    return;
  }
  stats.changedDays++;
  await db.transaction(async (tx) => {
    let dayId: number;
    if (existing) {
      dayId = existing.id;
      await tx
        .update(menuDays)
        .set({ status: day.status, source, contentHash: hash, fetchedAt: now, syncRunId: runId, note: day.note ?? null })
        .where(eq(menuDays.id, dayId));
      await tx.delete(menuItems).where(eq(menuItems.menuDayId, dayId));
    } else {
      const [row] = await tx
        .insert(menuDays)
        .values({
          universityId: university.id,
          locationId: location.id,
          date: day.date,
          period: day.period,
          status: day.status,
          source,
          contentHash: hash,
          fetchedAt: now,
          syncRunId: runId,
          note: day.note ?? null,
        })
        .returning({ id: menuDays.id });
      dayId = row.id;
    }
    if (resolved.length) {
      await tx.insert(menuItems).values(
        resolved.map((r, i) => ({ menuDayId: dayId, foodId: r.foodId, station: r.station, sortOrder: i })),
      );
    }
  });
}

async function recordFailures(
  db: Db,
  university: UniversityRow,
  locations: LocationRow[],
  failures: { location: string; date: string; period?: string; error: string }[],
  source: MenuProviderKind,
  runId: string,
): Promise<void> {
  for (const f of failures) {
    const loc = locations.find((l) => l.slug === f.location);
    if (!loc || !f.period) continue;
    // Keep any stored menu (shown as cached); only record the error where nothing exists.
    await db
      .insert(menuDays)
      .values({
        universityId: university.id,
        locationId: loc.id,
        date: f.date,
        period: f.period as NormalizedMenuDay["period"],
        status: "error",
        source,
        contentHash: null,
        syncRunId: runId,
        note: `Could not retrieve: ${f.error}`.slice(0, 300),
      })
      .onConflictDoNothing();
  }
}

export interface ApplyOptions {
  university: UniversityRow;
  days: NormalizedMenuDay[];
  source: MenuProviderKind;
  trigger: SyncTrigger;
  triggeredBy?: string | null;
  from?: string;
  to?: string;
  failures?: { location: string; date: string; period?: string; error: string }[];
  warnings?: string[];
  importSource?: SyncStats["importSource"];
}

/** Writes already-normalized days (from a provider or an approved import). */
export async function applyMenuDays(opts: ApplyOptions): Promise<SyncResult> {
  const db = await getDb();
  const stats = emptyStats();
  stats.warnings.push(...(opts.warnings ?? []));
  if (opts.importSource) stats.importSource = opts.importSource;
  const dates = opts.days.map((d) => d.date).sort();
  const runId = newId("sync");
  await db.insert(syncRuns).values({
    id: runId,
    universityId: opts.university.id,
    provider: opts.source,
    trigger: opts.trigger,
    status: "running",
    dateFrom: opts.from ?? dates[0] ?? null,
    dateTo: opts.to ?? dates[dates.length - 1] ?? null,
    triggeredBy: opts.triggeredBy ?? null,
  });
  try {
    const locations = await db
      .select()
      .from(diningLocations)
      .where(eq(diningLocations.universityId, opts.university.id));
    const bySlug = new Map<string, LocationRow>();
    for (const l of locations) {
      bySlug.set(l.slug, l);
      if (l.externalRef) bySlug.set(l.externalRef, l);
    }
    const cache = new Map<string, FoodCacheEntry>();
    // Foods the market serves every day but doesn't post (see staples.ts).
    const days = withStaples(opts.university.id, opts.days, (ref) => bySlug.get(ref)?.slug ?? null);
    for (const day of days) {
      const loc = bySlug.get(day.location);
      if (!loc) {
        stats.warnings.push(`Unknown location "${day.location}" on ${day.date}; skipped.`);
        continue;
      }
      await writeDay(db, opts.university, loc, day, opts.source, runId, stats, cache);
    }
    const failures = opts.failures ?? [];
    if (failures.length) {
      await recordFailures(db, opts.university, locations, failures, opts.source, runId);
      stats.warnings.push(`${failures.length} location/date combinations could not be retrieved; earlier data was kept.`);
    }
    const status: SyncResult["status"] =
      failures.length || stats.warnings.some((w) => w.startsWith("Unknown location")) ? "partial" : "success";
    stats.warnings = stats.warnings.slice(0, 100);
    await db
      .update(syncRuns)
      .set({ status, stats, finishedAt: new Date() })
      .where(eq(syncRuns.id, runId));
    return { runId, status, stats };
  } catch (e) {
    const message = (e as Error).message;
    await db
      .update(syncRuns)
      .set({ status: "failed", stats, error: message.slice(0, 2000), finishedAt: new Date() })
      .where(eq(syncRuns.id, runId));
    return { runId, status: "failed", stats, error: message };
  }
}

/** Retrieves and stores menus from the university's provider, if retrieval is allowed. */
export async function syncFromProvider(opts: {
  universityId: string;
  from: string;
  to: string;
  trigger: SyncTrigger;
  triggeredBy?: string | null;
}): Promise<SyncResult> {
  const db = await getDb();
  const [university] = await db.select().from(universities).where(eq(universities.id, opts.universityId)).limit(1);
  if (!university) throw new Error(`Unknown university ${opts.universityId}`);
  const provider = getProvider(university.provider);
  const permission = provider.autoSync(university);
  if (!permission.allowed) {
    return { runId: null, status: "skipped", stats: emptyStats(), error: permission.reason };
  }
  const locations = await db
    .select()
    .from(diningLocations)
    .where(and(eq(diningLocations.universityId, university.id), eq(diningLocations.isActive, true)));
  try {
    const result = await provider.fetchRange({ university, locations, from: opts.from, to: opts.to });
    return applyMenuDays({
      university,
      days: result.days,
      source: provider.kind,
      trigger: opts.trigger,
      triggeredBy: opts.triggeredBy,
      from: opts.from,
      to: opts.to,
      failures: result.failures,
      warnings: result.warnings,
    });
  } catch (e) {
    const runId = newId("sync");
    const message = (e as Error).message;
    await db.insert(syncRuns).values({
      id: runId,
      universityId: university.id,
      provider: provider.kind,
      trigger: opts.trigger,
      status: "failed",
      dateFrom: opts.from,
      dateTo: opts.to,
      error: message.slice(0, 2000),
      triggeredBy: opts.triggeredBy ?? null,
      finishedAt: new Date(),
    });
    return { runId, status: "failed", stats: emptyStats(), error: message };
  }
}

/* ------------------------------------------------------------------ */
/* Demo University: keep generated menus around today                  */
/* ------------------------------------------------------------------ */

const DEMO_PAST_DAYS = 7;
const DEMO_FUTURE_DAYS = 14;
const DEMO_MAX_DISTANCE = 120;

const inflight = new Map<string, Promise<void>>();

async function demoCoverage(db: Db, universityId: string, from: string, to: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ date: menuDays.date })
    .from(menuDays)
    .where(and(eq(menuDays.universityId, universityId), gte(menuDays.date, from), lte(menuDays.date, to)));
  return new Set(rows.map((r) => r.date));
}

async function fillDemo(university: UniversityRow, from: string, to: string): Promise<void> {
  const key = `${university.id}|${from}|${to}`;
  const running = inflight.get(key);
  if (running) return running;
  const job = (async () => {
    const db = await getDb();
    const covered = await demoCoverage(db, university.id, from, to);
    const missing = dateRange(from, to).filter((d) => !covered.has(d));
    if (!missing.length) return;
    const locations = await db
      .select()
      .from(diningLocations)
      .where(and(eq(diningLocations.universityId, university.id), eq(diningLocations.isActive, true)));
    const result = await getProvider("demo").fetchRange({
      university,
      locations,
      from: missing[0],
      to: missing[missing.length - 1],
    });
    const wanted = new Set(missing);
    await applyMenuDays({
      university,
      days: result.days.filter((d) => wanted.has(d.date)),
      source: "demo",
      trigger: "on_demand",
      from: missing[0],
      to: missing[missing.length - 1],
    });
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** Generates Demo University menus for the window around today when missing. */
export async function ensureDemoMenuWindow(): Promise<void> {
  const db = await getDb();
  const demos = await db
    .select()
    .from(universities)
    .where(and(eq(universities.isDemo, true), eq(universities.isActive, true)));
  for (const u of demos) {
    const today = todayIn(u.timezone);
    await fillDemo(u, addDays(today, -DEMO_PAST_DAYS), addDays(today, DEMO_FUTURE_DAYS));
  }
}

/** Makes sure a specific demo date exists (for browsing beyond the default window). */
export async function ensureDemoMenusFor(university: UniversityRow, date: string): Promise<void> {
  if (!university.isDemo || !university.isActive) return;
  const today = todayIn(university.timezone);
  if (Math.abs(diffDays(today, date)) > DEMO_MAX_DISTANCE) return;
  await fillDemo(university, date, date);
}

/* ------------------------------------------------------------------ */
/* Re-estimation after estimator upgrades                              */
/* ------------------------------------------------------------------ */

export async function reestimateOutdated(limit = 100): Promise<{ updated: number; remaining: number }> {
  const db = await getDb();
  const stale = or(isNull(foods.estimateVersion), ne(foods.estimateVersion, ESTIMATOR_VERSION));
  const rows = await db.select().from(foods).where(stale).limit(limit);
  let updated = 0;
  for (const f of rows) {
    const estimate = await estimateFor({
      name: f.name,
      servingAmount: f.servingAmount,
      servingUnit: f.servingUnit,
      servingGrams: f.servingGrams,
      official: f.official,
      ingredients: f.ingredients,
      allergens: f.allergens,
      dietaryLabels: f.dietaryLabels,
      fdcId: f.fdcOverride,
    });
    if (!estimate) continue;
    await db
      .update(foods)
      .set({ estimate, estimateVersion: ESTIMATOR_VERSION, estimatedAt: new Date(), updatedAt: new Date() })
      .where(eq(foods.id, f.id));
    updated++;
  }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(foods).where(stale);
  return { updated, remaining: count };
}

/** Sync window used by the scheduled job. */
export function scheduledWindow(timezone: string): { from: string; to: string } {
  const today = todayIn(timezone);
  return { from: addDays(today, -1), to: addDays(today, 7) };
}

export async function syncAllScheduled(): Promise<{ university: string; result: SyncResult }[]> {
  const db = await getDb();
  const rows = await db.select().from(universities).where(eq(universities.isActive, true));
  const out: { university: string; result: SyncResult }[] = [];
  for (const u of rows) {
    if (u.isDemo) {
      await ensureDemoMenuWindow();
      continue;
    }
    const permission = getProvider(u.provider).autoSync(u);
    if (!permission.allowed) continue;
    const { from, to } = scheduledWindow(u.timezone);
    out.push({ university: u.slug, result: await syncFromProvider({ universityId: u.id, from, to, trigger: "cron" }) });
  }
  return out;
}

