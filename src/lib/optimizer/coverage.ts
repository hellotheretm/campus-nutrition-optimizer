/**
 * Coverage math shared by the server (plan results) and the browser (live
 * recalculation while a user edits servings). Pure functions only.
 */
import type { Confidence, NutrientEstimate, NutrientEstimates } from "@/lib/nutrition/estimator";
import type { Provenance } from "@/lib/nutrition/provenance";
import type { NutrientId } from "@/lib/nutrition/nutrients";
import { sumNutrients, type NutrientTotals } from "@/lib/nutrition/totals";
import { nutrientName } from "./targets";
import type { CoverageRow, DiaryBaseline, PlanMeal, TargetSummary } from "./types";

/** How far an estimate is pulled toward its low end, by confidence, when the optimizer counts it. */
export const CONFIDENCE_DISCOUNT: Record<Confidence, number> = {
  high: 0,
  medium: 0.15,
  low: 0.35,
  none: 1,
};

export function conservativeValue(est: NutrientEstimate | undefined): number {
  if (!est || est.value === null) return 0;
  const k = CONFIDENCE_DISCOUNT[est.confidence];
  const low = est.low ?? est.value * 0.5;
  return Math.max(0, est.value - k * (est.value - low));
}

export function pessimisticValue(est: NutrientEstimate | undefined): number {
  if (!est || est.value === null) return 0;
  const k = CONFIDENCE_DISCOUNT[est.confidence];
  const high = est.high ?? est.value * 1.5;
  return est.value + k * Math.max(0, high - est.value);
}

export function upperValue(est: NutrientEstimate | undefined): number {
  if (!est || est.value === null) return 0;
  return Math.max(est.value, est.high ?? est.value * 1.5);
}

export interface PlanLine {
  nutrients: Partial<NutrientEstimates>;
  servings: number;
}

export function planLines(meals: PlanMeal[]): PlanLine[] {
  return meals.flatMap((m) => m.items.map((i) => ({ nutrients: i.nutrients, servings: i.servings })));
}

/** The plan's items plus the food already in the diary (one line), i.e. the day's totals. */
export function dayLines(meals: PlanMeal[], diary: DiaryBaseline | null | undefined): PlanLine[] {
  return diary ? [{ nutrients: diary.nutrients, servings: 1 }, ...planLines(meals)] : planLines(meals);
}

/** Turns added-up diary entries into one set of estimates (value, range and confidence kept; unknowns stay unknown). */
export function baselineFromTotals(totals: NutrientTotals): Partial<NutrientEstimates> {
  const out: Partial<NutrientEstimates> = {};
  for (const [id, t] of Object.entries(totals) as [NutrientId, NonNullable<NutrientTotals[NutrientId]>][]) {
    if (!t || t.known === 0) continue;
    const provenance = (Object.entries(t.provenance).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? "approximate") as Provenance;
    out[id] = { value: t.value, low: t.low, high: t.high, provenance, confidence: t.confidence };
  }
  return out;
}

export function computeCoverage(lines: PlanLine[], targets: TargetSummary[]): CoverageRow[] {
  const totals = sumNutrients(lines.map((l) => ({ nutrients: l.nutrients, factor: l.servings })));
  return targets.map((t) => {
    const total = totals[t.id];
    let conservative = 0;
    for (const l of lines) {
      if (t.kind === "limit") conservative += pessimisticValue(l.nutrients[t.id]) * l.servings;
      else conservative += conservativeValue(l.nutrients[t.id]) * l.servings;
    }
    const value = total && total.known > 0 ? total.value : null;
    return {
      ...t,
      value,
      low: total && total.known > 0 ? total.low : null,
      high: total && total.known > 0 ? total.high : null,
      conservative: total && total.known > 0 ? conservative : null,
      percent: value !== null && t.amount ? (value / t.amount) * 100 : null,
      unknownItems: total?.unknown ?? lines.length,
      confidence: total?.confidence ?? "none",
    };
  });
}

export function energyTotal(lines: PlanLine[]): { value: number | null; low: number | null; high: number | null } {
  const t = sumNutrients(lines.map((l) => ({ nutrients: l.nutrients, factor: l.servings }))).energy;
  if (!t || t.known === 0) return { value: null, low: null, high: null };
  return { value: t.value, low: t.low, high: t.high };
}

/** Rows above their UL (compared with the high end of the estimate). */
export function ulWarnings(rows: CoverageRow[], lines: PlanLine[]): { id: NutrientId; ul: number; high: number }[] {
  const out: { id: NutrientId; ul: number; high: number }[] = [];
  for (const r of rows) {
    if (!r.ul || !r.ulCompare) continue;
    let high = 0;
    for (const l of lines) high += upperValue(l.nutrients[r.ulCompare]) * l.servings;
    if (high > r.ul) out.push({ id: r.id, ul: r.ul, high });
  }
  return out;
}

/** Why each item is there: its largest contributions to the day's references. */
export function explainItems(meals: PlanMeal[], summary: TargetSummary[]): void {
  for (const meal of meals) {
    for (const item of meal.items) {
      const contributions: { id: NutrientId; share: number }[] = [];
      for (const t of summary) {
        if (t.kind !== "goal" || !t.amount) continue;
        const v = (item.nutrients[t.id]?.value ?? 0) * item.servings;
        if (v > 0) contributions.push({ id: t.id, share: v / t.amount });
      }
      contributions.sort((a, b) => b.share - a.share);
      const top = contributions.filter((c) => c.share >= 0.15).slice(0, 3);
      item.why = top.length
        ? top.map((c) => `≈${Math.round(c.share * 100)}% of the day's ${nutrientName(c.id)} reference`)
        : ["Rounds out the meal"];
      if (item.locked) item.why.unshift("Locked by you");
    }
  }
}

