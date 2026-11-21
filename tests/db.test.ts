/**
 * Database integration tests on an in-memory PGlite (see vitest.config.mts).
 * They exercise the real migrations, including row-level security.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb, withUser } from "@/db/client";
import { seedCatalog } from "@/db/bootstrap";
import { authUser, diaryEntries, foods, menuDays, menuItems, universities } from "@/db/schema";
import { normalizeKey, submitUniversityRequest } from "@/lib/data/requests";
import { addDiaryEntry, deleteDiaryEntry, listDiary, updateDiaryEntry } from "@/lib/data/user";
import { parseImportCsv, parseImportJson } from "@/lib/menus/import-format";
import { STAPLE_STATION_SUFFIX } from "@/lib/menus/staples";
import { applyMenuDays } from "@/lib/menus/sync";
import { evaluatePlan } from "@/lib/optimizer/evaluate";
import { planRequestSchema } from "@/lib/optimizer/types";
import { pruneRateLimits, rateLimit } from "@/lib/rate-limit";
import { catalog, UW_MADISON } from "@/lib/universities/catalog";

const DATE = "2026-11-20";

beforeAll(async () => {
  const db = await getDb();
  await seedCatalog(db, catalog());
  await db.insert(authUser).values([
    { id: "user_a", name: "A", email: "a@example.test", emailVerified: true },
    { id: "user_b", name: "B", email: "b@example.test", emailVerified: true },
  ]);
});

afterAll(async () => {
  await closeDb();
});

async function uw() {
  const db = await getDb();
  const [u] = await db.select().from(universities).where(eq(universities.id, UW_MADISON.id));
  return u;
}

const SOURCE = { name: "Test fixture", obtainedFrom: "tests/db.test.ts", permission: "Synthetic test data, never shown to users" };
const UW_LOCATIONS = UW_MADISON.locations.map((l) => ({ slug: l.slug, externalRef: l.externalRef ?? null }));
const loc = UW_MADISON.locations[0].slug;

function fixture(items: { name: string; calories: number; ingredients?: string }[], date = DATE) {
  return JSON.stringify({
    format: "cno-menu-import",
    version: 1,
    university: UW_MADISON.slug,
    source: SOURCE,
    days: [
      {
        location: loc,
        date,
        period: "lunch",
        items: items.map((i) => ({ name: i.name, serving: { amount: 1, unit: "each" }, ingredients: i.ingredients, nutrients: { calories: i.calories, protein_g: 10 } })),
      },
      { location: loc, date, period: "breakfast", status: "closed" },
    ],
  });
}

describe("approved menu imports", () => {
  it("rejects files for another university, unknown locations and closed meals with items", () => {
    const ctx = { universitySlug: UW_MADISON.slug, locations: UW_LOCATIONS };
    const wrongUni = parseImportJson(fixture([{ name: "Soup", calories: 100 }]).replace(UW_MADISON.slug, "elsewhere"), ctx);
    expect(wrongUni.ok).toBe(false);
    const bad = JSON.parse(fixture([{ name: "Soup", calories: 100 }]));
    bad.days[0].location = "nowhere";
    bad.days[1].items = [{ name: "Toast" }];
    const r = parseImportJson(JSON.stringify(bad), ctx);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/unknown location/);
    expect(r.errors.join(" ")).toMatch(/closed meal cannot list items/);
  });

  it("requires a documented source and permission for CSV files", () => {
    const ctx = { universitySlug: UW_MADISON.slug, locations: UW_LOCATIONS };
    const csv = `location,date,period,name,calories,sodium_mg\n${loc},${DATE},lunch,Chili,320,780\n`;
    expect(parseImportCsv(csv, { name: "", obtainedFrom: "", permission: "" }, ctx).ok).toBe(false);
    const ok = parseImportCsv(csv, SOURCE, ctx);
    expect(ok.ok).toBe(true);
    expect(ok.days[0].items[0].official.energy).toBe(320);
    expect(ok.days[0].items[0].official.vitamin_d).toBeUndefined(); // missing stays unknown
  });
});

describe("menu sync history and dedupe", () => {
  it("reuses unchanged foods, records changes and keeps closed meals honest", async () => {
    const university = await uw();
    const ctx = { universitySlug: UW_MADISON.slug, locations: UW_LOCATIONS };
    const first = parseImportJson(fixture([{ name: "Tomato Soup", calories: 150 }, { name: "Grilled Cheese", calories: 420 }]), ctx);
    const r1 = await applyMenuDays({ university, days: first.days, source: "import", trigger: "import", importSource: first.source! });
    expect(r1.status).toBe("success");
    // UW's everyday staples (milk, yogurt, fruit) are added to every published day, imports included.
    const db = await getDb();
    const lunchItems = async () => {
      const [day] = await db
        .select()
        .from(menuDays)
        .where(and(eq(menuDays.universityId, university.id), eq(menuDays.date, DATE), eq(menuDays.period, "lunch")));
      return db.select().from(menuItems).where(eq(menuItems.menuDayId, day.id));
    };
    const staples = (await lunchItems()).filter((i) => i.station?.endsWith(STAPLE_STATION_SUFFIX)).length;
    expect(staples).toBeGreaterThan(0);
    expect(r1.stats.newFoods).toBe(2 + staples);
    expect(r1.stats.importSource?.permission).toBe(SOURCE.permission);

    const r2 = await applyMenuDays({ university, days: first.days, source: "import", trigger: "import" });
    expect(r2.stats.newFoods).toBe(0);
    expect(r2.stats.unchangedFoods).toBe(2 + staples);

    const changed = parseImportJson(fixture([{ name: "Tomato Soup", calories: 180 }, { name: "Grilled Cheese", calories: 420 }]), ctx);
    const r3 = await applyMenuDays({ university, days: changed.days, source: "import", trigger: "import" });
    expect(r3.stats.changedFoods + r3.stats.newFoods).toBeGreaterThanOrEqual(1);

    const days = await db.select().from(menuDays).where(and(eq(menuDays.universityId, university.id), eq(menuDays.date, DATE)));
    const breakfast = days.find((d) => d.period === "breakfast")!;
    expect(breakfast.status).toBe("closed");
    // A closed meal gets no staples.
    expect(await db.select().from(menuItems).where(eq(menuItems.menuDayId, breakfast.id))).toHaveLength(0);
    expect(await lunchItems()).toHaveLength(2 + staples); // replaced, not duplicated
  });

  it("never stores unknown micronutrients as zero", async () => {
    const db = await getDb();
    const [soup] = await db.select().from(foods).where(eq(foods.name, "Grilled Cheese")).limit(1);
    const vitD = soup.estimate?.nutrients.vitamin_d;
    if (vitD && vitD.value === null) expect(vitD.provenance).toBe("unknown");
    if (vitD && vitD.value === 0) expect(vitD.provenance).not.toBe("unknown");
    expect(soup.official.energy).toBe(420);
  });
});

describe("row-level security", () => {
  it("keeps each user's diary private", async () => {
    const entry = await addDiaryEntry("user_a", {
      kind: "custom",
      name: "Apple",
      servings: 1,
      nutrients: { energy: 95 },
      date: DATE,
      meal: "snack",
    });
    expect(await listDiary("user_a", DATE, DATE)).toHaveLength(1);
    expect(await listDiary("user_b", DATE, DATE)).toHaveLength(0);

    // User B cannot see, change or delete A's entry even by id.
    const seen = await withUser("user_b", (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.id, entry.id)));
    expect(seen).toHaveLength(0);
    expect(await updateDiaryEntry("user_b", entry.id, { servings: 3 })).toBeNull();
    expect(await deleteDiaryEntry("user_b", entry.id)).toBe(false);

    // A raw query as the app role, without the user filter, is still limited by policy.
    const all = await withUser("user_b", (tx) => tx.execute(sql`select count(*)::int as n from diary_entries`));
    expect(Number((all as unknown as { rows: { n: number }[] }).rows[0].n)).toBe(0);

    // Inserting a row for someone else is refused.
    await expect(
      withUser("user_b", (tx) =>
        tx.insert(diaryEntries).values({ id: "x", userId: "user_a", date: DATE, meal: "snack", name: "Forged", servings: 1, servingLabel: "1", nutrients: {} as never }),
      ),
    ).rejects.toThrow();
  });
});

describe("university requests", () => {
  it("normalizes names for duplicate detection", () => {
    expect(normalizeKey("Univ. of Minnesota, Twin Cities")).toBe(normalizeKey("University of Minnesota Twin Cities"));
    expect(normalizeKey("Texas A&M")).toBe(normalizeKey("texas a and m"));
    expect(normalizeKey("Université de Montréal")).toBe("universite de montreal");
  });

  it("merges duplicates into supporters and recognizes supported campuses", async () => {
    const first = await submitUniversityRequest({ universityName: "Univ. of Minnesota, Twin Cities" }, null);
    expect(first.kind).toBe("created");
    const second = await submitUniversityRequest({ universityName: "University of Minnesota Twin Cities", menuUrl: "https://example.edu/menus" }, "user_b");
    expect(second).toMatchObject({ kind: "supported", supporters: 2 });
    const exists = await submitUniversityRequest({ universityName: "UW-Madison" }, null);
    expect(exists).toMatchObject({ kind: "exists", slug: UW_MADISON.slug });
    await expect(submitUniversityRequest({ universityName: "X", websiteUrl: "javascript:alert(1)" }, null)).rejects.toThrow();
  });
});

describe("rate limiting", () => {
  it("allows up to the limit within a window", async () => {
    const key = `test:${Date.now()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await rateLimit(key, 3, 60)).ok);
    expect(results).toEqual([true, true, true, false]);
    await pruneRateLimits(); // fresh windows survive pruning
    expect((await rateLimit(key, 3, 60)).ok).toBe(false);
  });
});

describe("plan evaluation", () => {
  it("rebuilds a saved plan from stored menu data only", async () => {
    const db = await getDb();
    const [cheese] = await db.select().from(foods).where(eq(foods.name, "Grilled Cheese")).limit(1);
    const req = planRequestSchema.parse({ universityId: UW_MADISON.id, date: DATE, meals: [{ period: "lunch" }] });
    const result = await evaluatePlan(
      req,
      [
        {
          period: "lunch",
          locationId: null,
          items: [
            { foodId: cheese.id, servings: 2, locked: true },
            { foodId: "food_that_is_not_on_the_menu", servings: 1, locked: false },
          ],
        },
      ],
      null,
      true,
    );
    expect(result.edited).toBe(true);
    const items = result.meals[0].items;
    expect(items.map((i) => i.name)).toEqual(["Grilled Cheese"]);
    expect(items[0].servings).toBe(2);
    expect(result.warnings.join(" ")).toMatch(/no longer on the stored menu/);
    expect(result.energy.value).toBeCloseTo(840, 0);
  });
});
