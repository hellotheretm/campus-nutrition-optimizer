/**
 * Approved menu-data import (administrators only). A route handler rather
 * than a Server Action so that only this endpoint accepts bodies up to the
 * 5 MB import limit; every Server Action keeps the default 1 MB cap.
 */
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { commitImport, importRequestSchema, parseImportRequest, previewView } from "@/lib/menus/admin-import";
import { MAX_IMPORT_BYTES } from "@/lib/menus/import-format";
import { rateLimit } from "@/lib/rate-limit";
import { errorMessage } from "@/app/actions/result";

/** File text plus the JSON envelope and source fields. */
const MAX_BODY_BYTES = MAX_IMPORT_BYTES * 1.2 + 64 * 1024;

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Same-origin check (the session cookie is SameSite=Lax, this is defense in depth). */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readLimited(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json(403, { error: "Cross-site requests aren't allowed." });
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json(415, { error: "Send the import as JSON." });
  }
  const user = await getSessionUser();
  if (!isAdmin(user)) return json(403, { error: "Administrator access is required." });
  const limit = await rateLimit(`admimp:${user!.id}`, 40, 600);
  if (!limit.ok) return json(429, { error: "Too many imports in a short time. Try again in a few minutes." });

  const text = await readLimited(request, MAX_BODY_BYTES);
  if (text === null) return json(413, { error: "That file is larger than the 5 MB import limit. Split it by date range." });

  try {
    const input = importRequestSchema.parse(JSON.parse(text));
    if (input.mode === "preview") {
      const { preview } = await parseImportRequest(input);
      return json(200, { ok: true, preview: previewView(preview) });
    }
    const result = await commitImport(input, user!.id);
    revalidatePath("/admin");
    revalidatePath("/universities");
    revalidatePath("/menus");
    if (result.status === "failed") {
      return json(500, { error: `Import failed: ${result.error ?? "unknown error"}. Nothing was changed.` });
    }
    const s = result.stats;
    return json(200, {
      ok: true,
      status: result.status,
      message: `Imported ${s.days} menus with ${s.items} items (${s.newFoods} new foods, ${s.changedFoods} changed, ${s.unchangedFoods} unchanged).`,
      warnings: s.warnings.slice(0, 20),
    });
  } catch (e) {
    const message = e instanceof SyntaxError ? "That request wasn't valid JSON." : errorMessage(e, "Couldn't import that file.");
    return json(400, { error: message });
  }
}
