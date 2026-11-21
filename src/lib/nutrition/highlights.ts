/**
 * A food's standout nutrients: the 1–3 vitamins, minerals or fiber it provides
 * the most of, relative to a daily reference. Used for the small bars under
 * each food on menus and in plans. Unknown values and "no data" estimates are
 * skipped, never shown as zero.
 */
import type { NutrientEstimates } from "./estimator";
import { NUTRIENTS, type NutrientId } from "./nutrients";
import { getReferenceProfile } from "./references";

export interface NutrientHighlight {
  id: NutrientId;
  label: string;
  /** Amount in the portion (servings already applied). */
  value: number;
  /** Likely range of the amount, when the estimate has one. */
  low: number | null;
  high: number | null;
  /** Share of the daily reference, in percent. */
  percent: number;
  lowPercent: number | null;
  highPercent: number | null;
  estimated: boolean;
}

export const HIGHLIGHT_IDS: NutrientId[] = [
  "fiber",
  "vitamin_a",
  "vitamin_c",
  "vitamin_d",
  "vitamin_e",
  "vitamin_k",
  "thiamin",
  "riboflavin",
  "niacin",
  "vitamin_b6",
  "folate",
  "vitamin_b12",
  "choline",
  "calcium",
  "iron",
  "magnesium",
  "potassium",
  "zinc",
  "selenium",
];

const FDA = getReferenceProfile({ standard: "fda_dv", ageGroup: "unspecified", sex: "unspecified" });

/** FDA Daily Values, the default reference for menus. */
export const DEFAULT_HIGHLIGHT_REFERENCES: Partial<Record<NutrientId, number>> = Object.fromEntries(
  HIGHLIGHT_IDS.map((id) => [id, FDA.values[id]?.amount]).filter(([, v]) => typeof v === "number" && v > 0),
);

export function highlightsFor(
  nutrients: Partial<NutrientEstimates>,
  opts: { factor?: number; references?: Partial<Record<NutrientId, number>>; max?: number; minPercent?: number } = {},
): NutrientHighlight[] {
  const factor = opts.factor ?? 1;
  const refs = opts.references ?? DEFAULT_HIGHLIGHT_REFERENCES;
  const out: NutrientHighlight[] = [];
  for (const id of HIGHLIGHT_IDS) {
    const est = nutrients[id];
    const ref = refs[id];
    if (!est || est.value === null || !ref) continue;
    if (est.confidence === "none") continue;
    const value = est.value * factor;
    const low = est.low !== null && est.low !== undefined ? est.low * factor : null;
    const high = est.high !== null && est.high !== undefined ? est.high * factor : null;
    const percent = (value / ref) * 100;
    if (percent < (opts.minPercent ?? 10)) continue;
    out.push({
      id,
      label: NUTRIENTS[id].shortName,
      value,
      low,
      high,
      percent,
      lowPercent: low !== null ? (low / ref) * 100 : null,
      highPercent: high !== null ? (high / ref) * 100 : null,
      estimated: est.provenance !== "official",
    });
  }
  return out.sort((a, b) => b.percent - a.percent).slice(0, opts.max ?? 3);
}
