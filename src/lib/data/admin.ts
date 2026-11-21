/** Read models for the administrator page. Callers must check isAdmin first. */
import "server-only";
import { desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { foods, syncRuns, universities } from "@/db/schema";
import { ESTIMATOR_VERSION } from "@/lib/nutrition/estimator";

export interface SyncRunView {
  id: string;
  universityName: string;
  provider: string;
  trigger: string;
  status: string;
  dateFrom: string | null;
  dateTo: string | null;
  startedAt: string;
  finishedAt: string | null;
  days: number | null;
  items: number | null;
  newFoods: number | null;
  changedFoods: number | null;
  warnings: string[];
  error: string | null;
  importSource: { name: string; obtainedFrom: string; permission: string; fileName?: string } | null;
}

export async function listSyncRuns(limit = 25): Promise<SyncRunView[]> {
  const db = await getDb();
  const rows = await db
    .select({ run: syncRuns, universityName: universities.name })
    .from(syncRuns)
    .innerJoin(universities, eq(universities.id, syncRuns.universityId))
    .orderBy(desc(syncRuns.startedAt))
    .limit(limit);
  return rows.map(({ run, universityName }) => ({
    id: run.id,
    universityName,
    provider: run.provider,
    trigger: run.trigger,
    status: run.status,
    dateFrom: run.dateFrom,
    dateTo: run.dateTo,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    days: run.stats?.days ?? null,
    items: run.stats?.items ?? null,
    newFoods: run.stats?.newFoods ?? null,
    changedFoods: run.stats?.changedFoods ?? null,
    warnings: run.stats?.warnings?.slice(0, 5) ?? [],
    error: run.error,
    importSource: run.stats?.importSource ?? null,
  }));
}

/** Foods whose micronutrient estimate predates the current estimator. */
export async function countOutdatedEstimates(): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(foods)
    .where(or(isNull(foods.estimateVersion), ne(foods.estimateVersion, ESTIMATOR_VERSION)));
  return row?.n ?? 0;
}
