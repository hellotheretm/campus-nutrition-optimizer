/** Dev tool: shows how the estimator reconstructed one demo recipe. Usage: tsx scripts/dev/debug-recipe.ts <recipe-key> [nutrient] */
import { DEMO_RECIPES, demoMenuItem, recipeTruth } from "../../src/lib/demo/derive";
import { estimateNutrition } from "../../src/lib/nutrition/estimator";
import { getUsdaFood } from "../../src/lib/nutrition/usda-index";
import type { NutrientId } from "../../src/lib/nutrition/nutrients";

async function main() {
  const key = process.argv[2];
  const nutrient = (process.argv[3] ?? "vitamin_c") as NutrientId;
  const recipe = DEMO_RECIPES.find((r) => r.key === key);
  if (!recipe) throw new Error("unknown recipe");
  const item = demoMenuItem(recipe, key);
  console.log("Label:", item.official);
  console.log("Statement:", item.ingredients);
  console.log("Truth recipe:");
  for (const i of recipe.ingredients) {
    const f = getUsdaFood(i.fdcId)!;
    console.log(`  ${i.grams.toString().padStart(6)} g  ${i.label} → ${f.description} [${nutrient}=${f.per100g[nutrient]}/100g]`);
  }
  const res = await estimateNutrition({
    name: item.name,
    servingAmount: item.servingAmount,
    servingUnit: item.servingUnit,
    servingGrams: item.servingGrams,
    official: item.official,
    ingredients: item.ingredients,
  });
  console.log("Method:", res.method, "coverage", res.ingredientCoverage);
  for (const m of res.matches) {
    const f = getUsdaFood(m.fdcId)!;
    console.log(`  ${m.role} ${m.ingredient ?? ""} → ${m.grams ?? "?"} g  ${m.description} (score ${m.score}, alts ${m.alternatives ?? 0}) [${nutrient}=${f.per100g[nutrient]}/100g]`);
  }
  console.log("Explanation:\n  - " + res.explanation.join("\n  - "));
  const t = recipeTruth(recipe)[nutrient];
  const e = res.nutrients[nutrient];
  console.log(`${nutrient}: truth ${t} est ${e.value} [${e.low}–${e.high}] ${e.provenance}/${e.confidence} ${e.note ?? ""}`);
}
main();
