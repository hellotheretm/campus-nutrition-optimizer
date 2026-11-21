/**
 * Per-serving nutrient estimates for a stored menu food.
 *
 * Uses the stored estimate (official values plus USDA-based estimates with
 * provenance and confidence). If a food has not been estimated yet, only its
 * published values are returned, with ranges that reflect label rounding;
 * everything else stays unknown.
 */
import type { OfficialNutrients } from "@/db/schema";
import type { EstimationResult, NutrientEstimate, NutrientEstimates } from "./estimator";
import { labelInterval } from "./label-rounding";
import { isNutrientId, type NutrientId } from "./nutrients";

export function perServingNutrients(food: {
  estimate: EstimationResult | null;
  official: OfficialNutrients;
}): Partial<NutrientEstimates> {
  if (food.estimate?.nutrients) return food.estimate.nutrients;
  const out: Partial<NutrientEstimates> = {};
  for (const [key, value] of Object.entries(food.official)) {
    if (!isNutrientId(key) || typeof value !== "number") continue;
    const interval = labelInterval(key as NutrientId, value);
    const est: NutrientEstimate = {
      value,
      low: interval.low,
      high: interval.high,
      provenance: "official",
      confidence: "high",
    };
    out[key as NutrientId] = est;
  }
  return out;
}

export function foodConfidence(food: { estimate: EstimationResult | null }): EstimationResult["overallConfidence"] {
  return food.estimate?.overallConfidence ?? "none";
}
