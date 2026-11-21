import { loadUsdaIndex } from "../../src/lib/nutrition/usda-index";
const idx = loadUsdaIndex();
for (const pat of process.argv.slice(2)) {
  const re = new RegExp(pat, "i");
  const hits = idx.foods.filter((f) => re.test(f.description));
  console.log(`\n=== /${pat}/ ${hits.length} hits`);
  for (const f of hits.slice(0, 14)) console.log(`[${f.source}] ${f.fdcId} ${f.description} | ${f.category} | ${f.per100g.energy}kcal`);
}
