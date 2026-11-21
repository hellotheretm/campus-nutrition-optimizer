/**
 * Transparent nutrient estimation for dining-hall menu items.
 *
 * Principles (see docs/NUTRITION_ESTIMATION.md):
 *  - Published ("official") values are never replaced. They are treated as
 *    label-rounded numbers, i.e. as intervals, not exact truths.
 *  - Every other number carries provenance (how it was derived), a confidence
 *    level, and a plausible range. Unknown stays unknown; it never becomes 0.
 *  - Three estimation paths, best first:
 *      1. Recipe-derived: parse the ingredient statement, match each
 *         ingredient to USDA, then solve for ingredient amounts that respect
 *         label order, the "2% or less" rule and the published calories/macros
 *         (a convex quadratic program). Ranges come from linear programs that
 *         minimise and maximise each nutrient over every formulation consistent
 *         with the label, using the lowest/highest value among plausible USDA
 *         records for each ingredient.
 *      2. Direct match: the whole dish is matched to USDA records; the serving
 *         weight comes from the menu or is anchored on published calories.
 *      3. Comparable dish: a weak direct match, shown as approximate with
 *         widened ranges.
 *  - A natural-variation allowance (foods of the same name differ) is added to
 *    every estimated range.
 */
import { LpModel, solveModel } from "../solver/lp";
import {
  classifyIngredient,
  maxShareFor,
  parseIngredientStatement,
  type IngredientClass,
  type ParsedIngredient,
} from "./ingredients";
import { labelInterval, type Interval } from "./label-rounding";
import { NUTRIENT_IDS, NUTRIENTS, type NutrientId } from "./nutrients";
import { parseServing } from "./units";
import type { UsdaFood, UsdaSource } from "./usda-index-format";
import {
  getUsdaFood,
  loadUsdaIndex,
  macroDistance,
  macroShares,
  searchUsda,
  type IndexedFood,
  type MatchCandidate,
} from "./usda-index";

export const ESTIMATOR_VERSION = "1.1.0";

// Labels live in a browser-safe module; re-exported here for server code.
import type { Confidence, EstimationMethod, Provenance } from "./provenance";
export type { Confidence, EstimationMethod, Provenance } from "./provenance";
export { CONFIDENCE_LABELS, METHOD_DESCRIPTIONS, METHOD_LABELS, PROVENANCE_DESCRIPTIONS, PROVENANCE_LABELS } from "./provenance";

export interface NutrientEstimate {
  value: number | null;
  low: number | null;
  high: number | null;
  provenance: Provenance;
  confidence: Confidence;
  note?: string;
}

export type NutrientEstimates = Record<NutrientId, NutrientEstimate>;

export interface EstimationInput {
  name: string;
  servingAmount?: number | null;
  servingUnit?: string | null;
  servingGrams?: number | null;
  /** Published per-serving values (label-rounded). */
  official: Partial<Record<NutrientId, number | null | undefined>>;
  ingredients?: string | null;
  /** A USDA FDC id chosen by an administrator, which replaces automatic dish matching. */
  fdcIdOverride?: number | null;
}

export interface GramsEstimate {
  value: number | null;
  low: number | null;
  high: number | null;
  basis: "stated" | "volume" | "portion" | "energy" | "recipe" | "unknown";
}

export interface MatchSummary {
  fdcId: number;
  description: string;
  source: UsdaSource;
  role: "dish" | "ingredient";
  ingredient?: string;
  grams?: number | null;
  score: number;
  /** Other USDA records considered equally plausible for this ingredient. */
  alternatives?: number;
}


export interface EstimationResult {
  version: string;
  method: EstimationMethod;
  nutrients: NutrientEstimates;
  servingGrams: GramsEstimate;
  matches: MatchSummary[];
  /** Share of the solved formulation (by weight) whose ingredients matched USDA records. */
  ingredientCoverage: number | null;
  overallConfidence: Confidence;
  explanation: string[];
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Constants (documented assumptions)                                  */
/* ------------------------------------------------------------------ */

const ESTIMATED_IDS = NUTRIENT_IDS.filter((id) => id !== "water");

/** Nutrients used to fit ingredient amounts to the published label, with weights. */
const FIT_WEIGHTS: Partial<Record<NutrientId, number>> = {
  energy: 1,
  fat: 1,
  carbohydrate: 1,
  protein: 1,
  saturated_fat: 0.6,
  fiber: 0.6,
  sugars: 0.5,
  sodium: 0.6,
  cholesterol: 0.4,
  calcium: 0.5,
  iron: 0.5,
  potassium: 0.5,
  vitamin_d: 0.3,
  vitamin_a: 0.3,
  vitamin_c: 0.3,
};

/** Values that swing with fortification, salt type, soil or recipe practice. */
export const VOLATILE = new Set<NutrientId>([
  "iodine",
  "vitamin_d",
  "selenium",
  "molybdenum",
  "chromium",
  "sodium",
  "folate",
  "vitamin_b12",
]);

/**
 * Typical retention of heat-sensitive vitamins when raw ingredients are cooked
 * (rounded from USDA Table of Nutrient Retention Factors, Release 6). Applied
 * only to recipe-derived values, which start from raw-ingredient data.
 */
export const COOKING_RETENTION: Partial<Record<NutrientId, { low: number; mid: number; high: number }>> = {
  vitamin_c: { low: 0.5, mid: 0.75, high: 0.95 },
  thiamin: { low: 0.65, mid: 0.8, high: 0.95 },
  folate: { low: 0.6, mid: 0.75, high: 0.95 },
  vitamin_b6: { low: 0.7, mid: 0.85, high: 0.95 },
  riboflavin: { low: 0.8, mid: 0.9, high: 1 },
  vitamin_b12: { low: 0.8, mid: 0.9, high: 1 },
  vitamin_a: { low: 0.8, mid: 0.9, high: 1 },
  retinol: { low: 0.8, mid: 0.9, high: 1 },
};

/**
 * Natural variation between foods of the same name (variety, season, soil,
 * supplier). Added to every estimated range as ± this fraction of the value.
 */
export function naturalVariation(id: NutrientId): number {
  if (VOLATILE.has(id)) return 0.35;
  const cat = NUTRIENTS[id].category;
  if (cat === "vitamin") return 0.2;
  if (cat === "mineral") return 0.12;
  if (cat === "fatty_acid") return 0.25;
  return 0.1;
}

const NOT_COOKED =
  /\b(salad|slaw|fresh|raw|fruit|smoothie|juice|yogurt|parfait|milk|cereal|granola|sushi|poke|hummus|guacamole|salsa|cottage|cheese stick|dressing|toast|wrap|sandwich|banana|apple|orange|berries)\b/i;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

export function usdaValue(food: UsdaFood, id: NutrientId): number | null {
  return num(food.per100g[id]);
}

function emptyEstimates(): NutrientEstimates {
  const out = {} as NutrientEstimates;
  for (const id of NUTRIENT_IDS) {
    out[id] = { value: null, low: null, high: null, provenance: "unknown", confidence: "none" };
  }
  return out;
}

function downgrade(c: Confidence, steps = 1): Confidence {
  const order: Confidence[] = ["high", "medium", "low"];
  if (c === "none") return c;
  return order[Math.min(order.length - 1, order.indexOf(c) + steps)];
}

function intervalFor(id: NutrientId, value: number): Interval {
  return labelInterval(id, value);
}

function relWidth(e: { value: number; low: number; high: number }): number {
  const base = Math.max(Math.abs(e.value), 1e-9);
  return (e.high - e.low) / base;
}

function withVariation(id: NutrientId, e: { value: number; low: number; high: number }) {
  const f = naturalVariation(id);
  return { value: e.value, low: Math.max(0, Math.min(e.low, e.value * (1 - f))), high: Math.max(e.high, e.value * (1 + f)) };
}

/** Grams per millilitre from USDA portion data ("1 cup" = 245 g), if available. */
function densityFromPortions(food: UsdaFood): number | null {
  for (const p of food.portions) {
    const m = p.description.toLowerCase().match(/^(\d+(?:\.\d+)?|\d+\/\d+)?\s*(cup|tbsp|tablespoon|tsp|teaspoon|fl oz|fluid ounce)/);
    if (!m) continue;
    let qty = 1;
    if (m[1]) qty = m[1].includes("/") ? Number(m[1].split("/")[0]) / Number(m[1].split("/")[1]) : Number(m[1]);
    const ml = { cup: 236.588, tbsp: 14.7868, tablespoon: 14.7868, tsp: 4.92892, teaspoon: 4.92892, "fl oz": 29.5735, "fluid ounce": 29.5735 }[m[2]];
    if (ml && qty > 0 && p.grams > 0) return p.grams / (qty * ml);
  }
  return null;
}

/** Grams for a count-style serving ("1 slice") from USDA portion data. */
function gramsFromPortions(food: UsdaFood, amount: number, unit: string): number | null {
  const u = unit.toLowerCase().replace(/s$/, "");
  const generic = ["each", "ea", "item", "serving", "portion", "order", "piece", "pc", ""].includes(u);
  const hit =
    food.portions.find((p) => u && !generic && p.description.toLowerCase().includes(u)) ??
    (generic ? food.portions.find((p) => /typical amount|1 (?:piece|item|serving|sandwich|each)/i.test(p.description)) : undefined);
  if (!hit) return null;
  const lead = hit.description.match(/^(\d+(?:\.\d+)?)/);
  const per = lead ? hit.grams / Number(lead[1]) : hit.grams;
  return per * amount;
}

/* ------------------------------------------------------------------ */
/* Direct (whole-dish) matching                                        */
/* ------------------------------------------------------------------ */

interface DishCandidate {
  match: MatchCandidate;
  adjusted: number;
  macroDist: number | null;
  grams: GramsEstimate;
}

interface DirectResult {
  candidates: DishCandidate[];
  quality: "strong" | "moderate" | "weak";
  estimates: Partial<Record<NutrientId, { value: number; low: number; high: number }>>;
  grams: GramsEstimate;
  simpleFood: boolean;
}

function gramsForCandidate(input: EstimationInput, food: UsdaFood, energyLabel: Interval | null, energyValue: number | null): GramsEstimate {
  const serving = parseServing(input.servingAmount ?? null, input.servingUnit ?? null);
  const stated = num(input.servingGrams) ?? (serving.kind === "mass" ? serving.grams : null);
  const kcalPerG = (usdaValue(food, "energy") ?? 0) / 100;
  const energyGrams =
    energyLabel && energyValue !== null && kcalPerG > 0.05
      ? { value: energyValue / kcalPerG, low: energyLabel.low / kcalPerG, high: energyLabel.high / kcalPerG }
      : null;
  if (stated) {
    let low = stated * 0.97;
    let high = stated * 1.03;
    if (energyGrams && Math.abs(energyGrams.value - stated) / stated > 0.25) {
      low = Math.min(low, energyGrams.low);
      high = Math.max(high, energyGrams.high);
    }
    return { value: stated, low, high, basis: "stated" };
  }
  if (energyGrams) return { ...energyGrams, basis: "energy" };
  if (serving.kind === "volume" && serving.ml) {
    const d = densityFromPortions(food);
    if (d) return { value: serving.ml * d, low: serving.ml * d * 0.9, high: serving.ml * d * 1.1, basis: "volume" };
    return { value: serving.ml, low: serving.ml * 0.7, high: serving.ml * 1.1, basis: "volume" };
  }
  const pg = gramsFromPortions(food, serving.amount, serving.unit);
  if (pg) return { value: pg, low: pg * 0.75, high: pg * 1.3, basis: "portion" };
  return { value: null, low: null, high: null, basis: "unknown" };
}

function directMatch(input: EstimationInput, official: Partial<Record<NutrientId, number>>): DirectResult | null {
  const energyValue = official.energy ?? null;
  const energyLabel = energyValue !== null ? intervalFor("energy", energyValue) : null;
  let raw: MatchCandidate[];
  if (input.fdcIdOverride) {
    const food = getUsdaFood(input.fdcIdOverride);
    raw = food ? [{ food, score: 1.2, coverage: 1, precision: 1, adjustments: ["chosen by an administrator"] }] : [];
  } else {
    raw = searchUsda(input.name, { mode: "dish", limit: 12 });
  }
  if (raw.length === 0) return null;
  const officialShares =
    [official.protein, official.carbohydrate, official.fat].filter((v) => v !== undefined).length >= 2
      ? macroShares({ protein: official.protein ?? 0, carbohydrate: official.carbohydrate ?? 0, fat: official.fat ?? 0 })
      : null;

  const scored: DishCandidate[] = raw.map((match) => {
    const dist = macroDistance(officialShares, macroShares(match.food.per100g));
    let adjusted = match.score;
    if (dist !== null) adjusted *= 1 - Math.min(0.6, 1.5 * Math.max(0, dist - 0.05));
    const grams = gramsForCandidate(input, match.food, energyLabel, energyValue);
    return { match, adjusted, macroDist: dist, grams };
  });
  scored.sort((a, b) => b.adjusted - a.adjusted);
  const best = scored[0];
  if (best.grams.value === null) return null;
  const bestShares = macroShares(best.match.food.per100g);
  // Alternatives must be near-equally good and describe the same kind of food.
  const ensemble = scored.filter(
    (c, i) =>
      c === best ||
      (i < 6 &&
        c.grams.value !== null &&
        c.adjusted >= 0.9 * best.adjusted &&
        c.match.food.group === best.match.food.group &&
        (macroDistance(bestShares, macroShares(c.match.food.per100g)) ?? 1) <= 0.12),
  );

  const cov = best.match.coverage;
  const dist = best.macroDist;
  let quality: DirectResult["quality"];
  if (input.fdcIdOverride) quality = "strong";
  else if (cov >= 0.9 && best.adjusted >= 0.75 && (dist === null || dist <= 0.08)) quality = "strong";
  else if (cov >= 0.66 && best.adjusted >= 0.5 && (dist === null || dist <= 0.15)) quality = "moderate";
  else quality = "weak";

  const estimates: DirectResult["estimates"] = {};
  for (const id of ESTIMATED_IDS) {
    const bestV = usdaValue(best.match.food, id);
    // The best record must report the nutrient; otherwise the ensemble would silently swap foods.
    if (bestV === null) continue;
    const g = best.grams;
    const value = (bestV * g.value!) / 100;
    let low = (bestV * g.low!) / 100;
    let high = (bestV * g.high!) / 100;
    for (const c of ensemble) {
      const v = usdaValue(c.match.food, id);
      if (v === null || c.grams.low === null || c.grams.high === null) continue;
      low = Math.min(low, (v * c.grams.low) / 100);
      high = Math.max(high, (v * c.grams.high) / 100);
    }
    if (quality === "weak") {
      low *= 0.6;
      high *= 1.5;
    }
    estimates[id] = { value, low, high };
  }

  const simpleFood =
    ["fruit", "vegetable", "dairy", "egg", "grain", "beverage", "protein_animal", "seafood", "protein_plant"].includes(best.match.food.group) &&
    !/,.*,.*,/.test(best.match.food.description);
  return { candidates: scored.slice(0, 5), quality, estimates, grams: best.grams, simpleFood };
}

/**
 * FNDDS does not report manganese, pantothenic acid, biotin or iodine. For an
 * FNDDS match, those can be approximated from the record's own ingredient
 * list (SR Legacy foods with gram weights), scaled by energy so that moisture
 * changes during cooking cancel out.
 */
let srByDescription: Map<string, IndexedFood> | null = null;
function fillFromFnddsInputs(food: UsdaFood, id: NutrientId): number | null {
  if (food.source !== "fndds" || food.inputs.length === 0) return null;
  if (!srByDescription) {
    srByDescription = new Map();
    for (const f of loadUsdaIndex().foods) {
      if (f.source !== "fndds") srByDescription.set(f.description.toLowerCase(), f);
    }
  }
  let totalG = 0;
  let knownG = 0;
  let nutrient = 0;
  let energy = 0;
  for (const inp of food.inputs) {
    totalG += inp.grams;
    const sr = srByDescription.get(inp.description.toLowerCase());
    if (!sr) continue;
    const v = usdaValue(sr, id);
    const e = usdaValue(sr, "energy");
    if (v === null || e === null) continue;
    knownG += inp.grams;
    nutrient += (v * inp.grams) / 100;
    energy += (e * inp.grams) / 100;
  }
  if (totalG <= 0 || knownG / totalG < 0.8 || energy <= 0) return null;
  const foodEnergy = usdaValue(food, "energy");
  if (!foodEnergy) return null;
  // nutrient per kcal of the recipe × kcal per 100 g of the finished food
  return (nutrient / energy) * foodEnergy;
}

/* ------------------------------------------------------------------ */
/* Recipe-derived estimation                                           */
/* ------------------------------------------------------------------ */

export interface RecipeComponent {
  ingredient: ParsedIngredient;
  cls: IngredientClass;
  food: IndexedFood | null;
  /** Plausible USDA records for this ingredient (the best match first). */
  alternatives: IndexedFood[];
  score: number;
}

interface RecipeResult {
  components: RecipeComponent[];
  grams: number[]; // solved formulation grams per component
  feasible: boolean;
  /** Relative miss on calories when the label could not be met exactly. */
  energyMiss: number;
  worstMiss: { id: NutrientId; miss: number } | null;
  coverage: number; // matched share of formulation mass
  estimates: Partial<Record<NutrientId, { value: number; low: number; high: number; completeness: number; missing: string[] }>>;
  cooked: boolean;
}

function matchIngredient(ing: ParsedIngredient, cls: IngredientClass): { food: IndexedFood | null; score: number; alternatives: IndexedFood[] } {
  if (cls === "additive") return { food: null, score: 0, alternatives: [] };
  const tryName = (name: string) => {
    const hits = searchUsda(name, { mode: "ingredient", limit: 8 });
    const top = hits[0];
    if (!top || top.coverage < 0.6 || top.score < 0.45) return null;
    const topShares = macroShares(top.food.per100g);
    const topKcal = usdaValue(top.food, "energy") ?? 0;
    const alternatives = hits
      .filter((h) => {
        if (h === top) return true;
        if (h.score < 0.85 * top.score || h.coverage < 0.6 || h.food.group !== top.food.group) return false;
        const d = macroDistance(topShares, macroShares(h.food.per100g));
        if (d !== null && d > 0.2) return false;
        const k = usdaValue(h.food, "energy") ?? 0;
        if (topKcal > 20 && (k < topKcal * 0.6 || k > topKcal * 1.6)) return false;
        return true;
      })
      .slice(0, 4)
      .map((h) => h.food);
    return { food: top.food, score: top.score, alternatives };
  };
  const direct = tryName(ing.name);
  if (direct) return direct;
  // "Seasoning (salt, garlic)" → fall back to the first sub-ingredient.
  const firstSub = ing.subIngredients[0];
  if (firstSub) {
    const sub = tryName(firstSub.name);
    if (sub) return { ...sub, score: sub.score * 0.8 };
  }
  return { food: null, score: 0, alternatives: [] };
}

/** Legumes and grains: dry when the list cooks them in water, otherwise canned or cooked. */
const COOKABLE = /(beans?|chickpeas?|garbanzos?|lentils?|split peas|black-eyed peas|rice|quinoa|barley|farro|bulgur|couscous|pasta|penne|spaghetti|macaroni|noodles?|rotini|oats)/i;

export function matchRecipeComponents(ingredients: ParsedIngredient[]): RecipeComponent[] {
  const waterAt = ingredients.findIndex((i) => classifyIngredient(i.name) === "water");
  return ingredients.map((ingredient, idx) => {
    const cls = classifyIngredient(ingredient.name);
    let query = ingredient;
    if (cls === "food" && COOKABLE.test(ingredient.name) && !/(dry|dried|raw|uncooked|canned|cooked)/i.test(ingredient.name)) {
      // Water listed (and therefore heavier than the dry ingredient) means it is cooked in the dish.
      const cookedInDish = waterAt >= 0 && (waterAt < idx || ingredient.minor === false);
      if (!cookedInDish) {
        const legume = /(beans?|chickpeas?|garbanzos?|lentils?|peas)/i.test(ingredient.name);
        query = { ...ingredient, name: `${ingredient.name} ${legume ? "canned" : "cooked"}` };
      }
    }
    const { food, score, alternatives } = matchIngredient(query, cls);
    return { ingredient, cls, food, score, alternatives };
  });
}

function per1g(food: IndexedFood | null, id: NutrientId): number | null {
  if (!food) return null;
  const v = usdaValue(food, id);
  return v === null ? null : v / 100;
}

/** Point, lowest and highest per-gram value across a component's plausible records. */
function componentCoef(c: RecipeComponent, id: NutrientId): { point: number | null; lo: number | null; hi: number | null } {
  const vals = c.alternatives.map((f) => per1g(f, id)).filter((v): v is number => v !== null);
  if (!vals.length) return { point: null, lo: null, hi: null };
  const best = per1g(c.food, id);
  return {
    point: best ?? vals.reduce((s, v) => s + v, 0) / vals.length,
    lo: Math.min(...vals),
    hi: Math.max(...vals),
  };
}

async function recipeEstimate(
  input: EstimationInput,
  official: Partial<Record<NutrientId, number>>,
  components: RecipeComponent[],
  minorStart: number | null,
  servedGrams: number | null,
): Promise<RecipeResult | null> {
  const n = components.length;
  if (n === 0) return null;
  const fitIds = (Object.keys(FIT_WEIGHTS) as NutrientId[]).filter((id) => official[id] !== undefined);
  if (!fitIds.includes("energy") && !servedGrams) return null;

  const x = components.map((_, i) => `x${i}`);
  const model = new LpModel("min");
  x.forEach((v) => model.addVar(v, { lb: 0, ub: 5000 }));
  model.addVar("T", {
    lb: servedGrams ? servedGrams * 0.75 : 1,
    ub: servedGrams ? servedGrams * 1.6 : 5000,
  });
  model.addConstraint("total", [["T", 1], ...x.map((v) => [v, -1] as [string, number])], "=", 0);

  const majorEnd = minorStart ?? n;
  for (let i = 0; i + 1 < majorEnd; i++) {
    model.addConstraint(`ord${i}`, [[x[i], 1], [x[i + 1], -1]], ">=", 0);
  }
  for (let i = 0; i < n; i++) {
    const comp = components[i];
    const isMinor = minorStart !== null && i >= minorStart;
    if (isMinor) {
      model.addConstraint(`minor${i}`, [[x[i], 1], ["T", -0.02]], "<=", 0);
      if (majorEnd > 0) model.addConstraint(`minorle${i}`, [[x[i], 1], [x[majorEnd - 1], -1]], "<=", 0);
    } else if (minorStart !== null) {
      model.addConstraint(`major${i}`, [[x[i], 1], ["T", -0.02]], ">=", 0);
    }
    const cap = maxShareFor(comp.cls);
    if (cap < 1) model.addConstraint(`cap${i}`, [[x[i], 1], ["T", -cap]], "<=", 0);
    const pct = comp.ingredient.statedPercent;
    if (pct !== null && pct > 0 && pct <= 100) {
      model.addConstraint(`pctlo${i}`, [[x[i], 1], ["T", -Math.max(0, pct - 0.5) / 100]], ">=", 0);
      model.addConstraint(`pcthi${i}`, [[x[i], 1], ["T", -(pct + 0.5) / 100]], "<=", 0);
    }
  }

  // Label-fit bands with slack variables (u: below band, v: above band).
  const bands: { id: NutrientId; coef: number[]; band: Interval; target: number; scale: number }[] = [];
  for (const id of fitIds) {
    const target = official[id]!;
    const band = intervalFor(id, target);
    const coef = components.map((c) => per1g(c.food, id) ?? 0);
    if (coef.every((c) => c === 0) && target > 0) continue; // nothing in the recipe can explain it
    const scale = Math.max((band.high - band.low) / 2, id === "energy" ? 10 : 0.5);
    bands.push({ id, coef, band, target, scale });
    model.addVar(`u_${id}`, { lb: 0, ub: 1e6 });
    model.addVar(`v_${id}`, { lb: 0, ub: 1e6 });
    const terms: [string, number][] = coef.map((c, i) => [x[i], c] as [string, number]).filter(([, c]) => Math.abs(c) > 1e-12);
    model.addConstraint(`lo_${id}`, [...terms, [`u_${id}`, 1]], ">=", band.low);
    model.addConstraint(`hi_${id}`, [...terms, [`v_${id}`, -1]], "<=", band.high);
  }
  if (bands.length === 0) return null;

  // Prior: geometric decay over list order, scaled to the published calories.
  const energyTarget = official.energy ?? null;
  const profile = components.map((_, i) => (minorStart !== null && i >= minorStart ? 0.01 : Math.pow(0.65, i)));
  const kcalPerG = components.map((c) => per1g(c.food, "energy") ?? 1.5);
  const profileEnergy = profile.reduce((s, p, i) => s + p * kcalPerG[i], 0);
  const scaleFactor =
    energyTarget && profileEnergy > 0 ? energyTarget / profileEnergy : (servedGrams ?? 300) / profile.reduce((s, p) => s + p, 0);
  const prior = profile.map((p) => p * scaleFactor);
  const priorScale = Math.max(10, prior.reduce((s, p) => s + p, 0) / Math.sqrt(n));

  // Least-absolute-deviation fit (a linear program, which HiGHS solves robustly):
  //   minimise Σ_j w_j·|Σ_i a_ij x_i − label_j| / s_j      (match the label centre)
  //          + 50·Σ_j (u_j + v_j) / s_j                    (stay inside the rounding band)
  //          + λ·Σ_i |x_i − prior_i| / P                   (prefer a typical recipe shape)
  for (const b of bands) {
    model.addVar(`dp_${b.id}`, { lb: 0, ub: 1e7 });
    model.addVar(`dn_${b.id}`, { lb: 0, ub: 1e7 });
    const terms: [string, number][] = b.coef.map((c, i) => [x[i], c] as [string, number]).filter(([, c]) => Math.abs(c) > 1e-12);
    model.addConstraint(`dev_${b.id}`, [...terms, [`dp_${b.id}`, -1], [`dn_${b.id}`, 1]], "=", b.target);
  }
  for (let i = 0; i < n; i++) {
    model.addVar(`rp${i}`, { lb: 0, ub: 1e7 });
    model.addVar(`rn${i}`, { lb: 0, ub: 1e7 });
    model.addConstraint(`prior${i}`, [[x[i], 1], [`rp${i}`, -1], [`rn${i}`, 1]], "=", prior[i]);
  }
  const lambda = 0.2;
  model.clearObjective();
  model.sense = "min";
  for (const b of bands) {
    const w = FIT_WEIGHTS[b.id] ?? 0.5;
    model.addObjective(`dp_${b.id}`, w / b.scale);
    model.addObjective(`dn_${b.id}`, w / b.scale);
    model.addObjective(`u_${b.id}`, 50 / b.scale);
    model.addObjective(`v_${b.id}`, 50 / b.scale);
  }
  for (let i = 0; i < n; i++) {
    model.addObjective(`rp${i}`, lambda / priorScale);
    model.addObjective(`rn${i}`, lambda / priorScale);
  }
  const qp = await solveModel(model, { timeLimitSec: 5 });
  if (process.env.DEBUG_ESTIMATOR) console.error(`[estimator] ${input.name}: fit ${qp.rawStatus}`);
  if (qp.status !== "optimal" && qp.status !== "feasible") return null;
  const grams = x.map((v) => Math.max(0, qp.values.get(v) ?? 0));
  const total = grams.reduce((s, g) => s + g, 0);
  if (total <= 0) return null;

  let maxRelMiss = 0;
  let energyMiss = 0;
  let worstMiss: RecipeResult["worstMiss"] = null;
  for (const b of bands) {
    const u = qp.values.get(`u_${b.id}`) ?? 0;
    const v = qp.values.get(`v_${b.id}`) ?? 0;
    const miss = (u + v) / Math.max(b.target, b.scale);
    if (miss > maxRelMiss) {
      maxRelMiss = miss;
      worstMiss = { id: b.id, miss };
    }
    if (b.id === "energy") energyMiss = miss;
    // Fix each slack near the amount needed so range LPs stay feasible but no looser.
    model.setBounds(`u_${b.id}`, 0, u * 1.05 + 1e-6);
    model.setBounds(`v_${b.id}`, 0, v * 1.05 + 1e-6);
  }
  const feasible = maxRelMiss < 0.02;

  const matchedMass = grams.reduce((s, g, i) => s + (components[i].food || components[i].cls === "additive" ? g : 0), 0);
  const coverage = matchedMass / total;
  const cooked = !NOT_COOKED.test(input.name);

  const estimates: RecipeResult["estimates"] = {};
  for (const id of ESTIMATED_IDS) {
    if (official[id] !== undefined) continue;
    const coefs = components.map((c) => componentCoef(c, id));
    if (coefs.every((c) => c.point === null)) continue;
    const missing: string[] = [];
    let knownMass = 0;
    grams.forEach((g, i) => {
      const comp = components[i];
      if (coefs[i].point !== null || comp.cls === "additive" || comp.cls === "water") knownMass += g;
      else if (g / total > 0.02 || !comp.food) missing.push(comp.ingredient.name);
    });
    const completeness = knownMass / total;
    const point = grams.reduce((s, g, i) => s + g * (coefs[i].point ?? 0), 0);
    let low = point;
    let high = point;
    const loTerms = coefs.map((c, i) => [x[i], c.lo ?? 0] as [string, number]).filter(([, c]) => Math.abs(c) > 1e-12);
    const hiTerms = coefs.map((c, i) => [x[i], c.hi ?? 0] as [string, number]).filter(([, c]) => Math.abs(c) > 1e-12);
    if (loTerms.length > 0) {
      model.clearObjective();
      for (const [v, c] of loTerms) model.addObjective(v, c);
      model.sense = "min";
      const lo = await solveModel(model, { timeLimitSec: 2 });
      if (lo.status === "optimal" && lo.objective !== null) low = Math.min(point, lo.objective);
    } else low = 0;
    if (hiTerms.length > 0) {
      model.clearObjective();
      for (const [v, c] of hiTerms) model.addObjective(v, c);
      model.sense = "max";
      const hi = await solveModel(model, { timeLimitSec: 2 });
      if (hi.status === "optimal" && hi.objective !== null) high = Math.max(point, hi.objective);
    }
    let value = point;
    const r = cooked ? COOKING_RETENTION[id] : undefined;
    if (r) {
      value *= r.mid;
      low *= r.low;
      high *= r.high;
    }
    estimates[id] = { value: Math.max(0, value), low: Math.max(0, low), high: Math.max(0, high), completeness, missing };
  }
  return { components, grams, feasible, energyMiss, worstMiss, coverage, estimates, cooked };
}

/* ------------------------------------------------------------------ */
/* Main entry point                                                    */
/* ------------------------------------------------------------------ */

const SOURCE_NAMES: Record<UsdaSource, string> = { fndds: "FNDDS", sr_legacy: "SR Legacy", foundation: "Foundation Foods" };

export async function estimateNutrition(input: EstimationInput): Promise<EstimationResult> {
  const explanation: string[] = [];
  const warnings: string[] = [];
  const nutrients = emptyEstimates();
  const official: Partial<Record<NutrientId, number>> = {};
  for (const id of NUTRIENT_IDS) {
    const v = num(input.official[id]);
    if (v !== null) official[id] = v;
  }
  const officialIds = Object.keys(official) as NutrientId[];
  for (const id of officialIds) {
    const interval = intervalFor(id, official[id]!);
    nutrients[id] = {
      value: official[id]!,
      low: interval.low,
      high: interval.high,
      provenance: "official",
      confidence: "high",
      note: "As published (label-rounded).",
    };
  }
  if (officialIds.length) {
    explanation.push(
      `Published by the dining hall: ${officialIds.map((id) => NUTRIENTS[id].shortName).join(", ")}. These are kept as-is; label rounding means each is an interval (for example 120 kcal means roughly 115–125 kcal).`,
    );
  } else {
    warnings.push("The menu publishes no nutrition values for this item, so everything shown is estimated.");
  }

  const direct = directMatch(input, official);
  const parsed = parseIngredientStatement(input.ingredients);
  const serving = parseServing(input.servingAmount ?? null, input.servingUnit ?? null);
  const statedGrams = num(input.servingGrams) ?? (serving.kind === "mass" ? serving.grams : null);

  // Recipe path.
  let recipe: RecipeResult | null = null;
  if (parsed.ingredients.length >= 2) {
    const components = matchRecipeComponents(parsed.ingredients);
    recipe = await recipeEstimate(input, official, components, parsed.minorStartIndex, statedGrams);
  }
  const recipeQuality: "good" | "fair" | "poor" | null = recipe
    ? recipe.feasible && recipe.coverage >= 0.9
      ? "good"
      : recipe.coverage >= 0.7 && recipe.energyMiss < 0.15
        ? "fair"
        : "poor"
    : null;

  let method: EstimationMethod;
  if (recipe && (recipeQuality === "good" || recipeQuality === "fair")) method = "recipe";
  else if (direct && direct.quality !== "weak") method = "direct_match";
  else if (direct) method = "comparable";
  else method = officialIds.length ? "official_only" : "none";

  // Serving weight.
  let servingGrams: GramsEstimate = { value: null, low: null, high: null, basis: "unknown" };
  if (statedGrams) {
    servingGrams = { value: statedGrams, low: statedGrams, high: statedGrams, basis: "stated" };
    explanation.push(`Serving weight is published: ${Math.round(statedGrams)} g.`);
  } else if (method === "recipe" && recipe) {
    const t = recipe.grams.reduce((s, g) => s + g, 0);
    servingGrams = { value: t, low: t * 0.7, high: t, basis: "recipe" };
    explanation.push(
      `Serving weight is not published. The solved ingredient amounts add up to about ${Math.round(t)} g before cooking; the served portion may weigh less because cooking drives off water.`,
    );
  } else if (direct && direct.grams.value !== null && method !== "official_only") {
    servingGrams = direct.grams;
    const g = direct.grams;
    if (g.basis === "energy")
      explanation.push(
        `Serving weight is not published. It was estimated at about ${Math.round(g.value!)} g (${Math.round(g.low!)}–${Math.round(g.high!)} g) by dividing the published calories by the energy density of the matched USDA food.`,
      );
    else if (g.basis === "volume") explanation.push(`Serving weight was converted from the published volume using USDA portion data (about ${Math.round(g.value!)} g).`);
    else if (g.basis === "portion") explanation.push(`Serving weight was taken from a USDA portion description (about ${Math.round(g.value!)} g).`);
  }

  const matches: MatchSummary[] = [];
  if (direct) {
    for (const c of direct.candidates.slice(0, 3)) {
      matches.push({
        fdcId: c.match.food.fdcId,
        description: c.match.food.description,
        source: c.match.food.source,
        role: "dish",
        grams: c.grams.value,
        score: Math.round(c.adjusted * 100) / 100,
      });
    }
  }
  if (recipe) {
    recipe.components.forEach((c, i) => {
      if (!c.food) return;
      matches.push({
        fdcId: c.food.fdcId,
        description: c.food.description,
        source: c.food.source,
        role: "ingredient",
        ingredient: c.ingredient.name,
        grams: Math.round(recipe!.grams[i] * 10) / 10,
        score: Math.round(c.score * 100) / 100,
        alternatives: Math.max(0, c.alternatives.length - 1),
      });
    });
    const unmatched = recipe.components.filter((c) => !c.food && c.cls !== "additive").map((c) => c.ingredient.name);
    const additives = recipe.components.filter((c) => c.cls === "additive").map((c) => c.ingredient.name);
    explanation.push(
      `The ingredient list was read as ${recipe.components.length} ingredients in descending order by weight${parsed.minorStartIndex !== null ? ", with a “2% or less” group" : ""}. ${recipe.components.filter((c) => c.food).length} were matched to USDA records, covering about ${Math.round(recipe.coverage * 100)}% of the estimated formulation by weight.`,
    );
    if (unmatched.length) explanation.push(`Not matched to USDA data: ${unmatched.join(", ")}.`);
    if (additives.length) explanation.push(`Treated as contributing negligible nutrients: ${additives.join(", ")}.`);
    if (recipe.feasible) {
      explanation.push(
        "Ingredient amounts were solved with linear programming so the recipe reproduces the published calories and macronutrients within label rounding. Each range runs from the lowest to the highest value over every ingredient mix that still matches the label and the ingredient order, and over the plausible USDA records for each ingredient.",
      );
    } else {
      const w = recipe.worstMiss;
      explanation.push(
        `The matched ingredients could not reproduce the published label exactly${w ? ` (${NUTRIENTS[w.id].name.toLowerCase()} is off by about ${Math.round(w.miss * 100)}%)` : ""}, so confidence is lower.`,
      );
    }
    if (recipe.cooked && method === "recipe")
      explanation.push("Typical USDA cooking-retention factors are applied to heat-sensitive vitamins (vitamin C, thiamin, folate, B6).");
    if (recipeQuality === "poor") warnings.push("The ingredient-based reconstruction was too uncertain to use as the main estimate.");
  } else if (parsed.ingredients.length < 2 && input.ingredients) {
    explanation.push("The ingredient list has fewer than two ingredients, so the whole item was matched instead.");
  }
  if (direct) {
    const best = direct.candidates[0].match.food;
    const desc = `“${best.description}” (USDA ${SOURCE_NAMES[best.source]}, FDC ${best.fdcId})`;
    if (method === "direct_match") explanation.push(`The item was matched to ${desc}; values are scaled to the serving weight.`);
    else if (method === "comparable")
      explanation.push(`No close USDA match was found. The nearest comparable food is ${desc}, so values are approximate and their ranges are widened.`);
    else if (method === "recipe" && direct.quality !== "weak") explanation.push(`For comparison, the closest whole-dish USDA record is ${desc}.`);
  }
  if (method !== "official_only" && method !== "none")
    explanation.push("Every estimated range also allows for natural variation between foods of the same name (about ±10–35% depending on the nutrient).");
  if (method === "none") warnings.push("No USDA record or ingredient list was good enough to estimate nutrients for this item.");

  // Assemble per-nutrient estimates.
  for (const id of ESTIMATED_IDS) {
    if (official[id] !== undefined) continue;
    let est: NutrientEstimate | null = null;
    const volatile = VOLATILE.has(id);
    if (method === "recipe" && recipe?.estimates[id]) {
      const r = recipe.estimates[id]!;
      let confidence: Confidence = recipeQuality === "good" ? "medium" : "low";
      if (r.completeness < 0.9) confidence = downgrade(confidence);
      if (relWidth(r) > 1.2) confidence = "low";
      if (volatile) confidence = downgrade(confidence);
      let note: string | undefined;
      const d = direct?.estimates[id];
      if (d && direct!.quality === "strong" && (d.value < r.low * 0.7 || d.value > r.high * 1.3)) {
        confidence = downgrade(confidence);
        note = "The whole-dish USDA match disagrees with the recipe reconstruction.";
      }
      if (r.missing.length) note = `No USDA value for: ${r.missing.slice(0, 3).join(", ")}${r.missing.length > 3 ? "…" : ""}. The total may be higher.`;
      const w = withVariation(id, r);
      est = { value: w.value, low: w.low, high: w.high, provenance: "usda_recipe", confidence, note };
    } else if (direct?.estimates[id] && (method === "direct_match" || method === "comparable" || method === "recipe")) {
      const d = direct.estimates[id]!;
      const strong = direct.quality === "strong";
      let confidence: Confidence =
        method === "comparable" ? "low" : strong ? (direct.simpleFood && servingGrams.basis === "stated" ? "high" : "medium") : "low";
      if (relWidth(d) > 1.0) confidence = downgrade(confidence, confidence === "high" ? 2 : 1);
      else if (relWidth(d) > 0.6 && confidence === "high") confidence = "medium";
      if (volatile) confidence = downgrade(confidence);
      const approxFlag = direct.candidates[0].match.food.approx.includes(id);
      if (approxFlag) confidence = downgrade(confidence);
      const w = withVariation(id, d);
      est = {
        value: w.value,
        low: w.low,
        high: w.high,
        provenance: method === "comparable" ? "approximate" : "usda_match",
        confidence,
        note: approxFlag ? "USDA reports a closely related measure for this nutrient." : undefined,
      };
    }
    if (!est && direct && method !== "official_only") {
      // FNDDS gap-filling from the record's own ingredients.
      const best = direct.candidates[0];
      const per100 = fillFromFnddsInputs(best.match.food, id);
      const g = best.grams;
      if (per100 !== null && g.value !== null && g.low !== null && g.high !== null) {
        est = {
          value: (per100 * g.value) / 100,
          low: (per100 * g.low * 0.6) / 100,
          high: (per100 * g.high * 1.4) / 100,
          provenance: "approximate",
          confidence: "low",
          note: "Not reported for this USDA dish; approximated from the USDA recipe's ingredients.",
        };
      }
    }
    if (est) nutrients[id] = est;
    else if (id === "chromium") nutrients[id].note = "USDA FoodData Central does not report chromium.";
  }

  // Overall confidence: the median confidence of estimated essential micronutrients.
  const order: Confidence[] = ["high", "medium", "low", "none"];
  const micro = ESTIMATED_IDS.filter((id) => NUTRIENTS[id].essential && nutrients[id].provenance !== "official");
  const levels = micro.map((id) => order.indexOf(nutrients[id].confidence)).sort((a, b) => a - b);
  const overallConfidence: Confidence = levels.length ? order[levels[Math.floor(levels.length / 2)]] : "none";

  return {
    version: ESTIMATOR_VERSION,
    method,
    nutrients,
    servingGrams,
    matches,
    ingredientCoverage: recipe ? Math.round(recipe.coverage * 1000) / 1000 : null,
    overallConfidence,
    explanation,
    warnings: [...parsed.warnings, ...warnings],
  };
}

/** Nutrients for an amount of a USDA food chosen directly by the user. */
export function nutrientsForUsdaFood(food: UsdaFood, grams: number): NutrientEstimates {
  const out = emptyEstimates();
  for (const id of NUTRIENT_IDS) {
    const v = usdaValue(food, id);
    if (v === null) continue;
    const value = (v * grams) / 100;
    let confidence: Confidence = "high";
    if (food.approx.includes(id as NutrientId)) confidence = "medium";
    if (VOLATILE.has(id) && food.source === "fndds") confidence = downgrade(confidence);
    const f = naturalVariation(id);
    out[id] = { value, low: value * (1 - f), high: value * (1 + f), provenance: "usda_match", confidence };
  }
  return out;
}
