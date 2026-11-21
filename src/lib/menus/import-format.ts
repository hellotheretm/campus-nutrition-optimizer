/**
 * Approved menu-data imports.
 *
 * When automatic retrieval from a university's menu system is not authorized,
 * menus can be loaded from files the dining operator provides or approves.
 * Every import must say where the data came from and who approved its use;
 * values are stored exactly as supplied (missing nutrients stay unknown).
 *
 * Two formats are accepted:
 *  - JSON: { format: "cno-menu-import", version: 1, ... } (see docs/MENU_DATA_INTEGRATION.md)
 *  - CSV: one row per menu item, with the source details entered alongside the upload.
 */
import Papa from "papaparse";
import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import type { MealPeriod, OfficialNutrients } from "@/db/schema";
import { NUTRIENTS } from "@/lib/nutrition/nutrients";
import { normalizeAllergens, normalizeDietary } from "./labels";
import { PLAUSIBLE_MAX, resolveNutrientKey, toCanonical } from "./nutrient-keys";
import type { NormalizedMenuDay, NormalizedMenuItem } from "./types";

export const IMPORT_FORMAT = "cno-menu-import";
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const PERIODS = ["breakfast", "brunch", "lunch", "dinner", "late_night", "other"] as const;

const isoDate = z.string().refine(isIsoDate, "must be a date like 2026-11-19");
const shortText = (max: number) => z.string().trim().max(max);

const itemSchema = z.object({
  id: shortText(200).optional(),
  name: shortText(200).min(1, "item name is required"),
  description: shortText(2000).optional(),
  station: shortText(120).optional(),
  serving: z
    .object({
      amount: z.number().positive().max(10000).optional(),
      unit: shortText(40).optional(),
      grams: z.number().positive().max(5000).optional(),
    })
    .optional(),
  nutrients: z.record(z.string(), z.number().nonnegative().nullable()).optional(),
  ingredients: shortText(10000).optional(),
  allergens: z.array(shortText(60)).max(40).optional(),
  dietaryLabels: z.array(shortText(60)).max(40).optional(),
});

const daySchema = z.object({
  location: shortText(120).min(1),
  date: isoDate,
  period: z.enum(PERIODS),
  status: z.enum(["available", "closed"]).default("available"),
  note: shortText(500).optional(),
  items: z.array(itemSchema).max(600).default([]),
});

export const importSourceSchema = z.object({
  name: shortText(200).min(1, "describe the data source"),
  obtainedFrom: shortText(500).min(1, "say where the file came from"),
  permission: shortText(1000).min(1, "record who approved this use of the data"),
  retrievedAt: shortText(40).optional(),
});

export type ImportSource = z.infer<typeof importSourceSchema>;

export const menuImportSchema = z.object({
  format: z.literal(IMPORT_FORMAT),
  version: z.literal(1),
  university: shortText(120).min(1),
  source: importSourceSchema,
  days: z.array(daySchema).min(1).max(3000),
});

export type MenuImportFile = z.infer<typeof menuImportSchema>;

export interface ImportContext {
  universitySlug: string;
  locations: { slug: string; externalRef: string | null }[];
}

export interface ImportPreview {
  ok: boolean;
  errors: string[];
  warnings: string[];
  source: ImportSource | null;
  days: NormalizedMenuDay[];
  summary: {
    days: number;
    closedDays: number;
    items: number;
    locations: string[];
    dateFrom: string | null;
    dateTo: string | null;
    /** How many items publish each nutrient. */
    nutrientCoverage: Record<string, number>;
  };
}

function emptyPreview(errors: string[], source: ImportSource | null = null): ImportPreview {
  return {
    ok: false,
    errors,
    warnings: [],
    source,
    days: [],
    summary: { days: 0, closedDays: 0, items: 0, locations: [], dateFrom: null, dateTo: null, nutrientCoverage: {} },
  };
}

function convertNutrients(
  raw: Record<string, number | null> | undefined,
  where: string,
  errors: string[],
  warnings: string[],
): OfficialNutrients {
  const out: OfficialNutrients = {};
  if (!raw) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    const resolved = resolveNutrientKey(key);
    if (!resolved) {
      warnings.push(`${where}: ignored unknown nutrient "${key}"`);
      continue;
    }
    const converted = toCanonical(resolved.id, value, resolved.unit);
    if (typeof converted === "string") {
      errors.push(`${where}: ${converted}`);
      continue;
    }
    const max = PLAUSIBLE_MAX[resolved.id];
    if (max !== undefined && converted > max) {
      errors.push(
        `${where}: ${NUTRIENTS[resolved.id].name} = ${value}${resolved.unit ?? NUTRIENTS[resolved.id].unit} per serving looks wrong (check units)`,
      );
      continue;
    }
    out[resolved.id] = converted;
  }
  return out;
}

function buildPreview(file: MenuImportFile, ctx: ImportContext): ImportPreview {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (file.university !== ctx.universitySlug) {
    return emptyPreview([`This file is for "${file.university}", not "${ctx.universitySlug}".`], file.source);
  }
  const bySlug = new Map<string, string>();
  for (const l of ctx.locations) {
    bySlug.set(l.slug, l.slug);
    if (l.externalRef) bySlug.set(l.externalRef, l.slug);
  }
  const seen = new Set<string>();
  const days: NormalizedMenuDay[] = [];
  const coverage: Record<string, number> = {};
  for (const [i, d] of file.days.entries()) {
    const where = `days[${i}] (${d.location} ${d.date} ${d.period})`;
    const slug = bySlug.get(d.location);
    if (!slug) {
      errors.push(`${where}: unknown location "${d.location}"`);
      continue;
    }
    const key = `${slug}|${d.date}|${d.period}`;
    if (seen.has(key)) {
      errors.push(`${where}: the same location, date and meal appears more than once`);
      continue;
    }
    seen.add(key);
    if (d.status === "closed" && d.items.length) {
      errors.push(`${where}: a closed meal cannot list items`);
      continue;
    }
    if (d.status === "available" && !d.items.length) {
      warnings.push(`${where}: no items listed; it will be stored as "no menu published"`);
    }
    const items: NormalizedMenuItem[] = d.items.map((it, j) => {
      const official = convertNutrients(it.nutrients, `${where} item ${j + 1} "${it.name}"`, errors, warnings);
      for (const k of Object.keys(official)) coverage[k] = (coverage[k] ?? 0) + 1;
      return {
        name: it.name,
        description: it.description || null,
        station: it.station || null,
        servingAmount: it.serving?.amount ?? null,
        servingUnit: it.serving?.unit || null,
        servingGrams: it.serving?.grams ?? null,
        official,
        ingredients: it.ingredients || null,
        allergens: normalizeAllergens(it.allergens ?? []),
        dietaryLabels: normalizeDietary(it.dietaryLabels ?? []),
        sourceRef: it.id ?? null,
      };
    });
    days.push({
      location: slug,
      date: d.date,
      period: d.period as MealPeriod,
      status: d.status === "closed" ? "closed" : items.length ? "available" : "no_data",
      note: d.note ?? null,
      items,
    });
  }
  const dates = days.map((d) => d.date).sort();
  return {
    ok: errors.length === 0 && days.length > 0,
    errors: errors.slice(0, 200),
    warnings: warnings.slice(0, 200),
    source: file.source,
    days,
    summary: {
      days: days.length,
      closedDays: days.filter((d) => d.status === "closed").length,
      items: days.reduce((n, d) => n + d.items.length, 0),
      locations: [...new Set(days.map((d) => d.location))].sort(),
      dateFrom: dates[0] ?? null,
      dateTo: dates[dates.length - 1] ?? null,
      nutrientCoverage: coverage,
    },
  };
}

function zodErrors(error: z.ZodError): string[] {
  return error.issues.slice(0, 50).map((i) => `${i.path.join(".") || "file"}: ${i.message}`);
}

export function parseImportJson(text: string, ctx: ImportContext): ImportPreview {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return emptyPreview([`Not valid JSON: ${(e as Error).message}`]);
  }
  const parsed = menuImportSchema.safeParse(json);
  if (!parsed.success) return emptyPreview(zodErrors(parsed.error));
  return buildPreview(parsed.data, ctx);
}

const CSV_FIXED = new Set([
  "location",
  "date",
  "period",
  "meal",
  "status",
  "station",
  "name",
  "item",
  "description",
  "serving_amount",
  "serving_unit",
  "serving_grams",
  "ingredients",
  "allergens",
  "dietary_labels",
  "labels",
  "id",
  "note",
]);

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function num(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * CSV import: one row per item. Columns: location, date, period, status
 * (optional; "closed" rows have no name), station, name, description,
 * serving_amount, serving_unit, serving_grams, ingredients, allergens and
 * dietary_labels (separated by ";" or "|"), plus any nutrient columns such as
 * calories, protein_g, sodium_mg, vitamin_d_mcg.
 */
export function parseImportCsv(text: string, source: ImportSource, ctx: ImportContext): ImportPreview {
  const src = importSourceSchema.safeParse(source);
  if (!src.success) return emptyPreview(zodErrors(src.error));
  const result = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });
  if (result.errors.length) {
    return emptyPreview(result.errors.slice(0, 20).map((e) => `row ${(e.row ?? 0) + 2}: ${e.message}`), src.data);
  }
  const headers = result.meta.fields ?? [];
  for (const required of ["location", "date"]) {
    if (!headers.includes(required)) return emptyPreview([`missing required column "${required}"`], src.data);
  }
  if (!headers.includes("period") && !headers.includes("meal")) {
    return emptyPreview([`missing required column "period"`], src.data);
  }
  const nutrientColumns = headers.filter((h) => !CSV_FIXED.has(h));
  const rowErrors: string[] = [];
  const groups = new Map<string, MenuImportFile["days"][number]>();
  for (const [i, row] of result.data.entries()) {
    const line = i + 2;
    const period = (row.period ?? row.meal ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const key = `${row.location?.trim()}|${row.date?.trim()}|${period}`;
    let day = groups.get(key);
    if (!day) {
      day = {
        location: row.location?.trim() ?? "",
        date: row.date?.trim() ?? "",
        period: period as MealPeriod,
        status: row.status?.trim().toLowerCase() === "closed" ? "closed" : "available",
        note: row.note?.trim() || undefined,
        items: [],
      };
      groups.set(key, day);
    }
    const name = (row.name ?? row.item ?? "").trim();
    if (!name) continue;
    const nutrients: Record<string, number> = {};
    for (const col of nutrientColumns) {
      const v = num(row[col]);
      if (v === undefined) continue;
      if (Number.isNaN(v) || v < 0) {
        rowErrors.push(`row ${line}: "${col}" is not a non-negative number`);
        continue;
      }
      nutrients[col] = v;
    }
    const amount = num(row.serving_amount);
    const grams = num(row.serving_grams);
    day.items.push({
      id: row.id?.trim() || undefined,
      name,
      description: row.description?.trim() || undefined,
      station: row.station?.trim() || undefined,
      serving: {
        amount: amount !== undefined && !Number.isNaN(amount) ? amount : undefined,
        unit: row.serving_unit?.trim() || undefined,
        grams: grams !== undefined && !Number.isNaN(grams) ? grams : undefined,
      },
      nutrients,
      ingredients: row.ingredients?.trim() || undefined,
      allergens: splitList(row.allergens),
      dietaryLabels: splitList(row.dietary_labels ?? row.labels),
    });
  }
  const file = {
    format: IMPORT_FORMAT,
    version: 1,
    university: ctx.universitySlug,
    source: src.data,
    days: [...groups.values()],
  };
  const parsed = menuImportSchema.safeParse(file);
  if (!parsed.success) return emptyPreview([...rowErrors, ...zodErrors(parsed.error)], src.data);
  const preview = buildPreview(parsed.data, ctx);
  if (rowErrors.length) {
    preview.errors.unshift(...rowErrors.slice(0, 100));
    preview.ok = false;
  }
  return preview;
}
