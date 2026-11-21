/**
 * Display formatting for nutrient amounts (browser-safe). Unknown values are
 * always rendered as "Unknown" or "—", never as zero.
 */
import { NUTRIENTS, type NutrientId } from "@/lib/nutrition/nutrients";
import type { NutrientEstimate } from "@/lib/nutrition/estimator";
import { formatAmount } from "@/lib/nutrition/units";

export function fmtNutrient(id: NutrientId, value: number | null | undefined): string {
  const def = NUTRIENTS[id];
  return formatAmount(value, def.unit, def.precision);
}

export function fmtNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtKcal(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Unknown";
  return `${Math.round(value).toLocaleString("en-US")} kcal`;
}

export function fmtGrams(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value < 10 ? value.toLocaleString("en-US", { maximumFractionDigits: 1 }) : Math.round(value)} g`;
}

export function fmtPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value > 0 && value < 1) return "<1%";
  return `${Math.round(value)}%`;
}

/** "12–18 mg" for an estimate's range, or null when there is no meaningful range. */
export function fmtRange(id: NutrientId, low: number | null | undefined, high: number | null | undefined): string | null {
  if (low === null || low === undefined || high === null || high === undefined) return null;
  if (Math.abs(high - low) < 1e-9) return null;
  const def = NUTRIENTS[id];
  const a = formatAmount(low, def.unit, def.precision).replace(` ${def.unit}`, "");
  const b = formatAmount(high, def.unit, def.precision);
  if (b.replace(` ${def.unit}`, "") === a) return null;
  return `${a}–${b}`;
}

export function estimateText(id: NutrientId, est: NutrientEstimate | undefined): string {
  if (!est || est.value === null || est.confidence === "none") return "Unknown";
  const prefix = est.provenance === "official" ? "" : "≈ ";
  return `${prefix}${fmtNutrient(id, est.value)}`;
}

export function servingsText(n: number): string {
  if (n === 0.5) return "½";
  if (n === 1.5) return "1½";
  if (n === 2.5) return "2½";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Nutrient name without the measurement basis: "Vitamin A (RAE)" -> "Vitamin A". */
export function plainName(id: NutrientId): string {
  return NUTRIENTS[id].name.replace(/\s*\((RAE|DFE|α-tocopherol|phylloquinone|total)\)/, "");
}
