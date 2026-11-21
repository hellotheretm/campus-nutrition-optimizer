"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { universities } from "@/db/schema";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { REQUEST_STATUSES, setRequestStatus } from "@/lib/data/requests";
import { reestimateOutdated, scheduledWindow, syncFromProvider } from "@/lib/menus/sync";
import { errorMessage, fail, ok, type ActionResult } from "./result";

// Menu imports go through /api/admin/import (larger body limit).

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) throw new Error("Administrator access is required.");
  return user;
}

function refreshAdminPages() {
  revalidatePath("/admin");
  revalidatePath("/universities");
  revalidatePath("/menus");
}

export async function syncUniversityAction(universityId: string): Promise<ActionResult<{ status: string; message: string }>> {
  try {
    const user = await requireAdmin();
    const db = await getDb();
    const [u] = await db.select().from(universities).where(eq(universities.id, String(universityId))).limit(1);
    if (!u) return fail("Unknown university.");
    const { from, to } = scheduledWindow(u.timezone);
    const r = await syncFromProvider({ universityId: u.id, from, to, trigger: "manual", triggeredBy: user.id });
    refreshAdminPages();
    if (r.status === "skipped") return fail(r.error ?? "Automatic retrieval isn't allowed for this university.");
    if (r.status === "failed") return fail(`Sync failed: ${r.error ?? "unknown error"}. Earlier menus were kept.`);
    const s = r.stats;
    return ok({
      status: r.status,
      message: `${r.status === "partial" ? "Partly synced" : "Synced"} ${s.days} menus: ${s.items} items, ${s.newFoods} new foods, ${s.changedFoods} changed.`,
    });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function reestimateAction(): Promise<ActionResult<{ updated: number; remaining: number }>> {
  try {
    await requireAdmin();
    const r = await reestimateOutdated(200);
    refreshAdminPages();
    return ok(r);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function setRequestStatusAction(id: string, status: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const s = z.enum(REQUEST_STATUSES).parse(status);
    if (!(await setRequestStatus(String(id), s))) return fail("That request no longer exists.");
    revalidatePath("/admin");
    return ok(null);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
