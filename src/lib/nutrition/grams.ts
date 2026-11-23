/**
 * Serving weights in grams for display. A weight is shown only when the menu source
 * published it or the estimator derived it (from a stated weight, volume, USDA portion,
 * energy or recipe); otherwise nothing is shown — a weight is never invented.
 * Estimated weights carry "≈".
 */
import type { GramsEstimate } from "./estimator";
import { normalizeUnit } from "./units";

export interface ServingWeight {
  grams: number;
  /** True when the weight was published by the menu source, false when estimated. */
  exact: boolean;
}

/** Weight of one serving, from the estimate when it has one, else the published weight. */
export function servingWeight(estimate: GramsEstimate | null | undefined, published: number | null | undefined): ServingWeight | null {
  if (estimate?.value && estimate.value > 0) return { grams: estimate.value, exact: estimate.basis === "stated" };
  if (published && published > 0) return { grams: published, exact: true };
  return null;
}

/** "245 g" or "≈ 52 g" for the given number of servings; null when the weight is unknown. */
export function gramsText(grams: number | null | undefined, exact: boolean, servings = 1): string | null {
  if (!grams || !(grams > 0) || !(servings > 0)) return null;
  const total = grams * servings;
  const text = total < 10 ? total.toLocaleString("en-US", { maximumFractionDigits: 1 }) : Math.round(total).toLocaleString("en-US");
  return `${exact ? "" : "≈ "}${text} g`;
}

/** True when a serving is already measured in grams (a gram figure would only repeat it). */
export function servedInGrams(unitOrLabel: string | null | undefined): boolean {
  const u = normalizeUnit(unitOrLabel).replace(/^[\d.,/\s]+/, "");
  return u === "g" || u === "gram" || u === "grams";
}

/** Weight of `servings` servings, or null when unknown or when one serving is already labeled in grams. */
export function weightText(label: string, grams: number | null | undefined, exact: boolean, servings = 1): string | null {
  return servedInGrams(label) && servings === 1 ? null : gramsText(grams, exact, servings);
}

/** A serving label with its weight added: "1 cup · 245 g", "½ cup · ≈ 52 g", or the label alone. */
export function labelWithGrams(label: string, grams: number | null | undefined, exact: boolean, servings = 1): string {
  const g = weightText(label, grams, exact, servings);
  return g ? `${label} · ${g}` : label;
}
