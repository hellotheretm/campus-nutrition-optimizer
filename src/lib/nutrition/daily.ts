/**
 * Daily totals and reference coverage for diary entries (browser-safe).
 * Entries store a nutrient snapshot that already includes their servings.
 */
import type { Confidence, NutrientEstimates } from "./estimator";
import type { NutrientId } from "./nutrients";
import type { ReferenceProfile } from "./references";
import { sumNutrients, type NutrientTotals } from "./totals";

export interface CoverageItem {
  id: NutrientId;
  kind: "goal" | "limit";
  reference: number | null;
  value: number | null;
  low: number | null;
  high: number | null;
  percent: number | null;
  lowPercent: number | null;
  highPercent: number | null;
  confidence: Confidence;
  /** Entries with no usable value for this nutrient. */
  unknown: number;
}

/** Nutrients shown in diary and dashboard summaries. */
export const KEY_NUTRIENTS: NutrientId[] = [
  "protein",
  "fiber",
  "vitamin_a",
  "vitamin_c",
  "vitamin_d",
  "folate",
  "vitamin_b12",
  "calcium",
  "iron",
  "magnesium",
  "potassium",
  "zinc",
];

export const LIMIT_KEYS: NutrientId[] = ["sodium", "saturated_fat", "added_sugars"];

export function totalsOf(entries: { nutrients: Partial<NutrientEstimates> | null | undefined }[]): NutrientTotals {
  return sumNutrients(entries.map((e) => ({ nutrients: e.nutrients, factor: 1 })));
}

export function coverageOf(totals: NutrientTotals, reference: ReferenceProfile, ids: NutrientId[], kind: "goal" | "limit" = "goal"): CoverageItem[] {
  return ids.map((id) => {
    const t = totals[id];
    const ref = kind === "limit" ? (reference.limits[id] ?? reference.values[id]?.amount ?? null) : (reference.values[id]?.amount ?? null);
    const known = t && t.known > 0;
    const value = known ? t.value : null;
    const pct = (v: number | null | undefined) => (v !== null && v !== undefined && ref ? (v / ref) * 100 : null);
    return {
      id,
      kind,
      reference: ref,
      value,
      low: known ? t.low : null,
      high: known ? t.high : null,
      percent: pct(value),
      lowPercent: known ? pct(t.low) : null,
      highPercent: known ? pct(t.high) : null,
      confidence: t?.confidence ?? "none",
      unknown: t?.unknown ?? 0,
    };
  });
}

const CONF_ORDER: Confidence[] = ["none", "low", "medium", "high"];

/**
 * One confidence label for a set of nutrient totals: the most common level
 * among nutrients that have data, rounding ties down. "none" when nothing
 * has data.
 */
export function overallConfidence(items: CoverageItem[]): Confidence {
  const counts = new Map<Confidence, number>();
  for (const c of items) if (c.value !== null) counts.set(c.confidence, (counts.get(c.confidence) ?? 0) + 1);
  let best: Confidence = "none";
  let bestN = 0;
  for (const level of CONF_ORDER) {
    const n = counts.get(level) ?? 0;
    if (n > bestN) {
      best = level;
      bestN = n;
    }
  }
  return best;
}

/** Groups entries by date (newest first). */
export function groupByDate<T extends { date: string }>(entries: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const e of entries) {
    const list = map.get(e.date);
    if (list) list.push(e);
    else map.set(e.date, [e]);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}
