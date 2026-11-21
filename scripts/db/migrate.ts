/**
 * Applies pending SQL migrations.
 *   npm run db:migrate
 */
import { closeDb, getDbHandle } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";

async function main() {
  process.env.DB_AUTO_MIGRATE = "false";
  const handle = await getDbHandle();
  const ran = await runMigrations(handle);
  console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date.");
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
