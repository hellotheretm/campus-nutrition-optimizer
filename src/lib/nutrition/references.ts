/**
 * Nutrient reference standards.
 *
 * Reference values are kept completely separate from measured or estimated
 * food amounts. They are general population benchmarks for healthy people,
 * not personal prescriptions, and a single day's intake is never treated as
 * a deficiency.
 *
 * Sources
 * - FDA Daily Values: 21 CFR 101.9(c)(8)(iv) and (c)(9), as updated by the
 *   2016 Nutrition Facts label final rule (adults and children 4+ years).
 * - National Academies of Sciences, Engineering, and Medicine (NASEM)
 *   Dietary Reference Intakes: RDA / AI / UL summary tables (Institute of
 *   Medicine 1997–2011; sodium and potassium updated 2019).
 */
import type { NutrientId } from "./nutrients";

export type ReferenceStandard = "fda_dv" | "dri";
export type AgeGroup = "under_19" | "19_30" | "31_50" | "51_70" | "71_plus" | "unspecified";
export type ReferenceSex = "female" | "male" | "unspecified";

export type ReferenceKind = "DV" | "RDA" | "AI";

export interface ReferenceValue {
  amount: number;
  kind: ReferenceKind;
}

export interface UpperLimit {
  amount: number;
  /**
   * - total: applies to intake from all food sources (compare directly)
   * - supplemental: applies only to supplements/fortificants (do not compare
   *   against food totals; shown as context only)
   * - preformed: applies only to preformed vitamin A (retinol)
   * - cdrr: Chronic Disease Risk Reduction intake (sodium)
   */
  appliesTo: "total" | "supplemental" | "preformed" | "cdrr";
  /** The nutrient the limit is compared against (e.g. retinol for vitamin A). */
  compareWith?: NutrientId;
}

export interface MacroRange {
  /** Acceptable Macronutrient Distribution Range, % of energy. */
  protein: [number, number];
  fat: [number, number];
  carbohydrate: [number, number];
}

export interface ReferenceProfile {
  key: string;
  label: string;
  shortLabel: string;
  standard: ReferenceStandard;
  values: Partial<Record<NutrientId, ReferenceValue>>;
  upperLimits: Partial<Record<NutrientId, UpperLimit>>;
  amdr: MacroRange;
  /** Label-based "limit" style values (FDA DVs based on a 2,000 kcal diet). */
  limits: Partial<Record<NutrientId, number>>;
  isMinor: boolean;
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* FDA Daily Values (adults & children ≥ 4 years)                      */
/* ------------------------------------------------------------------ */

const FDA_DV: Partial<Record<NutrientId, number>> = {
  protein: 50,
  carbohydrate: 275,
  fat: 78,
  fiber: 28,
  vitamin_a: 900,
  vitamin_c: 90,
  vitamin_d: 20,
  vitamin_e: 15,
  vitamin_k: 120,
  thiamin: 1.2,
  riboflavin: 1.3,
  niacin: 16,
  vitamin_b6: 1.7,
  folate: 400,
  vitamin_b12: 2.4,
  biotin: 30,
  pantothenic_acid: 5,
  choline: 550,
  calcium: 1300,
  iron: 18,
  phosphorus: 1250,
  iodine: 150,
  magnesium: 420,
  zinc: 11,
  selenium: 55,
  copper: 0.9,
  manganese: 2.3,
  chromium: 35,
  molybdenum: 45,
  potassium: 4700,
};

/** FDA DVs that act as "limit" style benchmarks rather than goals. */
const FDA_LIMITS: Partial<Record<NutrientId, number>> = {
  sodium: 2300,
  saturated_fat: 20,
  cholesterol: 300,
  added_sugars: 50,
};

/* ------------------------------------------------------------------ */
/* NASEM Dietary Reference Intakes                                    */
/* ------------------------------------------------------------------ */

type Stage = "14_18" | "19_30" | "31_50" | "51_70" | "71_plus";
type SexKey = "m" | "f";
type DriRow = Record<Stage, [m: number, f: number]>;

const same = (v: number): [number, number] => [v, v];

/** Recommended Dietary Allowances (RDA) and Adequate Intakes (AI). */
const DRI: Partial<Record<NutrientId, { kind: ReferenceKind; rows: DriRow }>> = {
  protein: { kind: "RDA", rows: { "14_18": [52, 46], "19_30": [56, 46], "31_50": [56, 46], "51_70": [56, 46], "71_plus": [56, 46] } },
  carbohydrate: { kind: "RDA", rows: { "14_18": same(130), "19_30": same(130), "31_50": same(130), "51_70": same(130), "71_plus": same(130) } },
  fiber: { kind: "AI", rows: { "14_18": [38, 26], "19_30": [38, 25], "31_50": [38, 25], "51_70": [30, 21], "71_plus": [30, 21] } },
  vitamin_a: { kind: "RDA", rows: { "14_18": [900, 700], "19_30": [900, 700], "31_50": [900, 700], "51_70": [900, 700], "71_plus": [900, 700] } },
  vitamin_c: { kind: "RDA", rows: { "14_18": [75, 65], "19_30": [90, 75], "31_50": [90, 75], "51_70": [90, 75], "71_plus": [90, 75] } },
  vitamin_d: { kind: "RDA", rows: { "14_18": same(15), "19_30": same(15), "31_50": same(15), "51_70": same(15), "71_plus": same(20) } },
  vitamin_e: { kind: "RDA", rows: { "14_18": same(15), "19_30": same(15), "31_50": same(15), "51_70": same(15), "71_plus": same(15) } },
  vitamin_k: { kind: "AI", rows: { "14_18": same(75), "19_30": [120, 90], "31_50": [120, 90], "51_70": [120, 90], "71_plus": [120, 90] } },
  thiamin: { kind: "RDA", rows: { "14_18": [1.2, 1.0], "19_30": [1.2, 1.1], "31_50": [1.2, 1.1], "51_70": [1.2, 1.1], "71_plus": [1.2, 1.1] } },
  riboflavin: { kind: "RDA", rows: { "14_18": [1.3, 1.0], "19_30": [1.3, 1.1], "31_50": [1.3, 1.1], "51_70": [1.3, 1.1], "71_plus": [1.3, 1.1] } },
  niacin: { kind: "RDA", rows: { "14_18": [16, 14], "19_30": [16, 14], "31_50": [16, 14], "51_70": [16, 14], "71_plus": [16, 14] } },
  vitamin_b6: { kind: "RDA", rows: { "14_18": [1.3, 1.2], "19_30": same(1.3), "31_50": same(1.3), "51_70": [1.7, 1.5], "71_plus": [1.7, 1.5] } },
  folate: { kind: "RDA", rows: { "14_18": same(400), "19_30": same(400), "31_50": same(400), "51_70": same(400), "71_plus": same(400) } },
  vitamin_b12: { kind: "RDA", rows: { "14_18": same(2.4), "19_30": same(2.4), "31_50": same(2.4), "51_70": same(2.4), "71_plus": same(2.4) } },
  pantothenic_acid: { kind: "AI", rows: { "14_18": same(5), "19_30": same(5), "31_50": same(5), "51_70": same(5), "71_plus": same(5) } },
  biotin: { kind: "AI", rows: { "14_18": same(25), "19_30": same(30), "31_50": same(30), "51_70": same(30), "71_plus": same(30) } },
  choline: { kind: "AI", rows: { "14_18": [550, 400], "19_30": [550, 425], "31_50": [550, 425], "51_70": [550, 425], "71_plus": [550, 425] } },
  calcium: { kind: "RDA", rows: { "14_18": same(1300), "19_30": same(1000), "31_50": same(1000), "51_70": [1000, 1200], "71_plus": same(1200) } },
  chromium: { kind: "AI", rows: { "14_18": [35, 24], "19_30": [35, 25], "31_50": [35, 25], "51_70": [30, 20], "71_plus": [30, 20] } },
  copper: { kind: "RDA", rows: { "14_18": same(0.89), "19_30": same(0.9), "31_50": same(0.9), "51_70": same(0.9), "71_plus": same(0.9) } },
  iodine: { kind: "RDA", rows: { "14_18": same(150), "19_30": same(150), "31_50": same(150), "51_70": same(150), "71_plus": same(150) } },
  iron: { kind: "RDA", rows: { "14_18": [11, 15], "19_30": [8, 18], "31_50": [8, 18], "51_70": same(8), "71_plus": same(8) } },
  magnesium: { kind: "RDA", rows: { "14_18": [410, 360], "19_30": [400, 310], "31_50": [420, 320], "51_70": [420, 320], "71_plus": [420, 320] } },
  manganese: { kind: "AI", rows: { "14_18": [2.2, 1.6], "19_30": [2.3, 1.8], "31_50": [2.3, 1.8], "51_70": [2.3, 1.8], "71_plus": [2.3, 1.8] } },
  molybdenum: { kind: "RDA", rows: { "14_18": same(43), "19_30": same(45), "31_50": same(45), "51_70": same(45), "71_plus": same(45) } },
  phosphorus: { kind: "RDA", rows: { "14_18": same(1250), "19_30": same(700), "31_50": same(700), "51_70": same(700), "71_plus": same(700) } },
  selenium: { kind: "RDA", rows: { "14_18": same(55), "19_30": same(55), "31_50": same(55), "51_70": same(55), "71_plus": same(55) } },
  zinc: { kind: "RDA", rows: { "14_18": [11, 9], "19_30": [11, 8], "31_50": [11, 8], "51_70": [11, 8], "71_plus": [11, 8] } },
  potassium: { kind: "AI", rows: { "14_18": [3000, 2300], "19_30": [3400, 2600], "31_50": [3400, 2600], "51_70": [3400, 2600], "71_plus": [3400, 2600] } },
  omega3_ala: { kind: "AI", rows: { "14_18": [1.6, 1.1], "19_30": [1.6, 1.1], "31_50": [1.6, 1.1], "51_70": [1.6, 1.1], "71_plus": [1.6, 1.1] } },
  omega6_la: { kind: "AI", rows: { "14_18": [16, 11], "19_30": [17, 12], "31_50": [17, 12], "51_70": [14, 11], "71_plus": [14, 11] } },
};

/** Tolerable Upper Intake Levels. Values: [14–18, 19–30, 31–50, 51–70, 71+]. */
const UL: Partial<Record<NutrientId, { appliesTo: UpperLimit["appliesTo"]; compareWith?: NutrientId; byStage: Record<Stage, number> }>> = {
  vitamin_a: { appliesTo: "preformed", compareWith: "retinol", byStage: { "14_18": 2800, "19_30": 3000, "31_50": 3000, "51_70": 3000, "71_plus": 3000 } },
  vitamin_c: { appliesTo: "total", byStage: { "14_18": 1800, "19_30": 2000, "31_50": 2000, "51_70": 2000, "71_plus": 2000 } },
  vitamin_d: { appliesTo: "total", byStage: { "14_18": 100, "19_30": 100, "31_50": 100, "51_70": 100, "71_plus": 100 } },
  vitamin_e: { appliesTo: "supplemental", byStage: { "14_18": 800, "19_30": 1000, "31_50": 1000, "51_70": 1000, "71_plus": 1000 } },
  niacin: { appliesTo: "supplemental", byStage: { "14_18": 30, "19_30": 35, "31_50": 35, "51_70": 35, "71_plus": 35 } },
  vitamin_b6: { appliesTo: "total", byStage: { "14_18": 80, "19_30": 100, "31_50": 100, "51_70": 100, "71_plus": 100 } },
  folate: { appliesTo: "supplemental", byStage: { "14_18": 800, "19_30": 1000, "31_50": 1000, "51_70": 1000, "71_plus": 1000 } },
  choline: { appliesTo: "total", byStage: { "14_18": 3000, "19_30": 3500, "31_50": 3500, "51_70": 3500, "71_plus": 3500 } },
  calcium: { appliesTo: "total", byStage: { "14_18": 3000, "19_30": 2500, "31_50": 2500, "51_70": 2000, "71_plus": 2000 } },
  copper: { appliesTo: "total", byStage: { "14_18": 8, "19_30": 10, "31_50": 10, "51_70": 10, "71_plus": 10 } },
  iodine: { appliesTo: "total", byStage: { "14_18": 900, "19_30": 1100, "31_50": 1100, "51_70": 1100, "71_plus": 1100 } },
  iron: { appliesTo: "total", byStage: { "14_18": 45, "19_30": 45, "31_50": 45, "51_70": 45, "71_plus": 45 } },
  magnesium: { appliesTo: "supplemental", byStage: { "14_18": 350, "19_30": 350, "31_50": 350, "51_70": 350, "71_plus": 350 } },
  manganese: { appliesTo: "total", byStage: { "14_18": 9, "19_30": 11, "31_50": 11, "51_70": 11, "71_plus": 11 } },
  molybdenum: { appliesTo: "total", byStage: { "14_18": 1700, "19_30": 2000, "31_50": 2000, "51_70": 2000, "71_plus": 2000 } },
  phosphorus: { appliesTo: "total", byStage: { "14_18": 4000, "19_30": 4000, "31_50": 4000, "51_70": 4000, "71_plus": 3000 } },
  selenium: { appliesTo: "total", byStage: { "14_18": 400, "19_30": 400, "31_50": 400, "51_70": 400, "71_plus": 400 } },
  zinc: { appliesTo: "total", byStage: { "14_18": 34, "19_30": 40, "31_50": 40, "51_70": 40, "71_plus": 40 } },
  sodium: { appliesTo: "cdrr", byStage: { "14_18": 2300, "19_30": 2300, "31_50": 2300, "51_70": 2300, "71_plus": 2300 } },
};

const AMDR_ADULT: MacroRange = { protein: [10, 35], fat: [20, 35], carbohydrate: [45, 65] };
const AMDR_TEEN: MacroRange = { protein: [10, 30], fat: [25, 35], carbohydrate: [45, 65] };

function stageFor(age: AgeGroup): Stage {
  switch (age) {
    case "under_19":
      return "14_18";
    case "31_50":
      return "31_50";
    case "51_70":
      return "51_70";
    case "71_plus":
      return "71_plus";
    default:
      return "19_30";
  }
}

const SEX_INDEX: Record<SexKey, 0 | 1> = { m: 0, f: 1 };

export const AGE_GROUP_LABELS: Record<AgeGroup, string> = {
  under_19: "Under 19",
  "19_30": "19–30",
  "31_50": "31–50",
  "51_70": "51–70",
  "71_plus": "71+",
  unspecified: "Prefer not to say",
};

export interface ReferenceSelection {
  standard: ReferenceStandard;
  ageGroup: AgeGroup;
  sex: ReferenceSex;
}

export const DEFAULT_REFERENCE: ReferenceSelection = {
  standard: "fda_dv",
  ageGroup: "unspecified",
  sex: "unspecified",
};

/**
 * Users under 19 get balanced-nutrition suggestions only: no calorie or
 * macro targets are offered.
 */
export function isMinorAgeGroup(age: AgeGroup): boolean {
  return age === "under_19";
}

/**
 * Calorie and protein goals are offered only to adults who chose an age
 * group of 19 or older. Under 19, or age not given, means no targets.
 */
export function goalsAllowed(age: AgeGroup): boolean {
  return age !== "under_19" && age !== "unspecified";
}

export function getReferenceProfile(sel: ReferenceSelection = DEFAULT_REFERENCE): ReferenceProfile {
  const isMinor = isMinorAgeGroup(sel.ageGroup);
  const stage = stageFor(sel.ageGroup);

  // Upper limits always come from the DRI tables for the life stage (adults 19–30 when unspecified).
  const upperLimits: Partial<Record<NutrientId, UpperLimit>> = {};
  for (const [id, ul] of Object.entries(UL) as [NutrientId, NonNullable<(typeof UL)[NutrientId]>][]) {
    upperLimits[id] = { amount: ul.byStage[stage], appliesTo: ul.appliesTo, compareWith: ul.compareWith };
  }

  const amdr = stage === "14_18" ? AMDR_TEEN : AMDR_ADULT;

  // Minors always use DRIs for their life stage: FDA DVs are designed around adult labels.
  const useDri = sel.standard === "dri" || isMinor;

  if (!useDri) {
    const values: Partial<Record<NutrientId, ReferenceValue>> = {};
    for (const [id, amount] of Object.entries(FDA_DV) as [NutrientId, number][]) {
      values[id] = { amount, kind: "DV" };
    }
    return {
      key: "fda_dv",
      label: "FDA Daily Values (adults & children 4+)",
      shortLabel: "FDA Daily Values",
      standard: "fda_dv",
      values,
      upperLimits,
      amdr,
      limits: { ...FDA_LIMITS },
      isMinor,
      notes: [
        "Daily Values are the reference amounts used on Nutrition Facts labels. They are a general benchmark, not a personal target.",
        "Some Daily Values (like calcium and iron) are set high enough to cover most groups, so 100% may be more than you personally need.",
      ],
    };
  }

  const values: Partial<Record<NutrientId, ReferenceValue>> = {};
  for (const [id, def] of Object.entries(DRI) as [NutrientId, NonNullable<(typeof DRI)[NutrientId]>][]) {
    const [m, f] = def.rows[stage];
    let amount: number;
    if (sel.sex === "male") amount = m;
    else if (sel.sex === "female") amount = f;
    else amount = Math.max(m, f);
    values[id] = { amount, kind: def.kind };
  }
  const sexLabel = sel.sex === "unspecified" ? "sex not specified (higher of male/female values)" : sel.sex;
  const stageLabel = stage === "14_18" ? "14–18" : AGE_GROUP_LABELS[sel.ageGroup === "unspecified" ? "19_30" : sel.ageGroup];
  return {
    key: `dri_${stage}_${sel.sex}`,
    label: `Dietary Reference Intakes · ages ${stageLabel} · ${sexLabel}`,
    shortLabel: `DRI ${stageLabel}`,
    standard: "dri",
    values,
    upperLimits,
    amdr,
    limits: { ...FDA_LIMITS },
    isMinor,
    notes: [
      "RDAs cover the needs of nearly all healthy people in a group; AIs are used when evidence is not strong enough to set an RDA.",
      "These are long-term averages. Falling short on a single day is normal and is not a deficiency.",
      ...(isMinor ? ["For people under 19 the app focuses on balanced, varied meals and does not offer calorie or macro targets."] : []),
      ...(sel.ageGroup === "unspecified" ? ["Age not specified: adult (19–30) values are shown."] : []),
    ],
  };
}

/** Index of SEX_INDEX kept exported for tests. */
export const __test = { SEX_INDEX, stageFor };
