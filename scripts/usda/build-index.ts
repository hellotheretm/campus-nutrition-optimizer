/**
 * Builds data/usda/usda-index.json.gz from the USDA FoodData Central bulk
 * downloads (Foundation Foods, SR Legacy, FNDDS).
 *
 *   npm run usda:download   # fetch the three zip files (≈18 MB) if missing
 *   npm run usda:build-index   # build the compact index
 *
 * The index keeps, for every food: FDC id, dataset, description, category,
 * the nutrients this app tracks (per 100 g), household portions with gram
 * weights, and (for FNDDS) the recipe ingredients with gram weights.
 * Missing USDA values stay null — they are never converted to zero.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { unzipSync, strFromU8 } from "fflate";
import { NUTRIENT_IDS, NUTRIENTS, type NutrientId } from "../../src/lib/nutrition/nutrients";
import type { UsdaIndexFile, UsdaIndexRow } from "../../src/lib/nutrition/usda-index-format";
import { USDA_DATASETS } from "./datasets";

const ROOT = resolve(__dirname, "..", "..");
const RAW_DIR = join(ROOT, "data", "usda", "raw");
const OUT = join(ROOT, "data", "usda", "usda-index.json.gz");

/** Nutrients stored in the index (derived totals are computed at runtime too, but cheap to store). */
const INDEX_KEYS: NutrientId[] = NUTRIENT_IDS.filter((id) => id !== "added_sugars" && id !== "chromium");

const EXCLUDED_CATEGORY_PATTERNS = [
  /baby food/i,
  /infant formula/i,
  /human milk/i,
  /american indian\/alaska native/i,
  /^formula/i,
];

interface RawNutrient {
  nutrient?: { id?: number; unitName?: string };
  amount?: number;
}
interface RawPortion {
  gramWeight?: number;
  portionDescription?: string;
  modifier?: string;
  amount?: number;
  value?: number;
  measureUnit?: { name?: string; abbreviation?: string };
}
interface RawInput {
  ingredientDescription?: string;
  ingredientWeight?: number;
  foodDescription?: string;
}
interface RawFood {
  fdcId: number;
  description: string;
  foodCategory?: { description?: string };
  wweiaFoodCategory?: { wweiaFoodCategoryDescription?: string };
  foodNutrients?: RawNutrient[];
  foodPortions?: RawPortion[];
  inputFoods?: RawInput[];
  foodCode?: string | number;
}

function sig(n: number, digits = 4): number {
  if (n === 0 || !Number.isFinite(n)) return 0;
  const p = Math.pow(10, digits - Math.ceil(Math.log10(Math.abs(n))));
  return Math.round(n * p) / p;
}

function portionLabel(p: RawPortion): string | null {
  const desc = (p.portionDescription ?? "").trim();
  if (desc && desc.toLowerCase() !== "quantity not specified") return desc;
  if (desc.toLowerCase() === "quantity not specified") return "typical amount (NHANES)";
  const unit = p.measureUnit?.name && p.measureUnit.name !== "undetermined" ? p.measureUnit.name : "";
  const amount = p.amount ?? p.value ?? 1;
  const modifier = (p.modifier ?? "").trim();
  const label = [amount, unit, modifier && !/^\d+$/.test(modifier) ? modifier : ""].filter(Boolean).join(" ").trim();
  return label || null;
}

function extract(food: RawFood) {
  const byId = new Map<number, { amount: number; unit: string }>();
  for (const n of food.foodNutrients ?? []) {
    const id = n.nutrient?.id;
    if (typeof id !== "number" || typeof n.amount !== "number" || !Number.isFinite(n.amount)) continue;
    if (!byId.has(id)) byId.set(id, { amount: n.amount, unit: n.nutrient?.unitName ?? "" });
  }
  const values: (number | null)[] = [];
  const approx: number[] = [];
  const get = (ids: number[]) => {
    for (const id of ids) {
      const v = byId.get(id);
      if (v) return v.amount;
    }
    return null;
  };
  const tmp: Partial<Record<NutrientId, number | null>> = {};
  for (const key of INDEX_KEYS) {
    const def = NUTRIENTS[key];
    let v: number | null = def.usdaIds.length ? get(def.usdaIds) : null;
    let isApprox = false;
    if (v === null && def.usdaApproxIds?.length) {
      v = get(def.usdaApproxIds);
      isApprox = v !== null;
    }
    if (key === "energy" && v === null) {
      const kj = byId.get(1062);
      if (kj) v = kj.amount / 4.184;
    }
    if (key === "vitamin_d" && v === null) {
      const iu = byId.get(1110);
      if (iu) v = iu.amount / 40;
    }
    tmp[key] = v;
    if (isApprox) approx.push(INDEX_KEYS.indexOf(key));
  }
  // Derived fatty-acid totals (only when the components are actually reported).
  const ala = tmp.omega3_ala, epa = tmp.omega3_epa, dha = tmp.omega3_dha, dpa = tmp.omega3_dpa;
  tmp.omega3_total = ala != null && epa != null && dha != null ? ala + epa + dha + (dpa ?? 0) : null;
  const la = tmp.omega6_la;
  const aa = byId.get(1271)?.amount;
  tmp.omega6_total = la != null ? la + (aa ?? 0) : null;
  if (tmp.omega3_total != null && approx.includes(INDEX_KEYS.indexOf("omega3_ala"))) approx.push(INDEX_KEYS.indexOf("omega3_total"));
  if (tmp.omega6_total != null && approx.includes(INDEX_KEYS.indexOf("omega6_la"))) approx.push(INDEX_KEYS.indexOf("omega6_total"));

  for (const key of INDEX_KEYS) {
    const v = tmp[key];
    values.push(v == null ? null : sig(v));
  }
  return { values, approx };
}

function main() {
  const out: UsdaIndexFile = {
    version: `${new Date().toISOString().slice(0, 10)}.1`,
    builtAt: new Date().toISOString(),
    sources: [],
    nutrientKeys: INDEX_KEYS,
    categories: [],
    foods: [],
  };
  const catIndex = new Map<string, number>();
  const cat = (name: string) => {
    let i = catIndex.get(name);
    if (i === undefined) {
      i = out.categories.length;
      out.categories.push(name);
      catIndex.set(name, i);
    }
    return i;
  };

  USDA_DATASETS.forEach((ds, sourceCode) => {
    const path = join(RAW_DIR, ds.file);
    if (!existsSync(path)) {
      throw new Error(`Missing ${path}. Run "npm run usda:download" first.`);
    }
    console.log(`Reading ${ds.label} (${ds.file})…`);
    const entries = unzipSync(new Uint8Array(readFileSync(path)));
    const jsonName = Object.keys(entries).find((n) => n.toLowerCase().endsWith(".json"));
    if (!jsonName) throw new Error(`No JSON file inside ${ds.file}`);
    const parsed = JSON.parse(strFromU8(entries[jsonName])) as Record<string, RawFood[]>;
    const foods = parsed[ds.jsonKey];
    if (!Array.isArray(foods)) throw new Error(`Unexpected structure in ${ds.file}: missing ${ds.jsonKey}`);

    let kept = 0;
    for (const f of foods) {
      const category = f.foodCategory?.description ?? f.wweiaFoodCategory?.wweiaFoodCategoryDescription ?? "Uncategorized";
      if (EXCLUDED_CATEGORY_PATTERNS.some((re) => re.test(category))) continue;
      if (/\b(infant|baby food|toddler)\b/i.test(f.description)) continue;
      const { values, approx } = extract(f);
      if (values[INDEX_KEYS.indexOf("energy")] == null) continue; // unusable without energy
      const portions: [string, number][] = [];
      for (const p of f.foodPortions ?? []) {
        const label = portionLabel(p);
        if (!label || typeof p.gramWeight !== "number" || p.gramWeight <= 0) continue;
        if (portions.some(([l]) => l === label)) continue;
        portions.push([label, sig(p.gramWeight, 4)]);
      }
      const inputs: [string, number][] = [];
      if (ds.key === "fndds") {
        for (const i of f.inputFoods ?? []) {
          const d = (i.ingredientDescription ?? i.foodDescription ?? "").trim();
          if (!d || typeof i.ingredientWeight !== "number") continue;
          inputs.push([d, sig(i.ingredientWeight, 4)]);
        }
      }
      const row: UsdaIndexRow = [
        f.fdcId,
        sourceCode as 0 | 1 | 2,
        f.description.trim(),
        cat(category),
        values,
        approx,
        portions,
        inputs,
        f.foodCode ? Number(f.foodCode) : 0,
      ];
      out.foods.push(row);
      kept++;
    }
    out.sources.push({ key: ds.key, label: ds.label, release: ds.release, url: ds.url, count: kept });
    console.log(`  kept ${kept} of ${foods.length} foods`);
  });

  const json = JSON.stringify(out);
  const gz = gzipSync(Buffer.from(json), { level: 9 });
  writeFileSync(OUT, gz);
  console.log(`Wrote ${OUT}: ${out.foods.length} foods, ${(json.length / 1e6).toFixed(1)} MB JSON → ${(gz.length / 1e6).toFixed(2)} MB gzip`);
}

main();
