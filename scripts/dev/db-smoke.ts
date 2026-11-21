import { sql, eq } from "drizzle-orm";
import { getDb, withUser, closeDb, getDbHandle } from "../../src/db/client";
import { authUser, diaryEntries } from "../../src/db/schema";
async function main() {
  const handle = await getDbHandle();
  const db = await getDb();
  console.log("kind", handle.kind);
  await db.insert(authUser).values([{ id: "u1", name: "A", email: "a@example.test" }, { id: "u2", name: "B", email: "b@example.test" }]);
  const base = { date: "2026-11-19", meal: "lunch" as const, name: "Test", nutrients: {} as never };
  await withUser("u1", (tx) => tx.insert(diaryEntries).values({ ...base, id: "d1", userId: "u1" }));
  await withUser("u2", (tx) => tx.insert(diaryEntries).values({ ...base, id: "d2", userId: "u2" }));
  const asU1 = await withUser("u1", (tx) => tx.select().from(diaryEntries));
  console.log("u1 sees", asU1.map((r) => r.id));
  try {
    await withUser("u1", (tx) => tx.insert(diaryEntries).values({ ...base, id: "d3", userId: "u2" }));
    console.log("ERROR: cross-user insert allowed");
  } catch (e) { console.log("cross-user insert blocked:", (e as Error).message.slice(0, 80)); }
  const upd = await withUser("u1", (tx) => tx.update(diaryEntries).set({ name: "hacked" }).where(eq(diaryEntries.id, "d2")).returning());
  console.log("u1 updating u2 row affected", upd.length);
  const del = await withUser("u2", (tx) => tx.delete(diaryEntries).where(eq(diaryEntries.id, "d1")).returning());
  console.log("u2 deleting u1 row affected", del.length);
  const all = (await db.execute(sql`select id, name from diary_entries order by id`)) as unknown as { rows: unknown[] };
  console.log("owner sees", all.rows);
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
