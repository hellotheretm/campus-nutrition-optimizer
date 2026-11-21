/**
 * First-use setup: writes the built-in university catalog (universities and
 * dining locations with their official hours) and, when the fictional Demo
 * University is enabled, makes sure it has generated menus around today.
 *
 * Idempotent and memoized per process. The catalog in
 * src/lib/universities/catalog.ts is the source of truth for the fields it
 * defines; edits there apply on the next start.
 */
import { and, eq, notInArray } from "drizzle-orm";
import { getDb, type Db } from "./client";
import { diningLocations, universities } from "./schema";
import { catalog, demoEnabled, type CatalogUniversity } from "@/lib/universities/catalog";

const g = globalThis as unknown as { __cnoBootstrap?: Promise<void> };

export function locationId(universityId: string, slug: string): string {
  return `${universityId}:${slug}`;
}

export async function seedCatalog(db: Db, entries: CatalogUniversity[] = catalog()): Promise<void> {
  for (const u of entries) {
    const values = {
      id: u.id,
      slug: u.slug,
      name: u.name,
      shortName: u.shortName,
      city: u.city,
      state: u.state,
      timezone: u.timezone,
      websiteUrl: u.websiteUrl,
      menuSourceUrl: u.menuSourceUrl,
      nutritionInfoUrl: u.nutritionInfoUrl,
      integrationStatus: u.integrationStatus,
      integrationNotes: u.integrationNotes,
      provider: u.provider,
      providerConfig: u.providerConfig,
      allergenNotice: u.allergenNotice,
      isDemo: u.isDemo,
      isActive: true,
    };
    const { id: _id, ...update } = values;
    await db
      .insert(universities)
      .values(values)
      .onConflictDoUpdate({ target: universities.id, set: { ...update, updatedAt: new Date() } });

    for (const [i, loc] of u.locations.entries()) {
      const row = {
        id: locationId(u.id, loc.slug),
        universityId: u.id,
        slug: loc.slug,
        name: loc.name,
        building: loc.building,
        address: loc.address,
        kind: loc.kind,
        hours: loc.hours,
        hoursSourceUrl: loc.hoursSourceUrl,
        hoursVerifiedOn: loc.hoursVerifiedOn,
        externalRef: loc.externalRef,
        sortOrder: i,
        isActive: true,
      };
      const { id: _lid, universityId: _uid, slug: _slug, ...set } = row;
      await db
        .insert(diningLocations)
        .values(row)
        .onConflictDoUpdate({ target: [diningLocations.universityId, diningLocations.slug], set });
    }
    // Catalog locations that were removed are deactivated, never deleted, so menu history stays intact.
    const slugs = u.locations.map((l) => l.slug);
    if (slugs.length) {
      await db
        .update(diningLocations)
        .set({ isActive: false })
        .where(and(eq(diningLocations.universityId, u.id), notInArray(diningLocations.slug, slugs)));
    }
  }
  if (!demoEnabled()) {
    await db.update(universities).set({ isActive: false }).where(eq(universities.isDemo, true));
  }
}

async function bootstrap(): Promise<void> {
  const db = await getDb();
  await seedCatalog(db);
  if (demoEnabled() && process.env.DEMO_AUTO_MENUS !== "false") {
    const { ensureDemoMenuWindow } = await import("@/lib/menus/sync");
    await ensureDemoMenuWindow();
  }
}

/** Call before reading catalog or menu data. Cheap after the first call. */
export function ensureBootstrapped(): Promise<void> {
  if (!g.__cnoBootstrap) {
    g.__cnoBootstrap = bootstrap().catch((err) => {
      g.__cnoBootstrap = undefined;
      throw err;
    });
  }
  return g.__cnoBootstrap;
}
