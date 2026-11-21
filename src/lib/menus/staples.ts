/**
 * Always-available staples: foods a dining market serves every day that its
 * posted menu doesn't list (milk at the beverage station, whole fruit, salad-bar
 * toppings). They come from the site operator's own knowledge of the campus,
 * not from the menu source, so they are labeled that way everywhere.
 *
 * Staples are added only to meals whose menu was actually published (status
 * "available"), so a closed market or an unpublished meal never gains items.
 * An item the source already lists under the same name is not duplicated.
 *
 * Nutrition comes from one chosen USDA FoodData Central food and a standard
 * USDA portion (the market's actual scoop or cup may differ).
 */
import type { MealPeriod } from "@/db/schema";
import type { NormalizedMenuDay, NormalizedMenuItem } from "./types";

export interface Staple {
  key: string;
  name: string;
  /** USDA FoodData Central food used for nutrition. */
  fdcId: number;
  usdaDescription: string;
  servingAmount: number;
  servingUnit: string;
  servingGrams: number;
  /** Location slugs, or "all" for every market. */
  locations: "all" | string[];
  /** Meals it's available at; omitted means every meal the market serves. */
  periods?: MealPeriod[];
  station: string;
  allergens: string[];
  dietaryLabels: string[];
}

export const STAPLE_STATION_SUFFIX = "(always available)";

const EVERY_MARKET = "all" as const;

/** Reported by the project owner (a UW–Madison student), November 2026. */
export const UW_MADISON_STAPLES: Staple[] = [
  { key: "skim-milk", name: "Skim Milk", fdcId: 171269, usdaDescription: "Milk, nonfat, fluid, with added vitamin A and vitamin D", servingAmount: 1, servingUnit: "cup", servingGrams: 245, locations: EVERY_MARKET, station: "Milk", allergens: ["milk"], dietaryLabels: ["vegetarian"] },
  { key: "2-percent-milk", name: "2% Milk", fdcId: 171267, usdaDescription: "Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D", servingAmount: 1, servingUnit: "cup", servingGrams: 244, locations: EVERY_MARKET, station: "Milk", allergens: ["milk"], dietaryLabels: ["vegetarian"] },
  { key: "chocolate-milk", name: "Chocolate Milk", fdcId: 170881, usdaDescription: "Milk, chocolate, lowfat, with added vitamin A and vitamin D", servingAmount: 1, servingUnit: "cup", servingGrams: 250, locations: EVERY_MARKET, station: "Milk", allergens: ["milk"], dietaryLabels: ["vegetarian"] },
  { key: "nonfat-greek-yogurt", name: "Non-Fat Plain Greek Yogurt", fdcId: 330137, usdaDescription: "Yogurt, Greek, plain, nonfat", servingAmount: 6, servingUnit: "oz", servingGrams: 170, locations: EVERY_MARKET, station: "Yogurt", allergens: ["milk"], dietaryLabels: ["vegetarian"] },
  { key: "banana", name: "Banana", fdcId: 173944, usdaDescription: "Bananas, raw (1 medium)", servingAmount: 1, servingUnit: "medium", servingGrams: 118, locations: EVERY_MARKET, station: "Whole fruit", allergens: [], dietaryLabels: ["vegan", "vegetarian"] },
  { key: "orange", name: "Orange", fdcId: 169097, usdaDescription: "Oranges, raw, all commercial varieties (1 fruit)", servingAmount: 1, servingUnit: "fruit", servingGrams: 131, locations: EVERY_MARKET, station: "Whole fruit", allergens: [], dietaryLabels: ["vegan", "vegetarian"] },
  { key: "apple", name: "Apple", fdcId: 171688, usdaDescription: "Apples, raw, with skin (1 medium)", servingAmount: 1, servingUnit: "medium", servingGrams: 182, locations: EVERY_MARKET, station: "Whole fruit", allergens: [], dietaryLabels: ["vegan", "vegetarian"] },
  { key: "sunflower-seeds", name: "Sunflower Seeds", fdcId: 169418, usdaDescription: "Seeds, sunflower seed kernels, dry roasted, with salt added", servingAmount: 2, servingUnit: "tbsp", servingGrams: 16, locations: ["four-lakes-market"], periods: ["lunch", "dinner"], station: "Salad bar", allergens: [], dietaryLabels: ["vegan", "vegetarian"] },
  { key: "spinach", name: "Fresh Spinach", fdcId: 168462, usdaDescription: "Spinach, raw", servingAmount: 2, servingUnit: "cups", servingGrams: 60, locations: ["four-lakes-market"], periods: ["lunch", "dinner"], station: "Salad bar", allergens: [], dietaryLabels: ["vegan", "vegetarian"] },
  { key: "hard-boiled-egg", name: "Hard-Boiled Egg", fdcId: 173424, usdaDescription: "Egg, whole, cooked, hard-boiled (1 large)", servingAmount: 1, servingUnit: "large egg", servingGrams: 50, locations: ["four-lakes-market"], periods: ["lunch", "dinner"], station: "Salad bar", allergens: ["egg"], dietaryLabels: ["vegetarian"] },
];

const STAPLES_BY_UNIVERSITY: Record<string, Staple[]> = {
  "uw-madison": UW_MADISON_STAPLES,
};

export function staplesFor(universityId: string): Staple[] {
  return STAPLES_BY_UNIVERSITY[universityId] ?? [];
}

export function stapleSourceRef(universityId: string, key: string): string {
  return `staple:${universityId}:${key}`;
}

export function isStapleRef(sourceRef: string | null | undefined): boolean {
  return Boolean(sourceRef?.startsWith("staple:"));
}

const simplify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function toItem(universityId: string, s: Staple): NormalizedMenuItem {
  return {
    name: s.name,
    description: `Served every day but not on the posted menu (added by this site, not the dining operator). Nutrition: USDA FoodData Central, "${s.usdaDescription}", standard portion.`,
    station: `${s.station} ${STAPLE_STATION_SUFFIX}`,
    servingAmount: s.servingAmount,
    servingUnit: s.servingUnit,
    servingGrams: s.servingGrams,
    official: {},
    ingredients: null,
    allergens: s.allergens,
    dietaryLabels: s.dietaryLabels,
    sourceRef: stapleSourceRef(universityId, s.key),
    fdcId: s.fdcId,
  };
}

/** Adds the university's staples to every published meal they apply to. */
export function withStaples(
  universityId: string,
  days: NormalizedMenuDay[],
  resolveSlug: (location: string) => string | null,
): NormalizedMenuDay[] {
  const staples = staplesFor(universityId);
  if (!staples.length) return days;
  return days.map((day) => {
    if (day.status !== "available") return day;
    const slug = resolveSlug(day.location);
    if (!slug) return day;
    const listed = new Set(day.items.map((i) => simplify(i.name)));
    const extra = staples
      .filter((s) => (s.locations === "all" || s.locations.includes(slug)) && (!s.periods || s.periods.includes(day.period)))
      .filter((s) => !listed.has(simplify(s.name)))
      .map((s) => toItem(universityId, s));
    return extra.length ? { ...day, items: [...day.items, ...extra] } : day;
  });
}
