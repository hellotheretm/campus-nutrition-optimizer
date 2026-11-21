import type { NutrientId } from "./nutrients";

/** Source dataset codes used inside the compact index. */
export const USDA_SOURCE_CODES = ["foundation", "sr_legacy", "fndds"] as const;
export type UsdaSource = (typeof USDA_SOURCE_CODES)[number];

export const USDA_SOURCE_LABELS: Record<UsdaSource, string> = {
  foundation: "USDA Foundation Foods",
  sr_legacy: "USDA SR Legacy",
  fndds: "USDA FNDDS 2021–2023",
};

/**
 * One food row in the compact index:
 * [fdcId, sourceCode, description, categoryIndex, valuesPer100g, approxIdx, portions, inputs, foodCode]
 */
export type UsdaIndexRow = [
  fdcId: number,
  source: 0 | 1 | 2,
  description: string,
  category: number,
  values: (number | null)[],
  approx: number[],
  portions: [string, number][],
  inputs: [string, number][],
  foodCode: number,
];

export interface UsdaIndexFile {
  version: string;
  builtAt: string;
  sources: { key: UsdaSource; label: string; release: string; url: string; count: number }[];
  nutrientKeys: NutrientId[];
  categories: string[];
  foods: UsdaIndexRow[];
}

/** Expanded, convenient form used by the app. */
export interface UsdaFood {
  fdcId: number;
  source: UsdaSource;
  description: string;
  category: string;
  /** Nutrient amounts per 100 g. `null`/absent = not reported by USDA. */
  per100g: Partial<Record<NutrientId, number | null>>;
  /** Nutrients whose value came from an approximate fallback field. */
  approx: NutrientId[];
  portions: { description: string; grams: number }[];
  /** FNDDS recipe ingredients (grams per 100 g of food is not implied; raw weights). */
  inputs: { description: string; grams: number }[];
  foodCode?: number;
}

export function fdcUrl(fdcId: number): string {
  return `https://fdc.nal.usda.gov/food-details/${fdcId}/nutrients`;
}
