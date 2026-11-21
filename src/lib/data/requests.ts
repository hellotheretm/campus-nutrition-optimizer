/**
 * "Don't see your university?" requests. Requests for the same campus are
 * merged by a normalized key and counted as supporters; contact emails are
 * optional and only stored when given.
 */
import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, newId } from "@/db/client";
import { universities, universityRequests } from "@/db/schema";

const STOP_WORDS = new Set(["the", "of", "at", "in"]);

/** Normalizes a university name for duplicate detection (case, accents, punctuation, "the"). */
export function normalizeKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\buniv\b\.?/g, "university")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(" ")
    .slice(0, 200);
}

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => !v || /^https?:\/\/[^\s]+\.[^\s]+/i.test(v), "must start with http:// or https://");

export const universityRequestSchema = z.object({
  universityName: z.string().trim().min(3, "enter the university's name").max(160),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  country: z.string().trim().max(80).optional(),
  websiteUrl: optionalUrl,
  menuUrl: optionalUrl,
  contactEmail: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined))
    .refine((v) => !v || z.email().safeParse(v).success, "enter a valid email address or leave it blank"),
  message: z.string().trim().max(1000).optional(),
});

export type UniversityRequestInput = z.input<typeof universityRequestSchema>;

export type RequestOutcome =
  | { kind: "created"; name: string }
  | { kind: "supported"; name: string; supporters: number }
  | { kind: "exists"; name: string; slug: string };

export async function submitUniversityRequest(raw: unknown, requesterUserId: string | null): Promise<RequestOutcome> {
  const data = universityRequestSchema.parse(raw);
  const key = normalizeKey(data.universityName);
  if (key.length < 3) throw new Error("Please enter the university's full name.");
  const db = await getDb();

  // Already supported?
  const existing = await db.select({ name: universities.name, shortName: universities.shortName, slug: universities.slug }).from(universities).where(eq(universities.isActive, true));
  const hit = existing.find((u) => normalizeKey(u.name) === key || (u.shortName ? normalizeKey(u.shortName) === key : false));
  if (hit) return { kind: "exists", name: hit.name, slug: hit.slug };

  const [row] = await db
    .insert(universityRequests)
    .values({
      id: newId("ureq"),
      universityName: data.universityName,
      normalizedKey: key,
      city: data.city || null,
      state: data.state || null,
      country: data.country || null,
      websiteUrl: data.websiteUrl ?? null,
      menuUrl: data.menuUrl ?? null,
      contactEmail: data.contactEmail ?? null,
      message: data.message || null,
      requesterUserId,
    })
    .onConflictDoUpdate({
      target: universityRequests.normalizedKey,
      set: {
        supporters: sql`${universityRequests.supporters} + 1`,
        updatedAt: new Date(),
        // Fill gaps from later requests without overwriting what's there.
        websiteUrl: sql`coalesce(${universityRequests.websiteUrl}, excluded.website_url)`,
        menuUrl: sql`coalesce(${universityRequests.menuUrl}, excluded.menu_url)`,
        city: sql`coalesce(${universityRequests.city}, excluded.city)`,
        state: sql`coalesce(${universityRequests.state}, excluded.state)`,
        country: sql`coalesce(${universityRequests.country}, excluded.country)`,
      },
    })
    .returning({ supporters: universityRequests.supporters, name: universityRequests.universityName });
  return row.supporters > 1 ? { kind: "supported", name: row.name, supporters: row.supporters } : { kind: "created", name: row.name };
}

export async function listUniversityRequests(limit = 200) {
  const db = await getDb();
  return db.select().from(universityRequests).orderBy(desc(universityRequests.supporters), desc(universityRequests.updatedAt)).limit(limit);
}

export const REQUEST_STATUSES = ["new", "reviewing", "planned", "declined", "added"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export async function setRequestStatus(id: string, status: RequestStatus): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .update(universityRequests)
    .set({ status, updatedAt: new Date() })
    .where(eq(universityRequests.id, id))
    .returning({ id: universityRequests.id });
  return rows.length > 0;
}
