/**
 * Runtime access to the compact USDA FoodData Central index built by
 * scripts/usda/build-index.ts, plus a transparent text matcher.
 *
 * The matcher is deliberately simple and explainable: IDF-weighted token
 * coverage between a menu name (or ingredient) and USDA descriptions, with
 * explicit, documented adjustments (raw vs. cooked, unusual forms such as
 * powders, preferred dataset). Every match result carries its score so the UI
 * can show why a record was chosen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { NutrientId } from "./nutrients";
import {
  USDA_SOURCE_CODES,
  type UsdaFood,
  type UsdaIndexFile,
  type UsdaSource,
} from "./usda-index-format";
import { COMPONENT_HEADS, COOKED_WORDS, RAW_WORDS, UNUSUAL_FORM_WORDS, tokenize } from "./text";

export interface IndexedFood extends UsdaFood {
  tokens: string[];
  tokenSet: Set<string>;
  headTokens: string[];
  /** Head noun of the description ("Spaghetti sauce" → "sauce", "Pasta with sauce" → "pasta"). */
  headNoun: string | null;
  /** Tokens before the first "with"/"in" (what the food is, not what it comes with). */
  mainTokenSet: Set<string>;
  group: FoodGroup;
}

export type FoodGroup =
  | "vegetable"
  | "fruit"
  | "grain"
  | "protein_animal"
  | "protein_plant"
  | "seafood"
  | "dairy"
  | "egg"
  | "fat_oil"
  | "sweet"
  | "beverage"
  | "mixed_dish"
  | "condiment"
  | "snack"
  | "other";

export interface UsdaIndex {
  version: string;
  sources: UsdaIndexFile["sources"];
  foods: IndexedFood[];
  byId: Map<number, IndexedFood>;
  postings: Map<string, number[]>;
  idf: Map<string, number>;
}

const globalForIndex = globalThis as unknown as { __cnoUsdaIndex?: UsdaIndex };

export function usdaIndexPath(): string {
  return process.env.USDA_INDEX_PATH || join(process.cwd(), "data", "usda", "usda-index.json.gz");
}

export function loadUsdaIndex(path = usdaIndexPath()): UsdaIndex {
  if (globalForIndex.__cnoUsdaIndex) return globalForIndex.__cnoUsdaIndex;
  // The index is bundled through outputFileTracingIncludes (next.config.ts).
  const file = JSON.parse(gunzipSync(readFileSync(/*turbopackIgnore: true*/ path)).toString("utf8")) as UsdaIndexFile;
  const foods: IndexedFood[] = [];
  const byId = new Map<number, IndexedFood>();
  const postings = new Map<string, number[]>();
  const df = new Map<string, number>();
  file.foods.forEach((row) => {
    const [fdcId, src, description, catIdx, values, approxIdx, portions, inputs, foodCode] = row;
    const per100g: Partial<Record<NutrientId, number | null>> = {};
    file.nutrientKeys.forEach((key, i) => {
      per100g[key] = values[i];
    });
    const category = file.categories[catIdx] ?? "Uncategorized";
    // Negated phrases ("without vegetables", "no potatoes") must not count as matches.
    const tokens = tokenize(stripNegations(description));
    const headSeg = stripNegations(description.split(",")[0] ?? "");
    const headTokens = tokenize(headSeg);
    const food: IndexedFood = {
      fdcId,
      source: USDA_SOURCE_CODES[src] as UsdaSource,
      description,
      category,
      per100g,
      approx: approxIdx.map((i) => file.nutrientKeys[i]),
      portions: portions.map(([d, g]) => ({ description: d, grams: g })),
      inputs: inputs.map(([d, g]) => ({ description: d, grams: g })),
      foodCode: foodCode || undefined,
      tokens,
      tokenSet: new Set(tokens),
      headTokens,
      headNoun: headNounOf(headSeg),
      mainTokenSet: new Set(tokenize(stripNegations(description.split(/\b(?:with|in)\b/i)[0] ?? description))),
      group: classifyFoodGroup(category, description),
    };
    const idx = foods.length;
    foods.push(food);
    byId.set(fdcId, food);
    for (const t of food.tokenSet) {
      let list = postings.get(t);
      if (!list) postings.set(t, (list = []));
      list.push(idx);
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  });
  const n = foods.length;
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log(1 + (n - d + 0.5) / (d + 0.5)));
  const index: UsdaIndex = { version: file.version, sources: file.sources, foods, byId, postings, idf };
  globalForIndex.__cnoUsdaIndex = index;
  return index;
}

/** Removes "excluding …;", "without …" and "no …" clauses from a USDA description. */
export function stripNegations(text: string): string {
  return text.replace(/\bexcluding\b[^;]*/gi, " ").replace(/\b(?:without|no)\s+[^,;]*/gi, " ");
}

function headNounOf(headSegment: string): string | null {
  const main = headSegment.split(/\b(?:with|in|on|and|or|including)\b/i)[0] ?? headSegment;
  const toks = tokenize(main);
  return toks.length ? toks[toks.length - 1] : null;
}

export function getUsdaFood(fdcId: number): IndexedFood | undefined {
  return loadUsdaIndex().byId.get(fdcId);
}

/* ------------------------------------------------------------------ */
/* Food-group classification (from USDA categories)                    */
/* ------------------------------------------------------------------ */

export function classifyFoodGroup(category: string, description: string): FoodGroup {
  const c = category.toLowerCase();
  const d = description.toLowerCase();
  if (c === "fruits and fruit juices") return /\bjuice|nectar|drink\b/.test(d) ? "beverage" : "fruit";
  if (/mixed dish|sandwich|pizza|burrito|taco|soup|entree|frozen dinner|restaurant|fast food|meals|stir-fry|casserole|stew/.test(c)) return "mixed_dish";
  if (/beverage|coffee|\btea\b|soft drink|juice|\bwater\b|smoothie|alcoholic|sport drink|energy drink|diet drink|nectar|fruit drink/.test(c)) return "beverage";
  if (/fish|shellfish|seafood|finfish/.test(c)) return "seafood";
  if (c === "dairy and egg products") {
    if (/^eggs?\b/.test(d)) return "egg";
    if (/^butter\b/.test(d)) return "fat_oil";
    return "dairy";
  }
  if (/\beggs?\b/.test(c) && !/sandwich|mixed/.test(c)) return "egg";
  if (/dessert|ice cream|sweets|candy|cake|cookie|\bpies?\b|pastr|doughnut|\bsugars?\b|syrup|pudding|brownie/.test(c)) return "sweet";
  if (/milk|cheese|yogurt|dairy|\bcream\b/.test(c)) return "dairy";
  if (/fats and oils|butter|margarine|\boils?\b/.test(c)) return "fat_oil";
  if (/string beans|green beans/.test(c) || /^(green|string|snap|wax) beans/.test(d)) return "vegetable";
  if (/legume|\bbeans?\b|nut and seed|\bnuts\b|\bseeds?\b|\bsoy\b|tofu|peanut|peas, legumes/.test(c)) return "protein_plant";
  if (/beef|pork|poultry|chicken|turkey|lamb|veal|\bgame\b|sausage|\bmeats?\b|frankfurter|cold cuts|bacon|deli/.test(c)) return "protein_animal";
  if (/vegetable|potato|lettuce|tomato|greens|carrot|broccoli|onion|\bcorn\b|salad|spinach|string beans/.test(c)) return "vegetable";
  if (/fruit|apple|banana|citrus|berr|melon|grape|peach/.test(c)) return "fruit";
  if (/cereal|grain|pasta|\brice\b|bread|\brolls?\b|bagel|tortilla|cracker|baked products|oatmeal|pancake|waffle|biscuit|muffin|noodle/.test(c)) return "grain";
  if (/condiment|sauce|dressing|gravy|\bdips?\b|spice|herb|seasoning|ketchup|mustard|salsa|jam|jelly/.test(c)) return "condiment";
  if (/snack|\bchips?\b|popcorn|pretzel/.test(c)) return "snack";
  if (/\btofu\b|lentil|chickpea|black bean|kidney bean|edamame/.test(d)) return "protein_plant";
  return "other";
}

/** Protein "families": a match that swaps one family for another is penalized. */
const PROTEIN_FAMILY: Record<string, string> = {
  chicken: "poultry",
  turkey: "poultry",
  duck: "poultry",
  beef: "beef",
  steak: "beef",
  brisket: "beef",
  pork: "pork",
  ham: "pork",
  bacon: "pork",
  carnitas: "pork",
  lamb: "lamb",
  fish: "fish",
  salmon: "fish",
  tuna: "fish",
  cod: "fish",
  tilapia: "fish",
  pollock: "fish",
  halibut: "fish",
  trout: "fish",
  catfish: "fish",
  mahi: "fish",
  swai: "fish",
  shrimp: "shellfish",
  crab: "shellfish",
  lobster: "shellfish",
  scallop: "shellfish",
  clam: "shellfish",
  oyster: "shellfish",
  mussel: "shellfish",
  tofu: "soy",
  tempeh: "soy",
  seitan: "wheat_gluten",
};

/** Words naming part of a plant or animal rather than the whole food. */
const PART_WORDS = ["skin", "peel", "stem", "rind", "hull", "zest"];

/** Broader USDA words that may stand in for a menu word. */
const TOKEN_ALIASES: Record<string, string[]> = {
  chicken: ["poultry"],
  turkey: ["poultry"],
  alfredo: ["cream"],
};

/** Words that describe preparation rather than identity; they count less toward a match. */
const PREP_WEIGHT = 0.35;
/** Protein words carry extra weight: "chicken" vs "beef" matters more than "sauce". */
const PROTEIN_WEIGHT = 1.8;

/** Generic meat words are compatible with any protein family ("sausage" may be pork or turkey). */
const GENERIC_MEAT = new Set(["meat", "sausage", "meatball", "frankfurter", "pepperoni", "salami", "deli", "seafood", "kabob", "gyro"]);

const RESTAURANT_BRANDS =
  /\((?:mcdonald'?s|burger king|wendy'?s|taco bell|subway|kfc|pizza hut|domino'?s|papa john'?s|starbucks|dunkin'?|chick-fil-a|popeyes|arby'?s|panera|chipotle|sonic|dairy queen|jack in the box|hardee'?s|carl'?s jr|little caesars|panda express|boston market|kraft|gerber)[^)]*\)/i;

function looksBranded(description: string): boolean {
  if (RESTAURANT_BRANDS.test(description)) return true;
  // SR Legacy branded rows contain runs of capitals, e.g. "HOUSE FOODS Premium Firm Tofu".
  return /\b[A-Z]{3,}(?:\s+[A-Z&']{2,})*\b/.test(description.replace(/\b(NFS|NS|USDA|RTE|RTF|UHT|USA|PB&J)\b/g, ""));
}

const categoryTokenCache = new Map<string, Set<string>>();
function categoryTokens(category: string): Set<string> {
  let set = categoryTokenCache.get(category);
  if (!set) {
    set = new Set(tokenize(category));
    categoryTokenCache.set(category, set);
  }
  return set;
}

export function isAnimalIronGroup(group: FoodGroup): boolean {
  return group === "protein_animal" || group === "seafood";
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

export type MatchMode = "dish" | "ingredient";

export interface MatchCandidate {
  food: IndexedFood;
  score: number;
  coverage: number;
  precision: number;
  adjustments: string[];
}

export interface SearchOptions {
  mode?: MatchMode;
  limit?: number;
  /** Assume the food is served cooked unless the text says otherwise. */
  assumeCooked?: boolean;
  /** Restrict to these datasets. */
  sources?: UsdaSource[];
}

const SOURCE_WEIGHT: Record<MatchMode, Record<UsdaSource, number>> = {
  dish: { fndds: 1.08, sr_legacy: 1.0, foundation: 1.0 },
  // FNDDS describes foods as eaten (often cooked or combined); recipes list raw ingredients.
  ingredient: { foundation: 1.05, sr_legacy: 1.04, fndds: 0.8 },
};

/** Groups that are normally eaten raw (so "raw" in the USDA description is fine). */
const RAW_OK_GROUPS = new Set<FoodGroup>(["fruit", "vegetable", "dairy", "beverage", "condiment", "fat_oil", "protein_plant", "snack", "sweet"]);

export function searchUsda(query: string, opts: SearchOptions = {}): MatchCandidate[] {
  const index = loadUsdaIndex();
  const mode = opts.mode ?? "dish";
  const qTokens = [...new Set(tokenize(query))];
  if (qTokens.length === 0) return [];
  const qSet = new Set(qTokens);
  const weightOf = (t: string) => {
    let w = index.idf.get(t) ?? Math.log(index.foods.length);
    if (COOKED_WORDS.has(t) || RAW_WORDS.has(t)) w *= PREP_WEIGHT;
    if (t in PROTEIN_FAMILY) w *= PROTEIN_WEIGHT;
    return w;
  };
  const queryWeight = qTokens.reduce((s, t) => s + weightOf(t), 0);
  const queryFamilies = new Set(qTokens.map((t) => PROTEIN_FAMILY[t]).filter(Boolean));
  // The "main" part of "X with Y" / "X in Y" / "X on Y" is X.
  const mainPart = query.split(/\s(?:with|w\/|in|on|over|topped)\s/i)[0] ?? query;
  const mainTokens = new Set(tokenize(mainPart));
  const mainList = tokenize(mainPart);
  const queryHead = mainList.length ? mainList[mainList.length - 1] : null;

  const candidateHits = new Map<number, number>();
  for (const t of qTokens) {
    for (const i of index.postings.get(t) ?? []) candidateHits.set(i, (candidateHits.get(i) ?? 0) + 1);
  }

  const queryCooked = qTokens.some((t) => COOKED_WORDS.has(t));
  const queryRaw = qTokens.some((t) => RAW_WORDS.has(t)) || qSet.has("salad");
  const assumeCooked = opts.assumeCooked ?? mode === "dish";

  const results: MatchCandidate[] = [];
  for (const [i] of candidateHits) {
    const food = index.foods[i];
    if (opts.sources && !opts.sources.includes(food.source)) continue;
    // Words such as "stir-fry" often name the USDA *category* rather than the description,
    // so a query word found only in the category counts as a partial match.
    const catTokens = categoryTokens(food.category);
    let matched = 0;
    let descMatched = 0;
    let catOnly = 0;
    for (const t of qTokens) {
      if (food.tokenSet.has(t)) {
        matched += weightOf(t);
        descMatched += weightOf(t);
      } else if (TOKEN_ALIASES[t]?.some((a) => food.tokenSet.has(a))) {
        // e.g. FNDDS says "poultry" where a menu says "chicken".
        matched += 0.85 * weightOf(t);
        descMatched += 0.85 * weightOf(t);
      } else if (catTokens.has(t)) {
        matched += 0.7 * weightOf(t);
        catOnly++;
      }
    }
    if (descMatched <= 0) continue;
    const coverage = matched / queryWeight;
    if (coverage < 0.34) continue;
    let docWeight = 0;
    for (const t of food.tokenSet) docWeight += weightOf(t);
    const precision = docWeight > 0 ? descMatched / docWeight : 0;

    const adjustments: string[] = [];
    if (catOnly) adjustments.push("category matches");
    let score = Math.pow(coverage, 1.6) * (0.4 + 0.6 * Math.sqrt(precision));

    // A record whose head noun is a component ("Sauce, pasta…") is a poor match for a
    // dish ("Spaghetti with marinara") unless the menu item itself is that component.
    const head = food.headNoun;
    if (mode === "dish" && head && COMPONENT_HEADS.has(head) && !mainTokens.has(head)) {
      score *= 0.6;
      adjustments.push(`only the ${head}`);
    }
    if (mode === "dish" && /not included in a food category/i.test(food.category)) {
      score *= 0.5;
      adjustments.push("recipe component, not a standalone food");
    }

    // The first comma segment of a USDA description is the food's head noun phrase.
    if (food.headTokens.length && food.headTokens.every((t) => qSet.has(t))) {
      score += 0.12;
      adjustments.push("head term matches");
    } else if (food.headTokens.some((t) => qSet.has(t))) {
      score += 0.04;
    }

    const descRaw = food.tokenSet.has("raw") || food.tokenSet.has("uncooked");
    const descCooked = [...food.tokenSet].some((t) => COOKED_WORDS.has(t));
    // "Chicken broth" is not "Chicken, canned, with broth": the query's head noun must
    // name the food itself, not something it is served with.
    if (queryHead && food.tokenSet.has(queryHead) && !food.mainTokenSet.has(queryHead)) {
      score *= 0.75;
      adjustments.push(`“${queryHead}” is only an accompaniment`);
    }
    if (
      mode === "ingredient" &&
      descCooked &&
      !queryCooked &&
      (food.group === "vegetable" || food.group === "protein_animal" || food.group === "seafood" || food.group === "egg")
    ) {
      score *= 0.88;
      adjustments.push("cooked form vs. raw ingredient");
    }
    if (descRaw && (queryCooked || (assumeCooked && !queryRaw && !RAW_OK_GROUPS.has(food.group)))) {
      score *= 0.72;
      adjustments.push("raw form vs. prepared food");
    } else if (queryRaw && descCooked && (food.group === "vegetable" || food.group === "fruit")) {
      score *= 0.85;
      adjustments.push("cooked form vs. raw food");
    }
    for (const t of food.tokenSet) {
      if (UNUSUAL_FORM_WORDS.has(t) && !qSet.has(t)) {
        if (t === "frozen" || t === "canned" || t === "enriched" || t === "fortified") {
          score *= 0.97;
        } else {
          score *= 0.7;
          adjustments.push(`unusual form "${t}"`);
        }
        break;
      }
    }
    // Protein-family conflicts: "chicken stir-fry" must not resolve to a beef stir-fry.
    const descFamilies = new Set([...food.tokenSet].map((t) => PROTEIN_FAMILY[t]).filter(Boolean));
    if (queryFamilies.size && descFamilies.size) {
      const shared = [...queryFamilies].some((f) => descFamilies.has(f));
      const foreign = [...descFamilies].some((f) => !queryFamilies.has(f));
      if (!shared) {
        score *= 0.4;
        adjustments.push("different protein");
      } else if (foreign) {
        score *= 0.85;
        adjustments.push("extra protein");
      }
    } else if (!queryFamilies.size && descFamilies.size && mode === "dish" && !qTokens.some((t) => GENERIC_MEAT.has(t))) {
      // e.g. "Vegetable soup" should prefer a meatless record.
      score *= 0.8;
      adjustments.push("adds a protein not on the menu");
    }
    // Parts of a plant ("Potatoes, raw, skin") are not the whole food unless asked for.
    const part = PART_WORDS.find((w) => food.tokenSet.has(w) && !qSet.has(w));
    if (part && !(part === "skin" && food.tokenSet.has("flesh"))) {
      score *= 0.6;
      adjustments.push(`only the ${part}`);
    }
    // US fluid milk is normally fortified with vitamins A and D.
    if (mode === "ingredient" && /milk/i.test(food.description) && /without added vitamin/i.test(food.description)) {
      score *= 0.88;
      adjustments.push("unfortified milk");
    }
    if (looksBranded(food.description)) {
      score *= 0.85;
      adjustments.push("brand-specific record");
    }
    if (/\b(babyfood|baby|toddler|infant)\b/i.test(food.description)) score *= 0.3;
    score *= SOURCE_WEIGHT[mode][food.source];
    results.push({ food, score, coverage, precision, adjustments });
  }
  results.sort((a, b) => b.score - a.score || a.food.description.length - b.food.description.length);
  return results.slice(0, opts.limit ?? 10);
}

/** Energy share of protein / carbohydrate / fat, from per-100g or per-serving values. */
export function macroShares(v: Partial<Record<NutrientId, number | null>>): [number, number, number] | null {
  const p = (v.protein ?? 0) * 4;
  const c = (v.carbohydrate ?? 0) * 4;
  const f = (v.fat ?? 0) * 9;
  const total = p + c + f;
  if (total <= 0) return null;
  return [p / total, c / total, f / total];
}

/** Half the L1 distance between two macro-share vectors (0 = identical, 1 = disjoint). */
export function macroDistance(a: [number, number, number] | null, b: [number, number, number] | null): number | null {
  if (!a || !b) return null;
  return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 2;
}
