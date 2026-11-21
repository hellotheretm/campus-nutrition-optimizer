/**
 * Writes the built-in university catalog and, when enabled, generates Demo
 * University menus around today.
 *   npm run db:seed
 */
import { closeDb, getDb } from "../../src/db/client";
import { seedCatalog } from "../../src/db/bootstrap";
import { demoEnabled } from "../../src/lib/universities/catalog";
import { ensureDemoMenuWindow } from "../../src/lib/menus/sync";

async function main() {
  const db = await getDb();
  await seedCatalog(db);
  console.log("University catalog written.");
  if (demoEnabled()) {
    const t = Date.now();
    await ensureDemoMenuWindow();
    console.log(`Demo University menus ready (${((Date.now() - t) / 1000).toFixed(1)} s).`);
  } else {
    console.log("Demo University disabled (ENABLE_DEMO_UNIVERSITY=false).");
  }
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
