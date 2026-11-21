/**
 * Entry point for meal planning: validates the request, loads candidates
 * from stored menus, builds targets and solves.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { universities, type MealPeriod } from "@/db/schema";
import { ensureDemoMenusFor } from "@/lib/menus/sync";
import { loadCandidates } from "./candidates";
import { optimize } from "./model";
import { buildTargets } from "./targets";
import { planRequestSchema, type PlanRequestInput, type PlanResult } from "./types";

export class PlanRequestError extends Error {}

export async function generatePlan(input: PlanRequestInput): Promise<PlanResult> {
  const parsed = planRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new PlanRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const req = parsed.data;
  const periods = req.meals.map((m) => m.period) as MealPeriod[];
  if (new Set(periods).size !== periods.length) throw new PlanRequestError("Each meal can only appear once.");
  const db = await getDb();
  const [university] = await db.select().from(universities).where(eq(universities.id, req.universityId)).limit(1);
  if (!university || !university.isActive) throw new PlanRequestError("Unknown university.");
  if (university.isDemo) await ensureDemoMenusFor(university, req.date);
  const meals = await loadCandidates(db, req);
  const targets = buildTargets(req, periods);
  return optimize(req, meals, targets);
}

export type { PlanRequest, PlanRequestInput, PlanResult } from "./types";
