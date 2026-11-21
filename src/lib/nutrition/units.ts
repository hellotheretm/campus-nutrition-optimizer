/**
 * Unit conversions for serving sizes and nutrient amounts.
 */
import type { NutrientUnit } from "./nutrients";

export const GRAMS_PER: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  gm: 1,
  kg: 1000,
  mg: 0.001,
  oz: 28.3495,
  ounce: 28.3495,
  ounces: 28.3495,
  lb: 453.592,
  lbs: 453.592,
  pound: 453.592,
};

/** Millilitres per volume unit. */
export const ML_PER: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  millilitre: 1,
  l: 1000,
  liter: 1000,
  litre: 1000,
  "fl oz": 29.5735,
  floz: 29.5735,
  "fluid ounce": 29.5735,
  cup: 236.588,
  cups: 236.588,
  c: 236.588,
  tbsp: 14.7868,
  tablespoon: 14.7868,
  tablespoons: 14.7868,
  tsp: 4.92892,
  teaspoon: 4.92892,
  teaspoons: 4.92892,
  pint: 473.176,
  quart: 946.353,
  gallon: 3785.41,
};

/** Count-style units: a gram weight must come from portion data or energy anchoring. */
export const COUNT_UNITS = new Set([
  "each",
  "ea",
  "piece",
  "pieces",
  "pc",
  "pcs",
  "slice",
  "slices",
  "item",
  "items",
  "serving",
  "servings",
  "portion",
  "sandwich",
  "bowl",
  "plate",
  "order",
  "scoop",
  "scoops",
  "ladle",
  "link",
  "links",
  "patty",
  "patties",
  "cookie",
  "cookies",
  "muffin",
  "bar",
  "wrap",
  "taco",
  "tacos",
  "egg",
  "eggs",
  "medium",
  "large",
  "small",
  "whole",
  "container",
  "bottle",
  "can",
  "packet",
  "pkt",
]);

export type ServingKind = "mass" | "volume" | "count" | "unknown";

export interface ParsedServing {
  amount: number;
  unit: string;
  kind: ServingKind;
  grams: number | null;
  ml: number | null;
}

export function normalizeUnit(unit: string | null | undefined): string {
  return (unit ?? "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .replace(/^fl\.? ?oz$/, "fl oz")
    .replace(/^fluid ounces?$/, "fl oz")
    .trim();
}

export function parseServing(amount: number | null | undefined, unitRaw: string | null | undefined): ParsedServing {
  const unit = normalizeUnit(unitRaw);
  const qty = typeof amount === "number" && Number.isFinite(amount) && amount > 0 ? amount : 1;
  if (unit in GRAMS_PER) {
    return { amount: qty, unit, kind: "mass", grams: qty * GRAMS_PER[unit], ml: null };
  }
  if (unit in ML_PER) {
    return { amount: qty, unit, kind: "volume", grams: null, ml: qty * ML_PER[unit] };
  }
  const head = unit.split(" ")[0];
  if (COUNT_UNITS.has(unit) || COUNT_UNITS.has(head)) {
    return { amount: qty, unit, kind: "count", grams: null, ml: null };
  }
  return { amount: qty, unit, kind: unit ? "count" : "unknown", grams: null, ml: null };
}

/** Converts an amount between nutrient units of the same dimension. */
export function convertNutrientAmount(value: number, from: NutrientUnit | "IU_vitamin_d" | "kJ", to: NutrientUnit): number {
  if (from === to) return value;
  if (from === "kJ" && to === "kcal") return value / 4.184;
  if (from === "IU_vitamin_d" && to === "µg") return value / 40;
  const massFactor: Record<string, number> = { g: 1, mg: 1e-3, "µg": 1e-6 };
  if (from in massFactor && to in massFactor) {
    return (value * massFactor[from]) / massFactor[to];
  }
  throw new Error(`Cannot convert ${from} to ${to}`);
}

/** Formats an amount using sensible precision; unknown values never render as zero. */
export function formatAmount(value: number | null | undefined, unit: string, precision = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Unknown";
  const abs = Math.abs(value);
  let digits = precision;
  if (abs >= 100) digits = 0;
  else if (abs >= 10) digits = Math.min(precision, 1);
  else if (abs > 0 && abs < 0.1) digits = Math.max(precision, 2);
  const text = value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return unit === "kcal" ? `${text} kcal` : `${text} ${unit}`;
}

export function servingLabel(amount: number | null | undefined, unit: string | null | undefined): string {
  if (!unit && !amount) return "1 serving";
  const qty = amount && amount > 0 ? amount : 1;
  const pretty = Number.isInteger(qty) ? String(qty) : qty.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${pretty} ${unit ?? "serving"}`.trim();
}
