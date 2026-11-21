/**
 * The meal-planning model: a mixed-integer program solved with HiGHS.
 *
 * Decision variables (per candidate item j in meal m)
 *   n_j ∈ {0,1,…}  servings in steps of 0.5 or 1     y_j ∈ {0,1}  item chosen
 *   h_ml ∈ {0,1}   dining location l chosen for meal m (one location per meal)
 *
 * Objective (minimized) — every term is visible in the result's model notes:
 *   Σ_goals   w_g · (1.0·s1 + 1.8·s2 + 3.0·s3)   shortfall below each reference, split into
 *                                               pieces (first 25%, next 25%, last 50%) with
 *                                               rising costs: big gaps cost most, the last
 *                                               few percent least (diminishing returns), and
 *                                               nothing is gained above 100%
 * + Σ_limits  w_l · (1.0·e1 + 3.0·e2)           going over sodium / saturated fat / added
 *                                               sugar limits (first 25% over is cheaper)
 * + Σ_UL      10,000 · slack / UL               upper limits are hard; the slack only exists
 *                                               to explain infeasibility
 * + calorie and macro target deviations (when set: a hard ±tolerance band plus a pull toward
 *   exact), or, without targets, small penalties for macro energy outside the AMDR
 * + 0.3 per repeated dish across meals (variety)
 * + small per-item and per-serving costs, plus 0.2 per serving beyond the first of any
 *   item (practical portions), and preferred-food bonuses.
 *
 * Nutrient coefficients are confidence-weighted: for goals an estimate is
 * pulled toward its low end (medium 15%, low 35%), for limits toward its
 * high end, and upper limits use the high end. Unknown values count as zero
 * contribution to goals (they are never assumed to help) and are reported.
 */
import type { MealPeriod } from "@/db/schema";
import type { Confidence, NutrientEstimates } from "@/lib/nutrition/estimator";
import { NUTRIENTS, type NutrientId } from "@/lib/nutrition/nutrients";
import { LpModel, solveModel } from "@/lib/solver/lp";
import { computeCoverage, conservativeValue, energyTotal, explainItems, pessimisticValue, planLines, upperValue } from "./coverage";
import { nutrientName, type MacroSpec, type Targets } from "./targets";
import {
  MACRO_IDS,
  STRATEGIES,
  type CoverageRow,
  type MacroId,
  type MacroTargetRow,
  type PlanItem,
  type PlanMeal,
  type PlanRequest,
  type PlanResult,
} from "./types";

export interface Candidate {
  foodId: string;
  lineageKey: string;
  name: string;
  station: string | null;
  period: MealPeriod;
  locationId: string;
  locationName: string;
  servingLabel: string;
  servingGrams: number | null;
  step: number;
  nutrients: Partial<NutrientEstimates>;
  confidence: Confidence;
  allergens: string[];
  dietaryLabels: string[];
  preferred: boolean;
  plant: boolean;
  /** Why the item conflicts with the user's filters (only filled when filtered items are kept). */
  conflicts?: string[];
}

export interface MealCandidates {
  period: MealPeriod;
  candidates: Candidate[];
  /** Why the meal cannot be planned (closed, no menu, everything filtered out). */
  unavailableNote: string | null;
  filteredOut: number;
  filterSummary: string[];
}

const MAX_CANDIDATES_PER_MEAL = 45;
const UL_PENALTY = 10_000;
/** Cost of missing a calorie or macro target by 100% inside its band (1% ≈ 0.4): pulls plans toward exact. */
const MACRO_EXACT_WEIGHT = 40;
/** Cost per unit (relative to target) outside the band; only paid when no plan can stay inside it. */
const MACRO_BAND_PENALTY = 5_000;
const GOAL_PIECES: [number, number][] = [
  [0.25, 1.0],
  [0.25, 1.8],
  [0.5, 3.0],
];

export function planSignature(meals: { period: string; items: { foodId: string }[] }[]): string {
  return meals
    .flatMap((m) => m.items.map((i) => `${m.period}:${i.foodId}`))
    .sort()
    .join("|");
}

/** Quick per-serving usefulness score, used only to prune very large menus before solving. */
function heuristicScore(c: Candidate, targets: Targets): number {
  let score = 0;
  for (const s of targets.summary) {
    if (!s.amount) continue;
    if (s.kind === "goal") score += s.weight * Math.min(conservativeValue(c.nutrients[s.id]) / s.amount, 0.5);
    if (s.kind === "limit") score -= 0.5 * s.weight * Math.min(pessimisticValue(c.nutrients[s.id]) / s.amount, 1);
  }
  return score;
}

function prune(meal: MealCandidates, targets: Targets, keep: Set<string>): Candidate[] {
  if (meal.candidates.length <= MAX_CANDIDATES_PER_MEAL) return meal.candidates;
  const scored = meal.candidates.map((c) => ({ c, s: heuristicScore(c, targets) + (c.preferred ? 1 : 0) }));
  scored.sort((a, b) => b.s - a.s);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const { c } of scored) {
    if (keep.has(`${c.period}:${c.foodId}`) && !seen.has(c.foodId)) {
      out.push(c);
      seen.add(c.foodId);
    }
  }
  // Keep the best items per location so every location stays a real option.
  const perLocation = new Map<string, number>();
  const locations = new Set(meal.candidates.map((c) => c.locationId));
  const perLocCap = Math.max(10, Math.floor(MAX_CANDIDATES_PER_MEAL / Math.max(1, locations.size)));
  for (const { c } of scored) {
    if (seen.has(c.foodId)) continue;
    const n = perLocation.get(c.locationId) ?? 0;
    if (n >= perLocCap) continue;
    perLocation.set(c.locationId, n + 1);
    out.push(c);
    seen.add(c.foodId);
  }
  return out;
}

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

function fmtAmount(id: NutrientId, v: number): string {
  const unit = NUTRIENTS[id].unit;
  const digits = v >= 100 ? 0 : v >= 10 ? 0 : 1;
  return `${v.toLocaleString("en-US", { maximumFractionDigits: digits })} ${unit}`;
}

interface VarRef {
  n: string;
  y: string;
  c: Candidate;
  maxSteps: number;
  locked: number | null;
  mealIndex: number;
}

export async function optimize(req: PlanRequest, meals: MealCandidates[], targets: Targets): Promise<PlanResult> {
  const warnings: string[] = [];
  const reasons: string[] = [];
  const suggestions: string[] = [];
  const strategy = req.strategy;
  const maxItems = strategy === "simple" ? Math.min(req.maxItemsPerMeal, 3) : req.maxItemsPerMeal;
  const itemCost = strategy === "simple" ? 0.2 : 0.04;
  const servingCost = 0.015;
  const extraServingCost = 0.2;

  const lockKey = (period: string, foodId: string) => `${period}:${foodId}`;
  const locks = new Map(req.locks.map((l) => [lockKey(l.period, l.foodId), l.servings]));

  const model = new LpModel("min");
  const refs: VarRef[] = [];
  // With calorie or macro targets, an item whose value for a targeted macro is unknown can't be counted, so it isn't chosen.
  const macroIds = targets.macros ? MACRO_IDS.filter((id) => targets.macros!.targets[id] !== undefined) : [];
  const missingMacro = (c: Candidate) => macroIds.some((id) => c.nutrients[id]?.value === null || c.nutrients[id]?.value === undefined);
  let macroSkipped = 0;
  const mealHasVars: boolean[] = [];

  for (const [mi, meal] of meals.entries()) {
    const keep = new Set([...locks.keys()].filter((k) => k.startsWith(`${meal.period}:`)));
    const cands = prune(meal, targets, keep);
    if (!cands.length) {
      mealHasVars.push(false);
      continue;
    }
    mealHasVars.push(true);

    // A locked food may be served at several locations; the lock holds wherever the meal is planned.
    // Locks only conflict when no single location serves every locked food.
    const lockedFoods = new Map<string, Set<string>>();
    for (const c of cands) {
      if (!locks.has(lockKey(c.period, c.foodId))) continue;
      const set = lockedFoods.get(c.foodId) ?? new Set<string>();
      set.add(c.locationId);
      lockedFoods.set(c.foodId, set);
    }
    const shared: Set<string> | null = lockedFoods.size
      ? [...lockedFoods.values()].reduce((acc, locs) => new Set([...acc].filter((l) => locs.has(l))))
      : null;
    if (shared && shared.size === 0) {
      reasons.push(`Your locked ${meal.period} items aren't all served at the same dining location, and a meal is planned at one location.`);
      suggestions.push(`Unlock one of the ${meal.period} items, or move it to another meal.`);
    }
    const lockChoice = new Map<string, string[]>();

    const locationIds = [...new Set(cands.map((c) => c.locationId))];
    const hallVar = new Map<string, string>();
    if (locationIds.length > 1) {
      for (const [li, loc] of locationIds.entries()) hallVar.set(loc, model.addVar(`h_${mi}_${li}`, { type: "binary" }));
      model.addConstraint(`one_hall_${mi}`, [...hallVar.values()].map((v) => [v, 1] as const), "=", 1);
    }

    let lockedItems = 0;
    let lockedServings = 0;
    for (const c of cands) {
      const j = refs.length;
      const lockServings = locks.get(lockKey(c.period, c.foodId)) ?? null;
      const step = lockServings !== null && !Number.isInteger(lockServings / c.step) ? 0.5 : c.step;
      const maxServings = Math.max(req.maxServingsPerItem, lockServings ?? 0);
      const maxSteps = Math.round(maxServings / step);
      const n = model.addVar(`n_${j}`, { type: "integer", lb: 0, ub: maxSteps });
      const y = model.addVar(`y_${j}`, { type: "binary" });
      model.addConstraint(`link_${j}`, [[n, 1], [y, -maxSteps]], "<=", 0);
      model.addConstraint(`min_${j}`, [[n, 1], [y, -1]], ">=", 0);
      const hv = hallVar.get(c.locationId);
      if (hv) model.addConstraint(`hall_${j}`, [[y, 1], [hv, -1]], "<=", 0);
      if (targets.macros && lockServings === null && missingMacro(c)) {
        model.setBounds(y, 0, 0);
        macroSkipped++;
      }
      if (lockServings !== null) {
        // Exactly the locked servings if this copy is the one chosen (see lock_ constraints below).
        const steps = Math.round(lockServings / step);
        model.addConstraint(`lockn_${j}`, [[n, 1], [y, -steps]], "=", 0);
        if (shared && !shared.has(c.locationId)) model.setBounds(y, 0, 0);
        const ys = lockChoice.get(c.foodId) ?? [];
        ys.push(y);
        lockChoice.set(c.foodId, ys);
      }
      let cost = itemCost;
      if (c.preferred) cost -= 0.25;
      if (strategy === "plant_forward") cost += c.plant ? -0.08 : 0.08;
      if (c.confidence === "low" || c.confidence === "none") cost += 0.02;
      model.addObjective(y, cost);
      model.addObjective(n, servingCost * step);
      if (maxServings > 1) {
        // Servings beyond the first of the same dish are allowed but discouraged.
        const extra = model.addVar(`x_${j}`, { lb: 0 });
        model.addObjective(extra, extraServingCost);
        model.addConstraint(`extra_${j}`, [[n, step], [extra, -1]], "<=", 1);
      }
      refs.push({ n, y, c: { ...c, step }, maxSteps, locked: lockServings, mealIndex: mi });
    }

    for (const [k, [foodId, ys]] of [...lockChoice.entries()].entries()) {
      model.addConstraint(`lock_${mi}_${k}`, ys.map((v) => [v, 1] as const), "=", 1);
      lockedItems++;
      lockedServings += locks.get(lockKey(meal.period, foodId)) ?? 0;
    }
    const mealRefs = refs.filter((r) => r.mealIndex === mi);
    const itemCap = Math.max(maxItems, lockedItems);
    const servingCap = Math.max(itemCap + 1, lockedServings);
    model.addConstraint(`items_${mi}`, mealRefs.map((r) => [r.y, 1] as const), "<=", itemCap);
    model.addConstraint(`atleast_${mi}`, mealRefs.map((r) => [r.y, 1] as const), ">=", 1);
    model.addConstraint(`servings_${mi}`, mealRefs.map((r) => [r.n, r.c.step] as const), "<=", servingCap);
  }

  const mealUnavailable = meals.map((m, i) => !mealHasVars[i]);
  if (!refs.length) {
    for (const m of meals) if (m.unavailableNote) reasons.push(m.unavailableNote);
    return emptyResult(req, meals, targets, "no_menu", reasons, [
      "Try another date, add more dining locations, or relax dietary filters.",
    ]);
  }

  const inScope = (r: VarRef, scope: string) => scope === "day" || meals[r.mealIndex].period === scope;

  // Goals with diminishing returns.
  for (const [gi, g] of targets.goals.entries()) {
    if (!(g.target > 0)) continue;
    const scoped = refs.filter((r) => inScope(r, g.scope));
    if (!scoped.length) continue;
    const terms: [string, number][] = [];
    for (const r of scoped) {
      const a = (conservativeValue(r.c.nutrients[g.id]) * r.c.step) / g.target;
      if (a > 1e-9) terms.push([r.n, a]);
    }
    const pieces = GOAL_PIECES.map(([size, mult], k) => {
      const v = model.addVar(`s_${gi}_${k}`, { lb: 0, ub: size });
      model.addObjective(v, g.weight * mult);
      return v;
    });
    model.addConstraint(`goal_${gi}`, [...terms, ...pieces.map((p) => [p, 1] as [string, number])], ">=", 1);
  }

  // Soft limits.
  for (const [li, l] of targets.limits.entries()) {
    if (!(l.limit > 0)) continue;
    const scoped = refs.filter((r) => inScope(r, l.scope));
    if (!scoped.length) continue;
    const terms: [string, number][] = [];
    for (const r of scoped) {
      const b = (pessimisticValue(r.c.nutrients[l.id]) * r.c.step) / l.limit;
      if (b > 1e-9) terms.push([r.n, b]);
    }
    if (!terms.length) continue;
    const e1 = model.addVar(`e_${li}_0`, { lb: 0, ub: 0.25 });
    const e2 = model.addVar(`e_${li}_1`, { lb: 0 });
    model.addObjective(e1, l.weight * 1);
    model.addObjective(e2, l.weight * 3);
    model.addConstraint(`limit_${li}`, [...terms, [e1, -1], [e2, -1]], "<=", 1);
  }

  // Upper limits (hard; slack only to diagnose).
  const ulSlacks: { v: string; id: NutrientId; amount: number }[] = [];
  for (const [ui, u] of targets.uls.entries()) {
    const terms: [string, number][] = [];
    for (const r of refs) {
      const b = upperValue(r.c.nutrients[u.compare]) * r.c.step;
      if (b > 1e-9) terms.push([r.n, b]);
    }
    if (!terms.length) continue;
    const slack = model.addVar(`ul_${ui}`, { lb: 0 });
    model.addObjective(slack, UL_PENALTY / u.amount);
    model.addConstraint(`ulc_${ui}`, [...terms, [slack, -1]], "<=", u.amount);
    ulSlacks.push({ v: slack, id: u.id, amount: u.amount });
  }

  // Macronutrient distribution (AMDR) when no calorie or macro targets are set: day level, in kcal.
  if (targets.amdr) {
    const amdr = targets.profile.amdr;
    const macro = (id: NutrientId, factor: number) =>
      refs.map((r) => [r.n, (r.c.nutrients[id]?.value ?? 0) * factor * r.c.step] as [string, number]);
    const energyTerms = refs.map((r) => [r.n, (r.c.nutrients.energy?.value ?? 0) * r.c.step] as [string, number]);
    const ranges: [NutrientId, number, [number, number]][] = [
      ["protein", 4, amdr.protein],
      ["fat", 9, amdr.fat],
      ["carbohydrate", 4, amdr.carbohydrate],
    ];
    for (const [id, kcal, [lo, hi]] of ranges) {
      const below = model.addVar(`amdr_${id}_lo`, { lb: 0 });
      const above = model.addVar(`amdr_${id}_hi`, { lb: 0 });
      model.addObjective(below, 0.005);
      model.addObjective(above, 0.005);
      const scaleE = (f: number) => energyTerms.map(([v, c]) => [v, -c * f] as [string, number]);
      model.addConstraint(`amdrlo_${id}`, [...macro(id, kcal), ...scaleE(lo / 100), [below, 1]], ">=", 0);
      model.addConstraint(`amdrhi_${id}`, [...macro(id, kcal), ...scaleE(hi / 100), [above, -1]], "<=", 0);
    }
  }

  // Calorie and macro targets (only those set). Each total must stay within ±tolerance
  // (hard; the band slack exists only to diagnose an impossible request), and inside the band
  // every gram or kcal away from the exact target still costs, so plans land as close as the menus allow.
  const macroSlacks: { v: string; id: MacroId; dir: "under" | "over" }[] = [];
  if (targets.macros) {
    const { targets: goal, tolerance } = targets.macros;
    for (const id of macroIds) {
      const target = goal[id]!;
      const terms = refs
        .map((r) => [r.n, (r.c.nutrients[id]?.value ?? 0) * r.c.step] as [string, number])
        .filter(([, v]) => v > 0);
      const under = model.addVar(`mu_${id}`, { lb: 0 });
      const over = model.addVar(`mo_${id}`, { lb: 0 });
      model.addObjective(under, MACRO_EXACT_WEIGHT / target);
      model.addObjective(over, MACRO_EXACT_WEIGHT / target);
      model.addConstraint(`mx_${id}`, [...terms, [under, 1], [over, -1]], "=", target);
      const bandUnder = model.addVar(`mbu_${id}`, { lb: 0 });
      const bandOver = model.addVar(`mbo_${id}`, { lb: 0 });
      model.addObjective(bandUnder, MACRO_BAND_PENALTY / target);
      model.addObjective(bandOver, MACRO_BAND_PENALTY / target);
      model.addConstraint(`mbuc_${id}`, [[under, 1], [bandUnder, -1]], "<=", target * tolerance);
      model.addConstraint(`mboc_${id}`, [[over, 1], [bandOver, -1]], "<=", target * tolerance);
      macroSlacks.push({ v: bandUnder, id, dir: "under" }, { v: bandOver, id, dir: "over" });
    }
    if (macroSkipped) {
      const one = macroSkipped === 1;
      warnings.push(
        `${macroSkipped} menu ${one ? "item" : "items"} without published or estimated values for your targets ${one ? "was" : "were"} left out, because ${one ? "it" : "they"} can't be counted toward them.`,
      );
    }
  }

  // Variety: the same dish in several meals costs a little.
  const byLineage = new Map<string, VarRef[]>();
  for (const r of refs) {
    const list = byLineage.get(r.c.lineageKey) ?? [];
    list.push(r);
    byLineage.set(r.c.lineageKey, list);
  }
  let li = 0;
  for (const list of byLineage.values()) {
    const mealsWith = new Set(list.map((r) => r.mealIndex));
    if (mealsWith.size < 2) continue;
    const rep = model.addVar(`rep_${li}`, { lb: 0 });
    model.addObjective(rep, 0.3);
    model.addConstraint(`variety_${li}`, [...list.map((r) => [r.y, 1] as [string, number]), [rep, -1]], "<=", 1);
    li++;
  }

  // "Show me something different": exclude plans already shown and exact repeats of regenerated meals.
  const refsByKey = new Map<string, VarRef[]>();
  for (const r of refs) {
    const k = `${r.c.period}:${r.c.foodId}`;
    refsByKey.set(k, [...(refsByKey.get(k) ?? []), r]);
  }
  // A shown plan may not repeat exactly; a regenerated meal must swap at least half of its unlocked items.
  // Items served at several locations have one variable per location, so every copy counts.
  const cuts: { keys: string[]; max: number }[] = [
    ...req.avoidSignatures.map((sig) => {
      const keys = sig.split("|").filter(Boolean);
      return { keys, max: keys.length - 1 };
    }),
    ...req.freshMeals.map((f) => ({ keys: f.foodIds.map((id) => `${f.period}:${id}`), max: Math.floor(f.foodIds.length / 2) })),
  ];
  cuts.forEach(({ keys, max }, ci) => {
    const vars = keys.flatMap((k) => refsByKey.get(k) ?? []);
    if (!keys.length || keys.some((k) => !refsByKey.has(k))) return;
    model.addConstraint(`cut_${ci}`, vars.map((v) => [v.y, 1] as [string, number]), "<=", max);
  });

  if (reasons.length) {
    return emptyResult(req, meals, targets, "infeasible", reasons, suggestions);
  }

  const solved = await solveModel(model, { timeLimitSec: 20, mipRelGap: 0.005 });
  if (solved.status !== "optimal" && solved.status !== "feasible") {
    const r = [
      solved.status === "infeasible"
        ? "No combination of the available items satisfies the hard requirements (locked items, one location per meal, item caps, and requests not to repeat earlier plans)."
        : `The solver stopped without a plan (${solved.rawStatus}).`,
    ];
    return emptyResult(req, meals, targets, solved.status === "infeasible" ? "infeasible" : "error", r, [
      "Unlock some items or allow more items per meal.",
      "Choose more dining locations for the affected meals.",
    ]);
  }

  // Read the solution.
  const planMeals: PlanMeal[] = meals.map((m, mi) => {
    if (mealUnavailable[mi]) {
      return {
        period: m.period,
        status: "unavailable",
        locationId: null,
        locationName: null,
        items: [],
        note: m.unavailableNote ?? "No menu items are available for this meal.",
        candidates: 0,
      };
    }
    const chosen = refs.filter((r) => r.mealIndex === mi && Math.round(solved.values.get(r.n) ?? 0) > 0);
    const items: PlanItem[] = chosen.map((r) => ({
      foodId: r.c.foodId,
      name: r.c.name,
      station: r.c.station,
      servings: Math.round(solved.values.get(r.n) ?? 0) * r.c.step,
      step: r.c.step,
      maxServings: r.maxSteps * r.c.step,
      servingLabel: r.c.servingLabel,
      servingGrams: r.c.servingGrams,
      nutrients: r.c.nutrients,
      confidence: r.c.confidence,
      allergens: r.c.allergens,
      dietaryLabels: r.c.dietaryLabels,
      locked: r.locked !== null,
      why: [],
    }));
    const loc = chosen[0]?.c;
    return {
      period: m.period,
      status: "planned",
      locationId: loc?.locationId ?? null,
      locationName: loc?.locationName ?? null,
      items,
      note: null,
      candidates: m.candidates.length,
    };
  });

  const lines = planLines(planMeals);
  const coverage = computeCoverage(lines, targets.summary);

  explainItems(planMeals, targets.summary);

  // Upper-limit diagnosis.
  let infeasibility: PlanResult["infeasibility"] = null;
  let status: PlanResult["status"] = solved.status;
  const over = ulSlacks.filter((s) => (solved.values.get(s.v) ?? 0) > 1e-6);
  if (over.length) {
    status = "infeasible";
    const lockedOnly = planMeals.every((m) => m.items.every((i) => i.locked));
    infeasibility = {
      reasons: over.map(
        (o) =>
          `${lockedOnly ? "Your locked items" : "Every plan the menus allow"} would exceed the upper limit for ${nutrientName(o.id)} (${fmtAmount(o.id, o.amount)}) at the high end of the estimates.`,
      ),
      suggestions: ["Unlock or reduce servings of the items highest in that nutrient.", "Allow more dining locations."],
    };
  }

  // Calorie and macro target diagnosis.
  const macroRows = targets.macros ? macroTargetRows(planMeals, targets.macros) : null;
  const missed = macroSlacks.filter((m) => (solved.values.get(m.v) ?? 0) > 1e-6);
  if (missed.length && macroRows && targets.macros) {
    status = "infeasible";
    const pctTol = Math.round(targets.macros.tolerance * 100);
    const reasonsM = [...new Set(missed.map((m) => m.id))].map((id) => {
      const row = macroRows.find((r) => r.id === id)!;
      const unit = id === "energy" ? "kcal" : "g";
      const fmt = (v: number) => `${Math.round(v).toLocaleString("en-US")} ${unit}`;
      return `The closest plan these menus allow has ${fmt(row.value ?? 0)} of ${id === "energy" ? "calories" : nutrientName(id)}, outside your ${fmt(row.target)} ±${pctTol}% target (${fmt(row.min)}–${fmt(row.max)}).`;
    });
    infeasibility = {
      reasons: [...(infeasibility?.reasons ?? []), ...reasonsM],
      suggestions: [
        ...(infeasibility?.suggestions ?? []),
        "Allow a wider tolerance, more items per meal or more servings per item.",
        "Choose more dining locations, or adjust the targets toward what these menus offer.",
      ],
    };
  }

  const summary = summarizePlan(planMeals, coverage);
  for (const m of planMeals) {
    if (m.status === "unavailable" && m.note) warnings.push(m.note);
  }
  for (const m of meals) {
    if (m.filteredOut > 0 && m.filterSummary.length) {
      warnings.push(`${m.period[0].toUpperCase()}${m.period.slice(1)}: ${m.filteredOut} items hidden by your filters (${m.filterSummary.slice(0, 3).join("; ")}).`);
    }
  }

  const e = energyTotal(lines);
  const energyRow = macroRows?.find((r) => r.id === "energy");
  const signature = planSignature(planMeals);

  return {
    status,
    universityId: req.universityId,
    date: req.date,
    strategy,
    referenceLabel: targets.profile.label,
    meals: planMeals,
    targets: targets.summary,
    coverage,
    energy: {
      ...e,
      min: energyRow?.min ?? null,
      max: energyRow?.max ?? null,
      shown: true,
    },
    macroTargets: macroRows,
    summary,
    warnings: [...warnings, ...targets.notes],
    infeasibility,
    model: {
      solver: "HiGHS (mixed-integer programming)",
      candidates: refs.length,
      variables: model.numVars,
      constraints: model.numConstraints,
      solveMs: Math.round(solved.timeMs),
      objective: solved.objective,
      notes: modelNotes(strategy),
    },
    signature,
    generatedAt: new Date().toISOString(),
  };
}

function emptyResult(
  req: PlanRequest,
  meals: MealCandidates[],
  targets: Targets,
  status: PlanResult["status"],
  reasons: string[],
  suggestions: string[],
): PlanResult {
  const filterHints = meals.flatMap((m) =>
    m.filteredOut > 0 && m.filterSummary.length
      ? [`${m.period}: ${m.filteredOut} items were removed by your filters (${m.filterSummary.slice(0, 3).join("; ")}).`]
      : [],
  );
  return {
    status,
    universityId: req.universityId,
    date: req.date,
    strategy: req.strategy,
    referenceLabel: targets.profile.label,
    meals: meals.map((m) => ({
      period: m.period,
      status: "unavailable",
      locationId: null,
      locationName: null,
      items: [],
      note: m.unavailableNote,
      candidates: m.candidates.length,
    })),
    targets: targets.summary,
    coverage: computeCoverage([], targets.summary),
    energy: { value: null, low: null, high: null, min: null, max: null, shown: true },
    summary: [],
    warnings: targets.notes,
    infeasibility: { reasons: [...reasons, ...filterHints], suggestions },
    model: {
      solver: "HiGHS (mixed-integer programming)",
      candidates: meals.reduce((n, m) => n + m.candidates.length, 0),
      variables: 0,
      constraints: 0,
      solveMs: 0,
      objective: null,
      notes: [],
    },
    signature: "",
    generatedAt: new Date().toISOString(),
  };
}

/** Planned totals against the calorie and macro targets that were set (energy first). */
export function macroTargetRows(meals: PlanMeal[], spec: MacroSpec): MacroTargetRow[] {
  const items = meals.flatMap((m) => m.items);
  return MACRO_IDS.filter((id) => spec.targets[id] !== undefined).map((id) => {
    const target = spec.targets[id]!;
    let value = 0;
    let known = 0;
    let unknownItems = 0;
    for (const i of items) {
      const v = i.nutrients[id]?.value;
      if (v === null || v === undefined) unknownItems++;
      else {
        value += v * i.servings;
        known++;
      }
    }
    return { id, target, min: target * (1 - spec.tolerance), max: target * (1 + spec.tolerance), value: known ? value : null, unknownItems };
  });
}

/** Plan summary in plain language. */
export function summarizePlan(meals: PlanMeal[], coverage: CoverageRow[]): string[] {
  const summary: string[] = [];
  const itemCount = meals.reduce((n, m) => n + m.items.length, 0);
  const goalRows = coverage.filter((r) => r.kind === "goal" && r.amount);
  const met = goalRows.filter((r) => (r.conservative ?? 0) >= (r.amount ?? Infinity));
  summary.push(`Meets the reference for ${met.length} of ${goalRows.length} nutrients even after discounting uncertain estimates.`);
  const lowest = [...goalRows]
    .filter((r) => r.percent !== null)
    .sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0))
    .slice(0, 3)
    .filter((r) => (r.percent ?? 100) < 70);
  if (lowest.length) {
    summary.push(
      `Hardest to reach from these menus: ${lowest.map((r) => `${nutrientName(r.id)} (≈${pct(r.percent ?? 0)})`).join(", ")}. One day below a reference is normal; it's the average over time that matters.`,
    );
  }
  for (const r of coverage.filter((x) => x.kind === "limit" && x.value !== null && x.amount)) {
    summary.push(`${NUTRIENTS[r.id].name} ≈ ${fmtAmount(r.id, r.value ?? 0)} (${pct(r.percent ?? 0)} of the ${fmtAmount(r.id, r.amount ?? 0)} limit).`);
  }
  const lowConfidence = meals.flatMap((m) => m.items).filter((i) => i.confidence === "low" || i.confidence === "none");
  if (lowConfidence.length) {
    summary.push(
      `${lowConfidence.length} of ${itemCount} items have low-confidence vitamin and mineral estimates, so the optimizer counted them conservatively.`,
    );
  }
  return summary;
}

/** The modelling choices behind every plan, shown in the "How this plan was built" panel. */
export function modelNotes(strategy: PlanRequest["strategy"]): string[] {
  return [
    `Strategy: ${STRATEGIES[strategy].label}. ${STRATEGIES[strategy].description}`,
    "Servings are whole or half portions, up to your per-item maximum; each meal comes from one dining location.",
    "Coverage below each reference is penalized more steeply as the gap grows; nothing extra is gained beyond 100%.",
    "Estimates are counted conservatively: medium-confidence values 15% and low-confidence values 35% of the way toward their low end (toward the high end for limits).",
    "A second serving of the same dish carries a small penalty, so plans favor variety and realistic portions.",
    "Upper intake levels use the high end of each estimate and are never exceeded unless no plan can avoid it.",
    "Unknown values are never treated as zero in totals; in planning they simply aren't counted toward goals.",
  ];
}
