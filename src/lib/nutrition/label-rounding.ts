/**
 * FDA Nutrition Facts rounding rules (21 CFR 101.9(c)) and the tolerance they
 * imply. Dining-hall "official" values are typically label-rounded, so a
 * published "0 g" or "120 kcal" really means "somewhere in an interval".
 * The estimator uses these intervals instead of treating labels as exact.
 */
import type { NutrientId } from "./nutrients";
import { getReferenceProfile } from "./references";

export interface Interval {
  low: number;
  high: number;
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Applies label rounding to a true amount (used to create demo labels and tests). */
export function roundForLabel(nutrient: NutrientId, value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  switch (nutrient) {
    case "energy":
      if (value < 5) return 0;
      if (value <= 50) return roundTo(value, 5);
      return roundTo(value, 10);
    case "fat":
    case "saturated_fat":
    case "trans_fat":
    case "monounsaturated_fat":
    case "polyunsaturated_fat":
      if (value < 0.5) return 0;
      if (value < 5) return roundTo(value, 0.5);
      return roundTo(value, 1);
    case "cholesterol":
      if (value < 2) return 0;
      if (value <= 5) return 5; // labels state "less than 5 mg"
      return roundTo(value, 5);
    case "sodium":
      if (value < 5) return 0;
      if (value <= 140) return roundTo(value, 5);
      return roundTo(value, 10);
    case "potassium":
      if (value < 5) return 0;
      if (value <= 140) return roundTo(value, 5);
      return roundTo(value, 10);
    case "carbohydrate":
    case "fiber":
    case "sugars":
    case "added_sugars":
    case "protein":
      if (value < 0.5) return 0;
      return roundTo(value, 1);
    case "vitamin_d":
      return roundTo(value, 0.1);
    case "calcium":
    case "iron":
    case "vitamin_a":
    case "vitamin_c":
      return roundByPercentDv(nutrient, value);
    default:
      return value;
  }
}

function roundByPercentDv(nutrient: NutrientId, value: number): number {
  const dv = getReferenceProfile().values[nutrient]?.amount;
  if (!dv) return value;
  const pct = (value / dv) * 100;
  let roundedPct: number;
  if (pct < 2) roundedPct = 0;
  else if (pct <= 10) roundedPct = roundTo(pct, 2);
  else if (pct <= 50) roundedPct = roundTo(pct, 5);
  else roundedPct = roundTo(pct, 10);
  return (roundedPct / 100) * dv;
}

/**
 * Returns the interval of true values consistent with a label-rounded value.
 * A small relative allowance is added because recipe software, ingredient
 * variability and preparation also move real values.
 */
export function labelInterval(nutrient: NutrientId, labelValue: number, relativeSlack = 0.08): Interval {
  let low = labelValue;
  let high = labelValue;
  const half = (step: number) => {
    low = labelValue - step / 2;
    high = labelValue + step / 2;
  };
  switch (nutrient) {
    case "energy":
      if (labelValue === 0) {
        low = 0;
        high = 5;
      } else if (labelValue <= 50) half(5);
      else half(10);
      break;
    case "fat":
    case "saturated_fat":
    case "trans_fat":
    case "monounsaturated_fat":
    case "polyunsaturated_fat":
      if (labelValue === 0) {
        low = 0;
        high = 0.5;
      } else if (labelValue < 5) half(0.5);
      else half(1);
      break;
    case "cholesterol":
      if (labelValue === 0) {
        low = 0;
        high = 2;
      } else if (labelValue <= 5) {
        low = 2;
        high = 5;
      } else half(5);
      break;
    case "sodium":
    case "potassium":
      if (labelValue === 0) {
        low = 0;
        high = 5;
      } else if (labelValue <= 140) half(5);
      else half(10);
      break;
    case "carbohydrate":
    case "fiber":
    case "sugars":
    case "added_sugars":
    case "protein":
      if (labelValue === 0) {
        low = 0;
        high = 0.5;
      } else half(1);
      break;
    case "calcium":
    case "iron":
    case "vitamin_a":
    case "vitamin_c": {
      const dv = getReferenceProfile().values[nutrient]?.amount ?? 0;
      const pct = dv ? (labelValue / dv) * 100 : 0;
      const step = pct <= 10 ? 2 : pct <= 50 ? 5 : 10;
      if (labelValue === 0) {
        low = 0;
        high = (dv * 2) / 100;
      } else half((dv * step) / 100);
      break;
    }
    default:
      low = labelValue * 0.95;
      high = labelValue * 1.05;
  }
  const slack = Math.abs(labelValue) * relativeSlack;
  return { low: Math.max(0, low - slack), high: high + slack };
}
