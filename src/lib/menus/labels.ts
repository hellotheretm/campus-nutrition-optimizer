/**
 * Normalization of allergen and dietary labels coming from menu sources.
 *
 * Labels are only ever taken from the source. Nothing here infers an allergen
 * from an ingredient list, and the absence of a label never means a food is
 * free of that allergen.
 */

export const MAJOR_ALLERGENS = [
  "milk",
  "egg",
  "fish",
  "shellfish",
  "tree_nuts",
  "peanuts",
  "wheat",
  "soy",
  "sesame",
] as const;

export type CanonicalAllergen = (typeof MAJOR_ALLERGENS)[number] | "gluten";

export const ALLERGEN_LABELS: Record<CanonicalAllergen, string> = {
  milk: "Milk",
  egg: "Egg",
  fish: "Fish",
  shellfish: "Shellfish",
  tree_nuts: "Tree nuts",
  peanuts: "Peanuts",
  wheat: "Wheat",
  soy: "Soy",
  sesame: "Sesame",
  gluten: "Gluten",
};

const ALLERGEN_ALIASES: Record<string, CanonicalAllergen> = {
  milk: "milk",
  dairy: "milk",
  "contains milk": "milk",
  egg: "egg",
  eggs: "egg",
  "contains egg": "egg",
  fish: "fish",
  shellfish: "shellfish",
  "crustacean shellfish": "shellfish",
  crustacean: "shellfish",
  "tree nut": "tree_nuts",
  "tree nuts": "tree_nuts",
  treenuts: "tree_nuts",
  "tree_nuts": "tree_nuts",
  peanut: "peanuts",
  peanuts: "peanuts",
  wheat: "wheat",
  soy: "soy",
  soybean: "soy",
  soybeans: "soy",
  sesame: "sesame",
  gluten: "gluten",
  "contains gluten": "gluten",
};

export const DIETARY_LABELS: Record<string, string> = {
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  made_without_gluten: "Made without gluten ingredients",
  halal: "Halal",
  kosher: "Kosher",
  plant_forward: "Plant-forward",
  local: "Local",
  organic: "Organic",
  contains_pork: "Contains pork",
  contains_beef: "Contains beef",
  contains_alcohol: "Contains alcohol",
};

const DIETARY_ALIASES: Record<string, string> = {
  vegetarian: "vegetarian",
  veg: "vegetarian",
  vegan: "vegan",
  "plant based": "vegan",
  "gluten free": "made_without_gluten",
  "gluten-free": "made_without_gluten",
  "made without gluten": "made_without_gluten",
  "made without gluten ingredients": "made_without_gluten",
  "made without gluten-containing ingredients": "made_without_gluten",
  halal: "halal",
  kosher: "kosher",
  "plant forward": "plant_forward",
  "plant-forward": "plant_forward",
  local: "local",
  "locally sourced": "local",
  organic: "organic",
  pork: "contains_pork",
  "contains pork": "contains_pork",
  beef: "contains_beef",
  "contains beef": "contains_beef",
  alcohol: "contains_alcohol",
  "contains alcohol": "contains_alcohol",
};

function clean(label: string): string {
  return label
    .toLowerCase()
    .replace(/[_]+/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(label: string): string {
  return clean(label).replace(/[\s-]+/g, "_");
}

export interface SplitLabels {
  allergens: string[];
  dietary: string[];
}

/**
 * Sorts raw source labels (icons, tags, columns) into allergens and dietary
 * labels. Unrecognized labels are kept as dietary labels in slug form, so no
 * source information is dropped.
 */
export function splitLabels(raw: Iterable<string | null | undefined>): SplitLabels {
  const allergens = new Set<string>();
  const dietary = new Set<string>();
  for (const value of raw) {
    if (!value) continue;
    const c = clean(value);
    if (!c) continue;
    const allergen = ALLERGEN_ALIASES[c] ?? ALLERGEN_ALIASES[c.replace(/^contains /, "")];
    if (allergen) {
      allergens.add(allergen);
      continue;
    }
    const diet = DIETARY_ALIASES[c];
    dietary.add(diet ?? slug(value));
  }
  return { allergens: [...allergens].sort(), dietary: [...dietary].sort() };
}

export function normalizeAllergens(raw: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const value of raw) {
    if (!value) continue;
    const c = clean(value);
    if (!c) continue;
    out.add(ALLERGEN_ALIASES[c] ?? ALLERGEN_ALIASES[c.replace(/^contains /, "")] ?? slug(value));
  }
  return [...out].sort();
}

export function normalizeDietary(raw: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const value of raw) {
    if (!value) continue;
    const c = clean(value);
    if (!c) continue;
    out.add(DIETARY_ALIASES[c] ?? slug(value));
  }
  return [...out].sort();
}

export function allergenLabel(key: string): string {
  return ALLERGEN_LABELS[key as CanonicalAllergen] ?? titleCase(key);
}

export function dietaryLabel(key: string): string {
  return DIETARY_LABELS[key] ?? titleCase(key);
}

function titleCase(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
