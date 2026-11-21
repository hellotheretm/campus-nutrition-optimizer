import { afterEach, describe, expect, it, vi } from "vitest";
import { menuFreshness } from "@/lib/menus/freshness";
import { locationMapFromSchools, nutrisliceAutoSync, parseAmount, parseNutrisliceWeek } from "@/lib/menus/nutrislice";
import { estimateNutrition } from "@/lib/nutrition/estimator";
import { UW_MADISON } from "@/lib/universities/catalog";
import type { UniversityRow } from "@/lib/menus/types";

/** Synthetic document shaped like a Nutrislice week response (no real menu data). */
const WEEK = {
  days: [
    {
      date: "2026-11-16",
      menu_items: [
        { is_station_header: true, text: "Grill" },
        {
          food: {
            id: 101,
            name: "Test Burger",
            description: "Synthetic item",
            ingredients: "Beef, Bun (Wheat Flour, Water, Yeast), Salt",
            serving_size_info: { serving_size_amount: "1", serving_size_unit: "each" },
            rounded_nutrition_info: { calories: 540, g_protein: 28, mg_sodium: 820, g_fat: 30, g_carbs: 38 },
            icons: { food_icons: [{ synced_name: "Wheat" }, { synced_name: "Halal" }] },
          },
        },
        { is_station_header: true, text: "Salad Bar" },
        { food: { id: 102, name: "Test Greens", serving_size_info: { serving_size_amount: "1 1/2", serving_size_unit: "cup" }, rounded_nutrition_info: {} } },
        { food: { name: "" } },
      ],
    },
    { date: "2026-11-17", menu_items: [] },
    { date: "2026-11-30", menu_items: [{ food: { id: 103, name: "Out of range" } }] },
    { date: "not-a-date", menu_items: [] },
  ],
};

describe("Nutrislice parsing", () => {
  it("normalizes items, stations, servings and published nutrition", () => {
    const days = parseNutrisliceWeek(WEEK, { location: "test-hall", period: "lunch", from: "2026-11-16", to: "2026-11-20" });
    expect(days.map((d) => d.date)).toEqual(["2026-11-16", "2026-11-17"]);
    const [burger, greens] = days[0].items;
    expect(burger.station).toBe("Grill");
    expect(burger.official.energy).toBe(540);
    expect(burger.official.sodium).toBe(820);
    expect(burger.servingAmount).toBe(1);
    expect(burger.sourceRef).toBe("nutrislice:food:101");
    expect(greens.station).toBe("Salad Bar");
    expect(greens.servingAmount).toBe(1.5);
    expect(Object.keys(greens.official)).toHaveLength(0); // nothing published → nothing invented
    expect(days[0].items).toHaveLength(2); // nameless entry skipped
  });

  it("marks a listed day without items as 'no data', never as an empty real menu", () => {
    const [, empty] = parseNutrisliceWeek(WEEK, { location: "x", period: "dinner", from: "2026-11-16", to: "2026-11-20" });
    expect(empty.status).toBe("no_data");
    expect(empty.items).toEqual([]);
  });

  it("parses serving fractions", () => {
    expect(parseAmount("1/2")).toBe(0.5);
    expect(parseAmount("2 1/4")).toBe(2.25);
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount(0)).toBeNull();
  });

  const uwRow = { ...UW_MADISON, isActive: true, createdAt: new Date(), updatedAt: new Date() } as unknown as UniversityRow;
  afterEach(() => vi.unstubAllEnvs());

  it("keeps automatic retrieval off unless an operator turns it on", () => {
    vi.stubEnv("NUTRISLICE_SYNC_ENABLED", "");
    vi.stubEnv("NUTRISLICE_SYNC_AUTHORIZED", "");
    expect(nutrisliceAutoSync(uwRow).allowed).toBe(false);
  });

  it("labels an operator-enabled sync without an agreement as unofficial", () => {
    vi.stubEnv("NUTRISLICE_SYNC_ENABLED", "true");
    vi.stubEnv("NUTRISLICE_SYNC_AUTHORIZED", "");
    const status = nutrisliceAutoSync(uwRow);
    expect(status).toMatchObject({ allowed: true, mode: "unofficial" });
    expect(status.reason).toMatch(/without an agreement/i);
  });

  it("reports an authorized feed only when a reference is recorded", () => {
    vi.stubEnv("NUTRISLICE_SYNC_AUTHORIZED", "true");
    vi.stubEnv("NUTRISLICE_AUTHORIZATION_REF", "");
    vi.stubEnv("NUTRISLICE_SYNC_ENABLED", "");
    expect(nutrisliceAutoSync(uwRow).allowed).toBe(false);
    vi.stubEnv("NUTRISLICE_AUTHORIZATION_REF", "Agreement #1, 2026-11-20");
    expect(nutrisliceAutoSync(uwRow).mode).toBe("authorized");
  });

  it("takes station names from menu_info and drops ordering placeholders", () => {
    const doc = {
      days: [
        {
          date: "2026-11-16",
          menu_info: { "7": { section_options: { display_name: "Test Station" } } },
          menu_items: [
            { menu_id: 7, food: { id: 1, name: "Test Soup", serving_size_info: { serving_size_amount: "1", serving_size_unit: "6 oz" } } },
            { menu_id: 7, food: { id: 2, name: "Test Wrap OrderIt" } },
            { menu_id: 99, food: { id: 3, name: "Unlisted Station Item" } },
          ],
        },
      ],
    };
    const [day] = parseNutrisliceWeek(doc, { location: "x", period: "lunch" });
    expect([day.items[0].servingAmount, day.items[0].servingUnit]).toEqual([6, "oz"]); // "1" × "6 oz" → 6 oz
    expect(day.items.map((i) => [i.name, i.station])).toEqual([
      ["Test Soup", "Test Station"],
      ["Unlisted Station Item", null],
    ]);
  });

  it("discovers locations and meal types from the provider's school list", () => {
    const schools = [
      { slug: "hall-a", active_menu_types: [{ slug: "breakfast" }, { slug: "lunch" }, { slug: "special-event" }] },
      { slug: "hall-b", active_menu_types: [{ slug: "dinner" }] },
      { slug: "hall-c", active_menu_types: [{ slug: "special-event" }] },
    ];
    const map = locationMapFromSchools(schools, [
      { slug: "a", externalRef: "hall-a" },
      { slug: "hall-b", externalRef: null },
      { slug: "c", externalRef: "hall-c" },
      { slug: "missing", externalRef: "nowhere" },
    ]);
    expect(map).toEqual({
      a: { school: "hall-a", menuTypes: { breakfast: "breakfast", lunch: "lunch" } },
      "hall-b": { school: "hall-b", menuTypes: { dinner: "dinner" } },
    });
  });
});

describe("menu freshness labels", () => {
  const now = new Date("2026-11-20T18:00:00Z");
  it("labels current, cached and unavailable menus", () => {
    expect(menuFreshness(null, now).state).toBe("unavailable");
    expect(menuFreshness({ status: "available", fetchedAt: new Date("2026-11-20T12:00:00Z"), source: "nutrislice" }, now).state).toBe("current");
    expect(menuFreshness({ status: "available", fetchedAt: new Date("2026-11-17T12:00:00Z"), source: "nutrislice" }, now).state).toBe("cached");
    expect(menuFreshness({ status: "no_data", fetchedAt: now, source: "nutrislice" }, now).label).toBe("Not published");
    expect(menuFreshness({ status: "error", fetchedAt: now, source: "nutrislice" }, now).state).toBe("unavailable");
  });
});

describe("micronutrient estimation (USDA FoodData Central)", () => {
  it("keeps published values as official and estimates micronutrients with provenance and a range", async () => {
    const r = await estimateNutrition({ name: "Banana", servingAmount: 1, servingUnit: "each", official: { energy: 110, carbohydrate: 28 } });
    expect(r.nutrients.energy.provenance).toBe("official");
    expect(r.nutrients.energy.value).toBe(110);
    const k = r.nutrients.potassium;
    expect(["usda_match", "usda_recipe", "approximate"]).toContain(k.provenance);
    expect(k.value).toBeGreaterThan(0);
    expect(k.low!).toBeLessThanOrEqual(k.value!);
    expect(k.high!).toBeGreaterThanOrEqual(k.value!);
    expect(r.matches.length).toBeGreaterThan(0);
  });

  it("reports unknown instead of zero when nothing can be matched", async () => {
    const r = await estimateNutrition({ name: "Zqxv Special", official: { energy: 300 } });
    const vitD = r.nutrients.vitamin_d;
    expect(vitD.value).toBeNull();
    expect(vitD.provenance).toBe("unknown");
    expect(vitD.confidence).toBe("none");
    expect(r.nutrients.energy.value).toBe(300);
  });

  it("uses the ingredient list for prepared dishes and says how much of it matched", async () => {
    const r = await estimateNutrition({
      name: "Vegetable Stir Fry",
      servingAmount: 1,
      servingUnit: "cup",
      official: { energy: 220, protein: 8, fat: 9, carbohydrate: 28, sodium: 640 },
      ingredients: "Broccoli, Carrots, Tofu (Soybeans, Water, Calcium Sulfate), Soy Sauce (Water, Wheat, Soybeans, Salt), Canola Oil, Garlic",
    });
    expect(r.method === "recipe" || r.method === "direct_match" || r.method === "comparable").toBe(true);
    expect(r.explanation.length).toBeGreaterThan(0);
    if (r.method === "recipe") expect(r.ingredientCoverage).toBeGreaterThan(0);
    // Published sodium stays the official figure.
    expect(r.nutrients.sodium.value).toBe(640);
    expect(r.nutrients.sodium.provenance).toBe("official");
  });
});

describe("always-available staples", async () => {
  const { withStaples, UW_MADISON_STAPLES } = await import("@/lib/menus/staples");
  const day = (location: string, period: "breakfast" | "lunch" | "dinner", status: "available" | "no_data" | "closed", names: string[] = ["Posted Dish"]) => ({
    location,
    date: "2026-11-20",
    period,
    status,
    items: names.map((name) => ({ name, official: {}, allergens: [], dietaryLabels: [] })),
    note: null,
  });
  const resolve = (s: string) => s;

  it("adds market-wide staples to published meals only, and salad-bar staples only where reported", () => {
    const out = withStaples("uw-madison", [
      day("four-lakes-market", "lunch", "available"),
      day("four-lakes-market", "breakfast", "available"),
      day("gordon-avenue-market", "dinner", "available", ["Posted Dish", "Banana"]),
      day("carsons-market", "lunch", "no_data", []),
      day("lizs-market", "dinner", "closed", []),
    ], resolve);
    const names = (i: number) => out[i].items.map((x) => x.name);
    expect(names(0)).toEqual(expect.arrayContaining(["Skim Milk", "Banana", "Sunflower Seeds", "Fresh Spinach", "Hard-Boiled Egg"]));
    expect(names(1)).toContain("Chocolate Milk");
    expect(names(1)).not.toContain("Sunflower Seeds"); // salad bar is lunch and dinner only
    expect(names(2)).not.toContain("Fresh Spinach"); // Four Lakes only
    expect(names(2).filter((n) => n === "Banana")).toHaveLength(1); // already posted → not duplicated
    expect(out[3].items).toEqual([]); // nothing published → nothing added
    expect(out[4].items).toEqual([]);
    const staple = out[0].items.find((x) => x.name === "Skim Milk")!;
    expect(staple.station).toMatch(/always available/);
    expect(staple.description).toMatch(/not on the posted menu/);
    expect(staple.allergens).toEqual(["milk"]);
  });

  it("leaves universities without staples untouched", () => {
    const days = [day("hall", "lunch", "available")];
    expect(withStaples("demo-university", days, resolve)).toBe(days);
  });

  it("estimates a staple fully from its USDA food and portion", async () => {
    const banana = UW_MADISON_STAPLES.find((s) => s.key === "banana")!;
    const r = await estimateNutrition({ name: banana.name, servingAmount: 1, servingUnit: banana.servingUnit, servingGrams: banana.servingGrams, official: {}, fdcIdOverride: banana.fdcId });
    expect(r.nutrients.energy.value).toBeGreaterThan(95);
    expect(r.nutrients.energy.value).toBeLessThan(115); // USDA: ~105 kcal for a 118 g banana
    expect(r.nutrients.potassium.value).toBeGreaterThan(380);
    expect(r.nutrients.protein.value).toBeGreaterThan(1);
  });
});
