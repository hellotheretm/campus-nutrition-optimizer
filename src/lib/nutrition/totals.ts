/**
 * Adding up nutrients across foods without hiding uncertainty.
 *
 * A total keeps the sum of known values, the sum of low/high bounds, how many
 * foods had no value (unknown is never counted as zero), and a confidence
 * level weighted by how much of the total each source contributed.
 */
import type { Confidence, NutrientEstimate, NutrientEstimates, Provenance } from "./estimator";
import { NUTRIENT_IDS, type NutrientId } from "./nutrients";

export interface NutrientTotal {
  value: number;
  low: number;
  high: number;
  /** Foods that contributed a value. */
  known: number;
  /** Foods with no value for this nutrient. */
  unknown: number;
  confidence: Confidence;
  /** Share of the total value by provenance (0–1). */
  provenance: Partial<Record<Provenance, number>>;
}

export type NutrientTotals = Partial<Record<NutrientId, NutrientTotal>>;

interface Accumulator {
  value: number;
  low: number;
  high: number;
  known: number;
  unknown: number;
  byConfidence: Record<Confidence, number>;
  byProvenance: Partial<Record<Provenance, number>>;
}

function confidenceFromShares(acc: Accumulator): Confidence {
  if (acc.known === 0) return "none";
  const total = acc.value || 1e-12;
  const high = acc.byConfidence.high / total;
  const medium = acc.byConfidence.medium / total;
  let c: Confidence;
  if (acc.value <= 0) c = acc.known > 0 ? "medium" : "none";
  else if (high >= 0.8) c = "high";
  else if (high + medium >= 0.7) c = "medium";
  else c = "low";
  // Missing values in a meaningful share of foods lower confidence in the total.
  if (acc.unknown > 0 && acc.unknown >= acc.known) c = "low";
  else if (acc.unknown > 0 && c === "high") c = "medium";
  return c;
}

export function sumNutrients(entries: { nutrients: Partial<NutrientEstimates> | null | undefined; factor: number }[]): NutrientTotals {
  const accs = new Map<NutrientId, Accumulator>();
  for (const { nutrients, factor } of entries) {
    if (!(factor > 0)) continue;
    for (const id of NUTRIENT_IDS) {
      const est: NutrientEstimate | undefined = nutrients?.[id];
      let acc = accs.get(id);
      if (!acc) {
        acc = {
          value: 0,
          low: 0,
          high: 0,
          known: 0,
          unknown: 0,
          byConfidence: { high: 0, medium: 0, low: 0, none: 0 },
          byProvenance: {},
        };
        accs.set(id, acc);
      }
      if (!est || est.value === null || !Number.isFinite(est.value)) {
        acc.unknown++;
        continue;
      }
      const v = est.value * factor;
      acc.value += v;
      acc.low += (est.low ?? est.value) * factor;
      acc.high += (est.high ?? est.value) * factor;
      acc.known++;
      acc.byConfidence[est.confidence] += v;
      acc.byProvenance[est.provenance] = (acc.byProvenance[est.provenance] ?? 0) + v;
    }
  }
  const out: NutrientTotals = {};
  for (const [id, acc] of accs) {
    if (acc.known === 0 && acc.unknown === 0) continue;
    const provenance: Partial<Record<Provenance, number>> = {};
    if (acc.value > 0) {
      for (const [p, v] of Object.entries(acc.byProvenance) as [Provenance, number][]) provenance[p] = v / acc.value;
    }
    out[id] = {
      value: acc.value,
      low: acc.low,
      high: acc.high,
      known: acc.known,
      unknown: acc.unknown,
      confidence: confidenceFromShares(acc),
      provenance,
    };
  }
  return out;
}

/** Scales a per-serving estimate set (used for diary snapshots). */
export function scaleEstimates(nutrients: Partial<NutrientEstimates>, factor: number): Partial<NutrientEstimates> {
  const out: Partial<NutrientEstimates> = {};
  for (const [id, est] of Object.entries(nutrients) as [NutrientId, NutrientEstimate][]) {
    if (!est) continue;
    out[id] = {
      ...est,
      value: est.value === null ? null : est.value * factor,
      low: est.low === null ? null : est.low * factor,
      high: est.high === null ? null : est.high * factor,
    };
  }
  return out;
}

/** Keeps only nutrients that have a value or an explicit unknown marker worth storing. */
export function compactEstimates(nutrients: Partial<NutrientEstimates>): Partial<NutrientEstimates> {
  const out: Partial<NutrientEstimates> = {};
  for (const [id, est] of Object.entries(nutrients) as [NutrientId, NutrientEstimate][]) {
    if (!est) continue;
    if (id === "water") continue;
    out[id] = est;
  }
  return out;
}
