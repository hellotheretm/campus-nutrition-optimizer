/**
 * Ingredient-statement parser.
 *
 * US ingredient statements list ingredients in descending order of
 * predominance by weight (21 CFR 101.4(a)). Ingredients present at 2% or less
 * may be grouped after a phrase such as "Contains 2% or less of" and listed in
 * any order (21 CFR 101.4(a)(2)). Sub-ingredients appear in parentheses or
 * brackets. The parser keeps that structure because the estimator relies on it:
 * order becomes a monotone constraint and the "2% or less" group becomes a cap.
 */

export interface ParsedIngredient {
  /** Cleaned display name, e.g. "Teriyaki Sauce". */
  name: string;
  /** Original text including sub-ingredients. */
  raw: string;
  /** 1-based position among top-level ingredients. */
  position: number;
  /** True when listed after a "2% or less" marker. */
  minor: boolean;
  /** Percentage stated on the label ("Tomatoes (32%)"), if any. */
  statedPercent: number | null;
  subIngredients: ParsedIngredient[];
}

export interface ParsedIngredientStatement {
  ingredients: ParsedIngredient[];
  /** Allergens named in a trailing "Contains: Milk, Wheat" statement (not an allergen guarantee). */
  allergenStatement: string[];
  /** Index (0-based) of the first ingredient in the "2% or less" group, or null. */
  minorStartIndex: number | null;
  warnings: string[];
}

const MINOR_MARKER =
  /\b(?:contains|containing)?\s*(?:(?:less\s+than|not\s+more\s+than)\s*2\s*%|2\s*%\s*or\s+less)(?:\s+(?:of|each\s+of))?(?:\s+(?:each\s+of\s+)?the\s+following)?\s*:?/i;

const ALLERGEN_STATEMENT = /(?:^|[.;]\s*)(?:allergens?|contains)\s*:\s*([^.;]*?)\s*\.?\s*$/i;

const OPEN = new Set(["(", "[", "{"]);
const CLOSE = new Set([")", "]", "}"]);

/** Splits on top-level commas/semicolons, respecting nested brackets. */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (OPEN.has(ch)) depth++;
    if (CLOSE.has(ch)) depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function stripOuterLabel(text: string): string {
  return text.replace(/^\s*ingredients?\s*:\s*/i, "").trim();
}

function cleanName(text: string): string {
  return text
    .replace(/[([{][\s\S]*$/, "") // drop sub-ingredient list
    .replace(/^\s*(?:and|&)\s+/i, "")
    .replace(/\band\/or\b/gi, "or")
    .replace(/[*†‡§¹²³]+/g, "")
    .replace(/\s*\.\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function innerOf(text: string): string | null {
  const start = text.search(/[([{]/);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (OPEN.has(ch)) depth++;
    if (CLOSE.has(ch)) {
      depth--;
      if (depth === 0) return text.slice(start + 1, i);
    }
  }
  return text.slice(start + 1);
}

function parseList(text: string, depth: number): { items: ParsedIngredient[]; minorStart: number | null } {
  const items: ParsedIngredient[] = [];
  let minorStart: number | null = null;
  let inMinor = false;
  for (let part of splitTopLevel(text)) {
    // "Contains 2% or less of: Salt" can appear inside a part.
    const marker = part.match(MINOR_MARKER);
    if (marker && marker.index !== undefined) {
      const before = part.slice(0, marker.index).replace(/[.:]\s*$/, "").trim();
      const after = part.slice(marker.index + marker[0].length).trim();
      if (before) items.push(makeItem(before, items.length + 1, inMinor, depth));
      inMinor = true;
      if (minorStart === null) minorStart = items.length;
      part = after;
      if (!part) continue;
    }
    // Sentence breaks ("... Salt. Contains 2% or less of ...") were handled above;
    // a stray period inside a name is dropped.
    items.push(makeItem(part, items.length + 1, inMinor, depth));
  }
  return { items, minorStart };
}

function makeItem(text: string, position: number, minor: boolean, depth: number): ParsedIngredient {
  const inner = depth < 3 ? innerOf(text) : null;
  let statedPercent: number | null = null;
  let subIngredients: ParsedIngredient[] = [];
  if (inner !== null) {
    const pct = inner.match(/^\s*(\d+(?:\.\d+)?)\s*%\s*$/);
    if (pct) statedPercent = Number(pct[1]);
    else subIngredients = parseList(inner, depth + 1).items;
  }
  return {
    name: cleanName(text),
    raw: text.trim(),
    position,
    minor,
    statedPercent,
    subIngredients,
  };
}

export function parseIngredientStatement(input: string | null | undefined): ParsedIngredientStatement {
  const warnings: string[] = [];
  if (!input || !input.trim()) {
    return { ingredients: [], allergenStatement: [], minorStartIndex: null, warnings };
  }
  let text = stripOuterLabel(input.replace(/\s+/g, " "));
  let allergenStatement: string[] = [];
  const allergen = text.match(ALLERGEN_STATEMENT);
  if (allergen && allergen.index !== undefined && !MINOR_MARKER.test(allergen[0])) {
    allergenStatement = allergen[1]
      .split(/,|\band\b/i)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    text = text.slice(0, allergen.index).trim();
  }
  // Normalise sentence breaks between groups into list separators.
  text = text.replace(/\.\s+(?=[A-Z])/g, ", ");
  const { items, minorStart } = parseList(text, 0);
  const ingredients = items.filter((i) => i.name.length > 0);
  if (ingredients.length === 0) warnings.push("No ingredients could be read from the statement.");
  ingredients.forEach((ing, i) => {
    ing.position = i + 1;
  });
  return { ingredients, allergenStatement, minorStartIndex: minorStart, warnings };
}

/* ------------------------------------------------------------------ */
/* Ingredient classes                                                  */
/* ------------------------------------------------------------------ */

export type IngredientClass =
  | "water"
  | "salt"
  | "spice"
  | "additive"
  | "fat"
  | "sugar"
  | "food";

const ADDITIVE =
  /\b(?:xanthan|guar|gum|lecithin|citric acid|ascorbic acid|lactic acid|acetic acid|malic acid|sodium benzoate|potassium sorbate|sorbic acid|calcium propionate|sodium propionate|preservative|natural flavou?rs?|artificial flavou?rs?|flavou?ring|colou?r(?:ing)?|caramel colou?r|annatto|paprika extract|turmeric extract|beta carotene|carrageenan|cellulose|maltodextrin|dextrose|modified (?:food |corn )?starch|enzymes?|cultures?|rennet|yeast extract|disodium|monosodium glutamate|msg|sodium phosphates?|calcium chloride|calcium sulfate|sodium aluminum|tocopherols?|bha|bht|tbhq|edta|silicon dioxide|vinegar powder|smoke flavou?r|mono-? and diglycerides|polysorbate|dough conditioner|azodicarbonamide|ammonium sulfate|vital wheat gluten)\b/i;
const SPICE =
  /\b(?:spices?|herbs?|seasonings?|pepper(?!s\b)|black pepper|garlic powder|onion powder|paprika|cumin|oregano|basil|thyme|rosemary|parsley|cilantro|coriander|turmeric|chili powder|cayenne|cinnamon|nutmeg|ginger powder|dried garlic|dried onion|bay leaf|dill|sage|mustard seed|curry powder|garam masala|extract)\b/i;

export function classifyIngredient(name: string): IngredientClass {
  const n = name.toLowerCase().trim();
  if (/^(?:filtered |purified )?water$/.test(n) || /^ice$/.test(n)) return "water";
  if (/^(?:sea |kosher |iodized )?salt$/.test(n)) return "salt";
  // Leavening and yeast contribute minerals (calcium, sodium, phosphorus) but little mass.
  if (/(?:baking (?:powder|soda)|leavening|sodium bicarbonate)|yeast(?!s+extract)/.test(n)) return "spice";
  if (ADDITIVE.test(n)) return "additive";
  if (SPICE.test(n) && !/\b(?:bell|sweet|red|green|yellow|jalapeno|poblano)\s+peppers?\b/.test(n)) return "spice";
  if (/\b(?:oil|butter|margarine|shortening|lard|ghee)\b/.test(n)) return "fat";
  if (/^(?:cane |brown |powdered |granulated )?sugar$|\b(?:corn syrup|honey|molasses|maple syrup|agave)\b/.test(n)) return "sugar";
  return "food";
}

/** Plausible maximum mass share of an ingredient class in a dish (documented priors). */
export function maxShareFor(cls: IngredientClass): number {
  switch (cls) {
    case "salt":
      return 0.03;
    case "spice":
      return 0.03;
    case "additive":
      return 0.02;
    case "fat":
      return 0.35;
    case "sugar":
      return 0.6;
    default:
      return 1;
  }
}
