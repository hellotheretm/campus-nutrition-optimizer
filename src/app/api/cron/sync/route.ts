/**
 * Scheduled menu sync. Call with `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron sends this header automatically when CRON_SECRET is set).
 * Universities whose provider does not allow automatic retrieval are skipped.
 */
import { timingSafeEqual } from "node:crypto";
import { ensureBootstrapped } from "@/db/bootstrap";
import { reestimateOutdated, syncAllScheduled } from "@/lib/menus/sync";
import { pruneRateLimits } from "@/lib/rate-limit";

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  await ensureBootstrapped();
  const results = await syncAllScheduled();
  const reestimated = await reestimateOutdated(200);
  await pruneRateLimits();
  return Response.json({
    ok: true,
    results: results.map((r) => ({
      university: r.university,
      status: r.result.status,
      error: r.result.error ?? null,
      stats: r.result.stats,
    })),
    reestimated,
  });
}
