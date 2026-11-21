/**
 * Runs menu retrieval for every university whose provider allows it, and
 * recomputes nutrient estimates made by an older estimator version.
 *   npm run menus:sync
 */
import { loadEnvConfig } from "@next/env";
import { closeDb } from "../../src/db/client";
import { seedCatalog } from "../../src/db/bootstrap";
import { getDb } from "../../src/db/client";
import { reestimateOutdated, syncAllScheduled } from "../../src/lib/menus/sync";

async function main() {
  // Same .env files the Next.js server reads (.env.local etc.), so the CLI sees the same switches.
  loadEnvConfig(process.cwd());
  await seedCatalog(await getDb());
  const results = await syncAllScheduled();
  for (const r of results) {
    console.log(`${r.university}: ${r.result.status}`, r.result.error ?? "", JSON.stringify(r.result.stats));
  }
  if (!results.length) console.log("No university currently allows automatic retrieval (demo menus are generated on demand).");
  const re = await reestimateOutdated(500);
  console.log(`Re-estimated ${re.updated} foods; ${re.remaining} still use an older estimator version.`);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
