/**
 * Minimal migration runner: applies db/migrations/*.sql in filename order,
 * each in its own transaction, and records them in schema_migrations.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { DbHandle } from "./client";

export function migrationsDir(): string {
  return process.env.MIGRATIONS_DIR || join(process.cwd(), "db", "migrations");
}

export async function runMigrations(handle: DbHandle, dir = migrationsDir()): Promise<string[]> {
  await handle.execScript(
    "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now());",
  );
  const result = (await handle.db.execute(sql`select version from schema_migrations`)) as unknown as {
    rows: { version: string }[];
  };
  const applied = new Set(result.rows.map((r) => r.version));
  // The migrations are bundled through outputFileTracingIncludes (next.config.ts).
  const files = readdirSync(/*turbopackIgnore: true*/ dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const ran: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const body = readFileSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, file), "utf8");
    const escaped = version.replace(/'/g, "''");
    await handle.execScript(`begin;\n${body}\ninsert into schema_migrations (version) values ('${escaped}');\ncommit;`);
    ran.push(version);
  }
  return ran;
}
