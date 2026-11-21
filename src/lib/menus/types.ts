import type { diningLocations, MealPeriod, MenuProviderKind, OfficialNutrients, universities } from "@/db/schema";

export type UniversityRow = typeof universities.$inferSelect;
export type LocationRow = typeof diningLocations.$inferSelect;

export const MEAL_PERIODS: MealPeriod[] = ["breakfast", "brunch", "lunch", "dinner", "late_night", "other"];

export const MEAL_PERIOD_LABELS: Record<MealPeriod, string> = {
  breakfast: "Breakfast",
  brunch: "Brunch",
  lunch: "Lunch",
  dinner: "Dinner",
  late_night: "Late night",
  other: "Other",
};

/** One dish as published by a menu source, before it is stored. */
export interface NormalizedMenuItem {
  name: string;
  description?: string | null;
  station?: string | null;
  servingAmount?: number | null;
  servingUnit?: string | null;
  servingGrams?: number | null;
  /** Published per-serving values only. A missing key means "not published", never zero. */
  official: OfficialNutrients;
  ingredients?: string | null;
  allergens: string[];
  dietaryLabels: string[];
  /** Identifier or URL of the item at the source, when there is one. */
  sourceRef?: string | null;
  /** A specific USDA FoodData Central food to estimate from (staples, admin overrides). */
  fdcId?: number | null;
}

export interface NormalizedMenuDay {
  /** Location slug (or its external reference). */
  location: string;
  date: string;
  period: MealPeriod;
  /** "closed" is a statement from the source; "no_data" means the source published nothing. */
  status: "available" | "closed" | "no_data";
  items: NormalizedMenuItem[];
  note?: string | null;
}

export interface ProviderFailure {
  location: string;
  date: string;
  period?: MealPeriod;
  error: string;
}

export interface ProviderFetchResult {
  days: NormalizedMenuDay[];
  warnings: string[];
  /** Combinations that could not be retrieved. Existing data for them is kept as cached. */
  failures: ProviderFailure[];
}

export interface AutoSyncStatus {
  allowed: boolean;
  /** Short status for badges. */
  label: string;
  /** Plain-language explanation shown to users and administrators. */
  reason: string;
  /**
   * How retrieval is sanctioned when allowed: "authorized" (an agreement is on file)
   * or "unofficial" (the operator turned it on without one). Omitted when not allowed.
   */
  mode?: "authorized" | "unofficial";
}

export interface MenuProvider {
  kind: MenuProviderKind;
  label: string;
  autoSync(university: UniversityRow): AutoSyncStatus;
  fetchRange(ctx: {
    university: UniversityRow;
    locations: LocationRow[];
    from: string;
    to: string;
  }): Promise<ProviderFetchResult>;
}
