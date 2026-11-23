/**
 * Groups menu items that are versions of the same food ("Skim Milk" and "Chocolate Milk",
 * "Pasta" and "Whole Grain Pasta"), so the optimizer can avoid putting two of them in one meal.
 *
 * This is a name heuristic, not a food database: it takes the main noun of the name
 * (the word the rest describe), folds plurals and a few well-known synonyms
 * (penne → pasta), and treats items with the same main noun as similar. It is only used
 * for a soft penalty, so a wrong guess makes a plan slightly less likely, never impossible.
 */

/** Trailing words that describe the portion or dish shape rather than the food itself. */
const TRAILING_GENERIC = new Set([
  "cup",
  "bowl",
  "side",
  "slice",
  "serving",
  "portion",
  "plate",
  "entree",
  "small",
  "medium",
  "large",
  "regular",
  "each",
  "piece",
  "pc",
  "oz",
]);

/** Different names for what a diner would call the same food. */
const SYNONYMS: Record<string, string> = {
  spaghetti: "pasta",
  penne: "pasta",
  rigatoni: "pasta",
  fettuccine: "pasta",
  fettuccini: "pasta",
  linguine: "pasta",
  macaroni: "pasta",
  rotini: "pasta",
  fusilli: "pasta",
  farfalle: "pasta",
  ziti: "pasta",
  tortellini: "pasta",
  ravioli: "pasta",
  noodle: "pasta",
  toast: "bread",
  roll: "bread",
  baguette: "bread",
  loaf: "bread",
  yoghurt: "yogurt",
  fry: "potato",
  tot: "potato",
  hashbrown: "potato",
  "hash brown": "potato",
  "french fry": "potato",
  cola: "soda",
  pop: "soda",
};

/**
 * Staple foods that often lead a dish name ("Pasta Primavera", "Rice Pilaf", "Yogurt Parfait"):
 * when the name starts with one of these, that is the family.
 */
const LEADING_BASES = new Set(["pasta", "rice", "milk", "yogurt", "potato"]);

/** Two-word endings that name one food (kept together so "hash browns" isn't just "browns"). */
const COMPOUND_ENDINGS = ["hash brown", "ice cream", "peanut butter", "cream cheese", "sour cream", "french fry"];

function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (word.endsWith("ches") || word.endsWith("shes")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

/**
 * The family a food belongs to ("milk", "pasta", "yogurt"), or null when the name gives
 * nothing to go on. Items in the same family count as similar.
 */
export function foodFamily(name: string): string | null {
  let s = name.toLowerCase();
  // "Pasta (whole grain)", "Milk, chocolate", "Penne with marinara": the main food comes first.
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.split(/,| with | w\/ | served | topped /)[0];
  s = s.replace(/&/g, " and ").replace(/[^a-z\s-]/g, " ").replace(/-/g, " ");
  const words = s
    .split(/\s+/)
    .filter(Boolean)
    .map(singular);
  while (words.length > 1 && TRAILING_GENERIC.has(words[words.length - 1])) words.pop();
  if (!words.length) return null;
  const lastTwo = words.slice(-2).join(" ");
  const compound = COMPOUND_ENDINGS.find((c) => c === lastTwo);
  const head = compound ?? words[words.length - 1];
  if (head.length < 2 || TRAILING_GENERIC.has(head)) return null;
  const first = SYNONYMS[words[0]] ?? words[0];
  if (words.length > 1 && LEADING_BASES.has(first)) return first;
  return SYNONYMS[head] ?? head;
}

/** Groups of item indexes (two or more) whose foods are similar. */
export function similarGroups(names: string[]): number[][] {
  const byFamily = new Map<string, number[]>();
  names.forEach((name, i) => {
    const f = foodFamily(name);
    if (!f) return;
    const list = byFamily.get(f) ?? [];
    list.push(i);
    byFamily.set(f, list);
  });
  return [...byFamily.values()].filter((g) => g.length > 1);
}
