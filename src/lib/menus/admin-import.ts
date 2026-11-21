/**
 * Approved menu-data imports (the documented fallback when automatic
 * retrieval isn't permitted). Files are validated on the server twice: once
 * for the preview and again, from the same bytes, when committed.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { diningLocations, universities } from "@/db/schema";
import { importSourceSchema, MAX_IMPORT_BYTES, parseImportCsv, parseImportJson, type ImportPreview } from "./import-format";
import { applyMenuDays, type SyncResult } from "./sync";

export const importRequestSchema = z.object({
  mode: z.enum(["preview", "commit"]),
  universityId: z.string().min(1).max(100),
  fileName: z.string().trim().min(1).max(200),
  text: z.string().min(1, "the file is empty").max(MAX_IMPORT_BYTES, "the file is larger than 5 MB"),
  /** Required for CSV (JSON files carry their own source block). */
  source: importSourceSchema.optional(),
});

export type ImportRequest = z.infer<typeof importRequestSchema>;

export interface ImportPreviewView {
  ok: boolean;
  errors: string[];
  warnings: string[];
  source: ImportPreview["source"];
  summary: ImportPreview["summary"];
  sample: { location: string; date: string; period: string; status: string; items: number }[];
}

function isCsv(req: ImportRequest): boolean {
  if (/\.csv$/i.test(req.fileName)) return true;
  if (/\.json$/i.test(req.fileName)) return false;
  return !req.text.trimStart().startsWith("{");
}

export async function parseImportRequest(req: ImportRequest) {
  const db = await getDb();
  const [university] = await db.select().from(universities).where(eq(universities.id, req.universityId)).limit(1);
  if (!university) throw new Error("Unknown university.");
  const locations = await db
    .select({ slug: diningLocations.slug, externalRef: diningLocations.externalRef })
    .from(diningLocations)
    .where(eq(diningLocations.universityId, university.id));
  const ctx = { universitySlug: university.slug, locations };
  let preview: ImportPreview;
  if (isCsv(req)) {
    if (!req.source) throw new Error("For CSV files, describe the source and record who approved its use.");
    preview = parseImportCsv(req.text, req.source, ctx);
  } else {
    preview = parseImportJson(req.text, ctx);
  }
  return { university, preview };
}

export function previewView(preview: ImportPreview): ImportPreviewView {
  return {
    ok: preview.ok,
    errors: preview.errors.slice(0, 50),
    warnings: preview.warnings.slice(0, 50),
    source: preview.source,
    summary: preview.summary,
    sample: preview.days
      .slice(0, 12)
      .map((d) => ({ location: d.location, date: d.date, period: d.period, status: d.status, items: d.items.length })),
  };
}

export async function commitImport(req: ImportRequest, adminUserId: string): Promise<SyncResult> {
  const { university, preview } = await parseImportRequest(req);
  if (!preview.ok || !preview.source) throw new Error(preview.errors[0] ?? "The file has errors; nothing was imported.");
  return applyMenuDays({
    university,
    days: preview.days,
    source: "import",
    trigger: "import",
    triggeredBy: adminUserId,
    warnings: preview.warnings,
    importSource: { ...preview.source, fileName: req.fileName },
  });
}
