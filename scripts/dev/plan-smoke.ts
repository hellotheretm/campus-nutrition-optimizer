/** Dev check: generate demo plans with several strategies and print them. */
import { closeDb, getDb } from "../../src/db/client";
import { seedCatalog } from "../../src/db/bootstrap";
import { ensureDemoMenuWindow } from "../../src/lib/menus/sync";
import { generatePlan } from "../../src/lib/optimizer";
import { todayIn } from "../../src/lib/dates";

async function main() {
  await seedCatalog(await getDb());
  await ensureDemoMenuWindow();
  const date = process.argv[2] ?? todayIn("America/Chicago");
  const base = {
    universityId: "demo-university",
    date,
    meals: [{ period: "breakfast" as const }, { period: "lunch" as const }, { period: "dinner" as const }],
  };
  for (const strategy of ["balanced", "plant_forward", "lower_sodium"] as const) {
    const t = Date.now();
    const plan = await generatePlan({ ...base, strategy, meals: base.meals.map((m) => ({ ...m, locationIds: [] })) });
    console.log(`\n=== ${strategy} → ${plan.status} (${Date.now() - t} ms, solve ${plan.model.solveMs} ms, vars ${plan.model.variables}, cands ${plan.model.candidates})`);
    for (const m of plan.meals) {
      console.log(` ${m.period} @ ${m.locationName ?? "-"} ${m.note ?? ""}`);
      for (const i of m.items) console.log(`   ${i.servings} × ${i.name} [${i.confidence}] — ${i.why.join("; ")}`);
    }
    console.log(" energy:", Math.round(plan.energy.value ?? 0), "kcal; summary:", plan.summary);
    console.log(" warnings:", plan.warnings);
    const rows = plan.coverage.filter((r) => r.kind !== "info").map((r) => `${r.id}:${r.percent === null ? "?" : Math.round(r.percent)}%`);
    console.log(" coverage:", rows.join(" "));
    if (plan.infeasibility) console.log(" infeasible:", plan.infeasibility);
  }
  // Vegan + avoid soy, one location for lunch, a lock.
  const vegan = await generatePlan({
    ...base,
    meals: [{ period: "lunch", locationIds: ["demo-university:lakeside-market"] }, { period: "dinner", locationIds: [] }],
    preferences: { pattern: "vegan", avoidAllergens: ["soy"] },
  });
  console.log("\n=== vegan/no soy →", vegan.status, vegan.meals.map((m) => `${m.period}@${m.locationName}: ${m.items.map((i) => i.name).join(", ")}`), vegan.warnings, vegan.infeasibility);
  // Infeasible: impossible filter
  const none = await generatePlan({ ...base, meals: [{ period: "breakfast", locationIds: [] }], preferences: { excludedIngredients: ["water", "salt", "sugar", "oil", "egg", "milk", "flour"] } });
  console.log("\n=== impossible →", none.status, none.infeasibility);
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
