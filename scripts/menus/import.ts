/**
 * Imports an approved menu-data file from the command line.
 *
 *   npm run menus:import -- --university uw-madison --file menus.json [--commit]
 *   npm run menus:import -- --university uw-madison --file menus.csv \
 *       --source-name "UW Housing Dining export" --obtained-from "emailed by …" \
 *       --permission "approved by … on …" [--commit]
 *
 * Without --commit the file is only validated (dry run).
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/db/client";
import { seedCatalog } from "../../src/db/bootstrap";
import { diningLocations, universities } from "../../src/db/schema";
import { parseImportCsv, parseImportJson } from "../../src/lib/menus/import-format";
import { applyMenuDays } from "../../src/lib/menus/sync";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = arg("university");
  const file = arg("file");
  if (!slug || !file) throw new Error("Usage: --university <slug> --file <path> [--commit]");
  const db = await getDb();
  await seedCatalog(db);
  const [u] = await db.select().from(universities).where(eq(universities.slug, slug)).limit(1);
  if (!u) throw new Error(`Unknown university ${slug}`);
  const locations = await db.select().from(diningLocations).where(eq(diningLocations.universityId, u.id));
  const ctx = { universitySlug: u.slug, locations };
  const text = readFileSync(file, "utf8");
  const preview = file.toLowerCase().endsWith(".csv")
    ? parseImportCsv(
        text,
        {
          name: arg("source-name") ?? "",
          obtainedFrom: arg("obtained-from") ?? "",
          permission: arg("permission") ?? "",
        },
        ctx,
      )
    : parseImportJson(text, ctx);
  console.log(JSON.stringify(preview.summary, null, 2));
  for (const w of preview.warnings) console.warn("warning:", w);
  for (const e of preview.errors) console.error("error:", e);
  if (!preview.ok) {
    console.error("Import rejected; nothing was written.");
    process.exitCode = 1;
  } else if (process.argv.includes("--commit")) {
    const result = await applyMenuDays({
      university: u,
      days: preview.days,
      source: "import",
      trigger: "import",
      triggeredBy: `cli: ${preview.source?.name} — ${preview.source?.permission}`.slice(0, 500),
      warnings: preview.warnings.slice(0, 20),
    });
    console.log(`Import ${result.status}:`, JSON.stringify(result.stats));
  } else {
    console.log("Dry run only. Add --commit to write.");
  }
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
