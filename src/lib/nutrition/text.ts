/**
 * Text normalization for matching dining-hall food names and ingredient
 * names against USDA FoodData Central descriptions.
 */

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "w",
  "with",
  "without",
  "made",
  "style",
  "type",
  "ns",
  "nfs",
  "fresh",
  "homemade",
  "house",
  "housemade",
  "chef",
  "chefs",
  "daily",
  "special",
  "our",
  "classic",
  "signature",
  "station",
  "assorted",
  "seasonal",
  "local",
  "organic",
  "featured",
  "famous",
  "traditional",
  "home",
  "homestyle",
  "old",
  "fashioned",
  "favorite",
  "deluxe",
  "premium",
  "specialty",
  "gourmet",
  "artisan",
  "hearty",
  "inspired",
  "include",
  "includes",
  "including",
  "added",
  "form",
  "all",
  "other",
  "than",
  "not",
  "further",
  "specified",
  "usda",
  "commodity",
  "less",
  "contains",
  "following",
  "each",
  "serving",
]);

/** Multi-word phrase rewrites applied before tokenizing (dining vocabulary → USDA vocabulary). */
const PHRASES: [RegExp, string][] = [
  [/\bmac(?:aroni)?\s*(?:n|&|and|'n'?)\s*cheese\b/g, "macaroni cheese"],
  [/\bpb\s*&\s*j\b|\bpbj\b/g, "peanut butter jelly sandwich"],
  [/\bpb\b/g, "peanut butter"],
  [/\bbbq\b/g, "barbecue"],
  [/\bchx\b/g, "chicken"],
  [/\bveggies?\b/g, "vegetable"],
  [/\bstir[\s-]?fr(?:y|ies|ied)\b/g, "stirfry"],
  [/\bhash\s*browns?\b/g, "hash brown potato"],
  [/\b(?:french\s+)?fries\b/g, "french fried potato"],
  [/\bhard[\s-]?boiled\b/g, "boiled"],
  [/\bsoft[\s-]?boiled\b/g, "boiled"],
  [/\bomelette\b/g, "omelet"],
  [/\bgarbanzo(?:\s+beans?)?\b/g, "chickpea"],
  [/\bgreek\s+yog(?:h)?urt\b/g, "greek yogurt"],
  [/\byoghurt\b/g, "yogurt"],
  [/\bhot\s*dog\b/g, "frankfurter hot dog"],
  [/\b(?:black\s+)?bean\s+burger\b/g, "veggie burger black bean"],
  [/\bveggie\s+burger\b|\bvegetable\s+burger\b|\bgarden\s+burger\b/g, "veggie burger meatless"],
  [/\b(?:garden|side|tossed|green|house|mixed)\s+salad\b/g, "lettuce salad assorted vegetable"],
  [/\bmarinara\b|\bpomodoro\b|\bred\s+sauce\b/g, "tomato based sauce"],
  [/\b(?:tikka\s+)?masala\b/g, "curry"],
  [/\bchana\b/g, "chickpea"],
  [/\b(?:dhal|daal|dahl)\b/g, "dal"],
  [/\baloo\b/g, "potato"],
  [/\bgobi\b/g, "cauliflower"],
  [/\b(?:saag|palak)\b/g, "spinach"],
  [/\b2\s*%(?:\s*milk)?/g, " reduced fat milk "],
  [/\b1\s*%(?:\s*milk)?/g, " low fat milk "],
  [/\bskim\s+milk\b|\bfat[\s-]free\s+milk\b/g, " nonfat milk "],
  [/\bspuds?\b/g, "potato"],
  [/\btaters?\b/g, "potato"],
  [/\bpotatoe\b/g, "potato"],
  [/\bsweet\s+potato\s+fries\b/g, "sweet potato fried"],
  [/\bscrambled\s+eggs?\b/g, "egg scrambled"],
  [/\bfried\s+eggs?\b/g, "egg fried"],
  [/\bpoached\s+eggs?\b/g, "egg poached"],
  [/\begg\s+whites?\b/g, "egg white"],
  [/\bo\.?j\.?\b/g, "orange juice"],
  [/\bevoo\b/g, "olive oil"],
  [/\bmozz\b/g, "mozzarella"],
  [/\bparm\b/g, "parmesan"],
  [/\bquesadilla\b/g, "quesadilla"],
  [/\bspring\s+mix\b/g, "lettuce salad greens"],
  [/\bmixed\s+greens\b/g, "lettuce salad greens"],
  [/\bromaine\b/g, "romaine lettuce"],
  [/\bcollards\b/g, "collard greens"],
  [/\bchickpeas\b/g, "chickpea"],
  [/\bedamame\b/g, "edamame soybean green"],
  [/\bcoleslaw\b|\bcole\s+slaw\b/g, "coleslaw"],
  [/\bw\//g, " with "],
  [/\s&\s/g, " and "],
];

/** Single-token synonyms. */
const SYNONYMS: Record<string, string> = {
  chicken: "chicken",
  chickn: "chicken",
  tofu: "tofu",
  yogurt: "yogurt",
  oatmeal: "oatmeal",
  oats: "oat",
  spaghetti: "spaghetti pasta",
  penne: "pasta",
  rotini: "pasta",
  fusilli: "pasta",
  farfalle: "pasta",
  linguine: "pasta",
  fettuccine: "pasta",
  noodles: "noodle",
  marinara: "marinara",
  aioli: "mayonnaise",
  mayo: "mayonnaise",
  catsup: "ketchup",
  chili: "chili",
  chilli: "chili",
  grilled: "grilled",
  broiled: "broiled",
  roasted: "roasted",
  roast: "roasted",
  baked: "baked",
  steamed: "steamed",
  sauteed: "sauteed",
  sautéed: "sauteed",
  braised: "braised",
  blackened: "blackened",
  crispy: "fried",
  breaded: "breaded",
  battered: "fried",
  doughnut: "doughnut",
  donut: "doughnut",
  bagels: "bagel",
  wheat: "wheat",
  wholewheat: "whole wheat",
  multigrain: "multigrain",
  mushrooms: "mushroom",
  shrooms: "mushroom",
  peppers: "pepper",
  capsicum: "pepper",
  scallion: "onion green",
  scallions: "onion green",
  cilantro: "coriander",
  zucchini: "squash zucchini",
  courgette: "squash zucchini",
  aubergine: "eggplant",
  prawns: "shrimp",
  prawn: "shrimp",
  hamburger: "hamburger",
  sammy: "sandwich",
  sub: "sandwich",
  hoagie: "sandwich",
  panini: "sandwich",
  flatbread: "flatbread",
  naan: "naan",
  tortillas: "tortilla",
  burrito: "burrito",
  burritos: "burrito",
  gyro: "gyro",
  falafel: "falafel",
  hummus: "hummus",
  tzatziki: "tzatziki",
  pho: "pho soup",
  ramen: "ramen noodle soup",
};

/** Words whose plural form should not be stripped. */
const KEEP_S = new Set([
  "hummus",
  "couscous",
  "asparagus",
  "swiss",
  "molasses",
  "grits",
  "brussels",
  "citrus",
  "lentils",
  "bass",
  "glass",
  "cress",
  "watercress",
  "hibiscus",
  "octopus",
  "series",
  "species",
  "chips",
  "oats",
  "greens",
  "tamales",
  "nachos",
  "fajitas",
  "plus",
  "less",
  "fries",
]);

export function singularize(word: string): string {
  if (word.length <= 3 || KEEP_S.has(word)) {
    if (word === "lentils") return "lentil";
    if (word === "oats") return "oat";
    if (word === "chips") return "chip";
    if (word === "greens") return "green";
    if (word === "tamales") return "tamale";
    if (word === "fajitas") return "fajita";
    if (word === "nachos") return "nacho";
    return word;
  }
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (/(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (word.endsWith("ves") && !word.endsWith("olives")) return word.slice(0, -3) + "f";
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("is")) return word.slice(0, -1);
  return word;
}

export function normalizeText(input: string): string {
  let s = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[®™©*]/g, " ")
    .replace(/\([^)]*\)/g, " ");
  for (const [re, rep] of PHRASES) s = s.replace(re, ` ${rep} `);
  return s.replace(/[^a-z0-9%]+/g, " ").replace(/\s+/g, " ").trim();
}

export function tokenize(input: string, opts: { keepStopwords?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const raw of normalizeText(input).split(" ")) {
    if (!raw) continue;
    if (/^\d+%?$/.test(raw)) continue;
    const syn = SYNONYMS[raw];
    const parts = syn ? syn.split(" ") : [raw];
    for (const p of parts) {
      const w = singularize(p);
      if (!opts.keepStopwords && STOPWORDS.has(w)) continue;
      if (w.length < 2) continue;
      out.push(w);
    }
  }
  return out;
}

/** Cooking/preparation state words, used to penalize raw-vs-cooked mismatches. */
export const COOKED_WORDS = new Set([
  "cooked",
  "boiled",
  "baked",
  "roasted",
  "grilled",
  "broiled",
  "steamed",
  "fried",
  "sauteed",
  "braised",
  "stewed",
  "poached",
  "scrambled",
  "toasted",
  "blackened",
  "smoked",
  "microwaved",
  "simmered",
  "breaded",
]);

/** Head nouns that name a component (sauce, dressing…) rather than a whole dish. */
export const COMPONENT_HEADS = new Set([
  "sauce",
  "gravy",
  "dressing",
  "topping",
  "seasoning",
  "spice",
  "crust",
  "filling",
  "broth",
  "syrup",
  "glaze",
  "marinade",
  "batter",
  "breading",
  "frosting",
  "icing",
  "dip",
]);

export const RAW_WORDS = new Set(["raw", "uncooked", "fresh"]);

/** Forms that are rarely what a dining hall serves unless the menu says so. */
export const UNUSUAL_FORM_WORDS = new Set([
  "dry",
  "dried",
  "dehydrated",
  "powder",
  "powdered",
  "flour",
  "mix",
  "concentrate",
  "frozen",
  "unprepared",
  "freeze",
  "instant",
  "canned",
  "condensed",
  "imitation",
  "formulated",
  "enriched",
  "unenriched",
  "fortified",
]);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Normalized key for de-duplicating things like university names. */
export function normalizeKey(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(the|university|univ|college|of|at|campus)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
