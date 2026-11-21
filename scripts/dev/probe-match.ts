import { searchUsda } from "../../src/lib/nutrition/usda-index";
const queries = process.argv.slice(2);
const mode = (process.env.MODE as "dish" | "ingredient") || "dish";
for (const q of queries) {
  console.log(`\n=== ${q} (${mode})`);
  for (const c of searchUsda(q, { mode, limit: 6 })) {
    console.log(`${c.score.toFixed(3)} cov=${c.coverage.toFixed(2)} prec=${c.precision.toFixed(2)} [${c.food.source}] ${c.food.description} | ${c.food.category} | ${c.food.group} | kcal/100g=${c.food.per100g.energy} ${c.adjustments.join("; ")}`);
  }
}
