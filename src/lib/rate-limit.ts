/**
 * Fixed-window rate limiting stored in Postgres (works across server
 * instances). Client addresses are hashed with the server secret before
 * storage, so raw IP addresses are never kept.
 */
import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "@/db/client";

export async function clientFingerprint(): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  const salt = process.env.BETTER_AUTH_SECRET ?? "development";
  return createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 32);
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
}

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const db = await getDb();
  const result = (await db.execute(sql`
    insert into rate_limits (key, count, window_start) values (${key}, 1, now())
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   then now() else rate_limits.window_start end
    returning count
  `)) as unknown as { rows: { count: number }[] };
  const count = Number(result.rows[0]?.count ?? 0);
  return { ok: count <= limit, remaining: Math.max(0, limit - count) };
}

/**
 * Removes expired windows. Keys starting with "ureqk:" (one university
 * request per campus per person per 30 days) are kept for 31 days.
 */
export async function pruneRateLimits(): Promise<void> {
  const db = await getDb();
  await db.execute(sql`
    delete from rate_limits
    where (window_start < now() - interval '2 days' and key not like 'ureqk:%')
       or window_start < now() - interval '31 days'
  `);
}
