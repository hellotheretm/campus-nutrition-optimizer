/**
 * Measures the estimator against Demo University ground truth.
 *
 *   npm run estimator:validate            # summary table
 *   npm run estimator:validate -- --write # also writes docs/ESTIMATOR_VALIDATION.md
 *
 * The estimator only sees what a real menu publishes (rounded label values and
 * the ingredient statement). Truth comes from the hidden recipe.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_RECIPES, demoMenuItem, recipeTruth } from "../src/lib/demo/derive";
import { estimateNutrition, type Confidence } from "../src/lib/nutrition/estimator";
import { NUTRIENTS, type NutrientId } from "../src/lib/nutrition/nutrients";
import { getReferenceProfile } from "../src/lib/nutrition/references";

const FOCUS: NutrientId[] = [
  "vitamin_a",
  "vitamin_c",
  "vitamin_d",
  "vitamin_e",
  "vitamin_k",
  "thiamin",
  "riboflavin",
  "niacin",
  "vitamin_b6",
  "folate",
  "vitamin_b12",
  "choline",
  "calcium",
  "iron",
  "magnesium",
  "phosphorus",
  "potassium",
  "zinc",
  "selenium",
  "copper",
  "manganese",
  "omega3_ala",
];

interface Row {
  recipe: string;
  nutrient: NutrientId;
  truth: number;
  value: number;
  low: number;
  high: number;
  confidence: Confidence;
  provenance: string;
}

async function main() {
  const write = process.argv.includes("--write");
  const rows: Row[] = [];
  const methods: Record<string, number> = {};
  const started = performance.now();
  for (const recipe of DEMO_RECIPES) {
    const item = demoMenuItem(recipe, recipe.key);
    const truth = recipeTruth(recipe);
    const result = await estimateNutrition({
      name: item.name,
      servingAmount: item.servingAmount,
      servingUnit: item.servingUnit,
      servingGrams: item.servingGrams,
      official: item.official,
      ingredients: item.ingredients,
    });
    methods[result.method] = (methods[result.method] ?? 0) + 1;
    for (const id of FOCUS) {
      const t = truth[id];
      const e = result.nutrients[id];
      if (t === null || t === undefined || e.value === null || e.low === null || e.high === null) continue;
      if (e.provenance === "official") continue;
      rows.push({
        recipe: recipe.key,
        nutrient: id,
        truth: t,
        value: e.value,
        low: e.low,
        high: e.high,
        confidence: e.confidence,
        provenance: e.provenance,
      });
    }
    if (process.argv.includes("--verbose")) {
      console.log(`\n## ${recipe.name} → ${result.method} (${result.overallConfidence})`);
      for (const line of result.explanation) console.log("  - " + line);
      for (const id of ["vitamin_c", "iron", "calcium", "potassium", "vitamin_a"] as NutrientId[]) {
        const e = result.nutrients[id];
        console.log(
          `    ${id.padEnd(10)} truth=${truth[id]?.toFixed(2)} est=${e.value?.toFixed(2)} [${e.low?.toFixed(2)}–${e.high?.toFixed(2)}] ${e.provenance}/${e.confidence}`,
        );
      }
    }
  }
  const elapsed = (performance.now() - started) / 1000;

  // Ignore nutritionally negligible truths (below 1% of the Daily Value): relative error is meaningless there.
  const meaningful = rows.filter((r) => r.truth >= 0.01 * (getReferenceProfile().values[r.nutrient]?.amount ?? 0) && r.truth > 1e-6);
  const relErr = (r: Row) => Math.abs(r.value - r.truth) / Math.max(r.truth, 1e-9);
  const within = (r: Row) => r.truth >= r.low * 0.999 - 1e-9 && r.truth <= r.high * 1.001 + 1e-9;
  const median = (xs: number[]) => {
    if (!xs.length) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const byConf = new Map<Confidence, Row[]>();
  for (const r of meaningful) byConf.set(r.confidence, [...(byConf.get(r.confidence) ?? []), r]);

  const lines: string[] = [];
  lines.push(`Recipes: ${DEMO_RECIPES.length} · nutrient estimates compared: ${meaningful.length} · time ${elapsed.toFixed(1)} s`);
  lines.push(`Methods used: ${Object.entries(methods).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  lines.push("");
  lines.push("| Confidence | Estimates | Truth inside stated range | Median absolute error | 80th percentile error |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const c of ["high", "medium", "low"] as Confidence[]) {
    const rs = byConf.get(c) ?? [];
    if (!rs.length) continue;
    const errs = rs.map(relErr).sort((a, b) => a - b);
    const p80 = errs[Math.floor(errs.length * 0.8)] ?? NaN;
    lines.push(
      `| ${c} | ${rs.length} | ${((rs.filter(within).length / rs.length) * 100).toFixed(0)}% | ${(median(errs) * 100).toFixed(0)}% | ${(p80 * 100).toFixed(0)}% |`,
    );
  }
  const allErr = meaningful.map(relErr);
  lines.push(
    `| all | ${meaningful.length} | ${((meaningful.filter(within).length / meaningful.length) * 100).toFixed(0)}% | ${(median(allErr) * 100).toFixed(0)}% | ${((allErr.sort((a, b) => a - b)[Math.floor(allErr.length * 0.8)] ?? NaN) * 100).toFixed(0)}% |`,
  );
  lines.push("");
  lines.push("| Nutrient | Estimates | Inside range | Median error |");
  lines.push("|---|---:|---:|---:|");
  for (const id of FOCUS) {
    const rs = meaningful.filter((r) => r.nutrient === id);
    if (!rs.length) continue;
    lines.push(
      `| ${NUTRIENTS[id].name} | ${rs.length} | ${((rs.filter(within).length / rs.length) * 100).toFixed(0)}% | ${(median(rs.map(relErr)) * 100).toFixed(0)}% |`,
    );
  }
  const text = lines.join("\n");
  console.log(text);

  const worst = [...meaningful].sort((a, b) => relErr(b) - relErr(a)).slice(0, 10);
  console.log("\nLargest errors:");
  for (const r of worst) {
    console.log(
      `  ${r.recipe} ${r.nutrient}: truth ${r.truth.toFixed(3)} est ${r.value.toFixed(3)} [${r.low.toFixed(3)}–${r.high.toFixed(3)}] ${r.confidence}`,
    );
  }

  if (write) {
    const doc = `# Estimator validation (Demo University)

Generated by \`npm run estimator:validate -- --write\` on ${new Date().toISOString().slice(0, 10)} with estimator ${(await import("../src/lib/nutrition/estimator")).ESTIMATOR_VERSION}.

Demo University is fictional. Each of its recipes is a list of real USDA records with gram weights, so its true
nutrient content is known. The estimator receives only what a real menu publishes: FDA-rounded label values and an
ingredient statement in descending order by weight. The tables compare its estimates with the hidden truth.

${text}

**How to read this.** "Truth inside stated range" is the share of estimates whose plausible range contains the true value.
Errors are relative to the true value. These results describe the demo recipes only; real dining-hall dishes add
uncertainty this test cannot capture (brand-specific ingredients, fortification, recipe drift, portioning).
`;
    writeFileSync(join(process.cwd(), "docs", "ESTIMATOR_VALIDATION.md"), doc);
    console.log("\nWrote docs/ESTIMATOR_VALIDATION.md");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
