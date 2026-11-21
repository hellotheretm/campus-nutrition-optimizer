/**
 * Database access.
 *
 *  - DATABASE_URL set   → PostgreSQL through node-postgres (e.g. Supabase, Neon, RDS).
 *  - DATABASE_URL unset → embedded PGlite (Postgres compiled to WebAssembly) stored
 *    in ./.data/pglite, so the app runs locally with zero setup.
 *
 * Migrations run automatically on first use unless DB_AUTO_MIGRATE=false.
 * Private user data must be accessed through withUser(), which enforces
 * row-level security in addition to the explicit user_id filters in queries.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "./schema";
import { runMigrations } from "./migrate";

if (typeof window !== "undefined") {
  throw new Error("The database client must never be imported in browser code.");
}

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

export interface DbHandle {
  db: Db;
  kind: "pglite" | "postgres";
  /** Runs a multi-statement SQL script (used by migrations). */
  execScript(text: string): Promise<void>;
  close(): Promise<void>;
}

const globalForDb = globalThis as unknown as { __cnoDb?: Promise<DbHandle> };

async function connect(): Promise<DbHandle> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const ssl =
      process.env.DATABASE_SSL === "disable" || /localhost|127\.0\.0\.1/.test(url)
        ? undefined
        : { rejectUnauthorized: process.env.DATABASE_SSL !== "no-verify" };
    const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 5), ssl });
    const db = drizzle({ client: pool, schema }) as unknown as Db;
    return {
      db,
      kind: "postgres",
      async execScript(text) {
        const client = await pool.connect();
        try {
          await client.query(text);
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = process.env.PGLITE_DATA_DIR || join(process.cwd(), ".data", "pglite");
  if (!dir.startsWith("memory://")) mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  await client.waitReady;
  const db = drizzle({ client, schema }) as unknown as Db;
  return {
    db,
    kind: "pglite",
    async execScript(text) {
      await client.exec(text);
    },
    close: () => client.close(),
  };
}

export function getDbHandle(): Promise<DbHandle> {
  if (!globalForDb.__cnoDb) {
    globalForDb.__cnoDb = (async () => {
      const handle = await connect();
      if (process.env.DB_AUTO_MIGRATE !== "false") await runMigrations(handle);
      return handle;
    })().catch((err) => {
      globalForDb.__cnoDb = undefined;
      throw err;
    });
  }
  return globalForDb.__cnoDb;
}

export async function getDb(): Promise<Db> {
  return (await getDbHandle()).db;
}

/** Closes the connection (scripts and tests). */
export async function closeDb(): Promise<void> {
  const p = globalForDb.__cnoDb;
  globalForDb.__cnoDb = undefined;
  if (p) await (await p).close();
}

/**
 * Runs `fn` in a transaction as the restricted `cno_app` role with
 * app.user_id set, so row-level security limits every statement to the
 * signed-in user's rows.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!userId || typeof userId !== "string") throw new Error("withUser requires a user id");
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    await tx.execute(sql`set local role cno_app`);
    return fn(tx as unknown as Tx);
  });
}

export function newId(prefix = ""): string {
  const id = crypto.randomUUID().replace(/-/g, "");
  return prefix ? `${prefix}_${id}` : id;
}

export { schema };
