/**
 * Dietary filters for the optimizer and menu views.
 *
 * Diet patterns rely on the dining hall's own labels: an item without a
 * vegetarian or vegan label is not treated as vegetarian or vegan. Allergen
 * avoidance removes items the source labels with that allergen AND items
 * whose ingredient text mentions a related word. These filters can only
 * remove more items; they never certify that an item is safe. Cross-contact
 * and recipe changes are always possible, so users with allergies must
 * confirm with dining staff.
 */
import type { DietFilterInput } from "./types";

export interface FilterableFood {
  name: string;
  ingredients: string | null;
  allergens: string[];
  dietaryLabels: string[];
}

const PLANT_MILKS = /\b(coconut|oat|almond|soy|soya|rice|cashew|hemp|pea|flax)\s+(milk|cream|yogurt|yoghurt|cheese|butter)\b/gi;

/** Ingredient words associated with each allergen (used only to exclude more). */
export const ALLERGEN_TERMS: Record<string, RegExp> = {
  milk: /\b(milk|cheeses?|butter|buttermilk|cream|whey|casein(ate)?|yogh?urt|lactose|ghee|kefir|curds?|paneer|ricotta|mozzarella|parmesan|cheddar|provolone|feta|queso|half[- ]and[- ]half|custard)\b/i,
  egg: /\b(eggs?|egg whites?|albumin|mayonnaise|mayo|meringue|aioli)\b/i,
  fish: /\b(fish|salmon|tuna|cod|tilapia|pollock|anchov(y|ies)|sardines?|trout|halibut|catfish|haddock|mahi|swordfish|worcestershire)\b/i,
  shellfish: /\b(shrimp|crabs?|lobster|craw(fish)?|crayfish|prawns?|scallops?|clams?|oysters?|mussels?|shellfish)\b/i,
  tree_nuts: /\b(almonds?|walnuts?|pecans?|cashews?|pistachios?|hazelnuts?|macadamia|brazil nuts?|pine nuts?|praline|marzipan|nutella|tree nuts?)\b/i,
  peanuts: /\b(peanuts?|groundnuts?|peanut butter)\b/i,
  wheat: /\b(wheat|flour|semolina|durum|farina|bulgur|couscous|seitan|spelt|farro|panko|bread(ed|ing|crumbs?)?|pasta|noodles?|tortillas?|croutons?|crackers?|biscuits?|buns?|rolls?|pita|naan|bagels?|muffins?|pancakes?|waffles?)\b/i,
  soy: /\b(soy|soya|soybeans?|tofu|edamame|tempeh|miso|tamari|lecithin)\b/i,
  sesame: /\b(sesame|tahini|benne)\b/i,
  gluten: /\b(wheat|flour|semolina|durum|farina|bulgur|couscous|seitan|spelt|farro|barley|rye|malt|triticale|oats?|oatmeal|panko|bread(ed|ing|crumbs?)?|pasta|noodles?|tortillas?|croutons?|crackers?|biscuits?|buns?|rolls?|pita|naan|bagels?|muffins?|pancakes?|waffles?|brewer'?s yeast)\b/i,
};

/** Words that mark non-wheat versions, which the wheat/gluten checks should ignore. */
const NON_WHEAT = /\b(rice|corn|almond|chickpea|garbanzo|coconut|cassava|tapioca|potato|buckwheat|sorghum|gluten[- ]free)\s+(flour|noodles?|pasta|tortillas?|bread|crackers?|buns?|rolls?|oats?)\b/gi;

const MEAT_TERMS =
  /\b(chicken|beef|pork|turkey|bacon|ham|sausages?|pepperoni|salami|lamb|veal|bison|venison|gelatin|lard|chorizo|prosciutto|meatballs?|duck|goat|steak|brisket|carnitas)\b/i;

function textOf(food: FilterableFood): string {
  return `${food.name} ${food.ingredients ?? ""}`.toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function termMatches(text: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  return new RegExp(`\\b${escapeRegExp(t)}(e?s)?\\b`, "i").test(text);
}

export function effectiveAllergens(prefs: DietFilterInput): string[] {
  const set = new Set(prefs.avoidAllergens.map((a) => a.toLowerCase()));
  if (prefs.avoidDairy) set.add("milk");
  if (prefs.avoidNuts) {
    set.add("tree_nuts");
    set.add("peanuts");
  }
  if (prefs.avoidGluten) {
    set.add("gluten");
    set.add("wheat");
  }
  return [...set];
}

export interface FilterVerdict {
  ok: boolean;
  /** Short reasons, e.g. "not labeled vegan", "labeled: soy". */
  reasons: string[];
}

export function checkFood(food: FilterableFood, prefs: DietFilterInput): FilterVerdict {
  const reasons: string[] = [];
  const labels = new Set(food.dietaryLabels);
  const text = textOf(food);

  if (prefs.pattern === "vegan" && !labels.has("vegan")) reasons.push("not labeled vegan");
  if (prefs.pattern === "vegetarian" && !labels.has("vegetarian") && !labels.has("vegan")) {
    reasons.push("not labeled vegetarian");
  }
  if (prefs.pattern === "pescatarian" && !labels.has("vegetarian") && !labels.has("vegan")) {
    const seafood = food.allergens.includes("fish") || food.allergens.includes("shellfish");
    if (!seafood || MEAT_TERMS.test(text) || labels.has("contains_pork") || labels.has("contains_beef")) {
      reasons.push("not labeled vegetarian or seafood");
    }
  }

  const plantSafe = text.replace(PLANT_MILKS, " ");
  const wheatSafe = text.replace(NON_WHEAT, " ");
  for (const allergen of effectiveAllergens(prefs)) {
    if (food.allergens.includes(allergen)) {
      reasons.push(`labeled: ${allergen.replace("_", " ")}`);
      continue;
    }
    const re = ALLERGEN_TERMS[allergen];
    if (!re) continue;
    const haystack = allergen === "milk" ? plantSafe : allergen === "wheat" || allergen === "gluten" ? wheatSafe : text;
    if (allergen === "gluten" && food.dietaryLabels.includes("made_without_gluten")) continue;
    if (re.test(haystack)) reasons.push(`ingredients mention ${allergen.replace("_", " ")}`);
  }

  for (const term of prefs.excludedIngredients) {
    if (termMatches(text, term)) reasons.push(`contains "${term}"`);
  }
  for (const term of prefs.dislikes) {
    if (termMatches(text, term)) reasons.push(`disliked: "${term}"`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function isPreferred(food: FilterableFood, prefs: DietFilterInput): boolean {
  return prefs.preferred.some((term) => termMatches(food.name.toLowerCase(), term));
}

export function isPlantLabeled(food: FilterableFood): boolean {
  return food.dietaryLabels.includes("vegan") || food.dietaryLabels.includes("vegetarian");
}

/** Summarizes why items were filtered out, for infeasibility explanations. */
export function summarizeReasons(verdicts: FilterVerdict[]): string[] {
  const counts = new Map<string, number>();
  for (const v of verdicts) {
    for (const r of new Set(v.reasons.map((x) => x.replace(/"[^"]*"/, (m) => m)))) {
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([r, n]) => `${n} ${n === 1 ? "item" : "items"} ${r}`);
}
