import { searchUsda } from "../../src/lib/nutrition/usda-index";
const qs = process.argv.slice(2);
for (const q of qs) {
  const hits = searchUsda(q, { mode: "ingredient", limit: 3, sources: ["foundation", "sr_legacy"] });
  console.log(`# ${q}`);
  for (const h of hits) console.log(`  ${h.food.fdcId} | ${h.food.description} | ${h.food.per100g.energy}kcal`);
}
