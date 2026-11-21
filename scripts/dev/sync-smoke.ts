/** Dev check: catalog seed + demo menu sync twice (second run must be all "unchanged"). */
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../../src/db/client";
import { seedCatalog } from "../../src/db/bootstrap";
import { ensureDemoMenuWindow, applyMenuDays } from "../../src/lib/menus/sync";
import { getProvider } from "../../src/lib/menus/providers";
import { universities, diningLocations, syncRuns } from "../../src/db/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const db = await getDb();
  await seedCatalog(db);
  let t = Date.now();
  await ensureDemoMenuWindow();
  console.log("first window", (Date.now() - t) / 1000, "s");
  const counts = (await db.execute(sql`select (select count(*) from universities) u, (select count(*) from dining_locations) l, (select count(*) from foods) f, (select count(*) from menu_days) d, (select count(*) from menu_items) i, (select count(*) from menu_days where status='closed') closed`)) as unknown as { rows: unknown[] };
  console.log(counts.rows);
  const runs = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt));
  console.log(runs.map((r) => [r.status, r.trigger, r.dateFrom, r.dateTo, JSON.stringify(r.stats)]));
  // Re-apply the same window explicitly: everything must be unchanged.
  const [u] = await db.select().from(universities).where(eq(universities.isDemo, true));
  const locs = await db.select().from(diningLocations).where(eq(diningLocations.universityId, u.id));
  const res = await getProvider("demo").fetchRange({ university: u, locations: locs, from: runs[0].dateFrom!, to: runs[0].dateTo! });
  t = Date.now();
  const again = await applyMenuDays({ university: u, days: res.days, source: "demo", trigger: "manual" });
  console.log("re-apply", (Date.now() - t) / 1000, "s", again.status, JSON.stringify(again.stats));
  const est = (await db.execute(sql`select estimate->>'method' m, estimate->>'overallConfidence' c, count(*) n from foods group by 1,2 order by 3 desc`)) as unknown as { rows: unknown[] };
  console.log(est.rows);
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
