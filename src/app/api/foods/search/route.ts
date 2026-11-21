import { NextResponse, type NextRequest } from "next/server";
import { searchMenuFoods } from "@/lib/data/catalog";
import { searchUsda } from "@/lib/nutrition/usda-index";
import { USDA_SOURCE_LABELS } from "@/lib/nutrition/usda-index-format";

/**
 * Food search for the diary's "add food" dialog.
 *   ?source=dining&u=<universityId>&q=...   dishes seen on that campus's menus
 *   ?source=usda&q=...                       USDA FoodData Central foods
 * Public, read-only data.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 80);
  const source = params.get("source") === "usda" ? "usda" : "dining";
  if (q.length < 2) return NextResponse.json({ results: [] });

  if (source === "dining") {
    const u = params.get("u");
    if (!u) return NextResponse.json({ results: [] });
    const results = await searchMenuFoods(u, q, 15);
    return NextResponse.json({ results }, { headers: { "Cache-Control": "private, max-age=30" } });
  }

  const matches = searchUsda(q, { mode: "dish", limit: 15 });
  const results = matches.map((m) => ({
    fdcId: m.food.fdcId,
    description: m.food.description,
    source: USDA_SOURCE_LABELS[m.food.source],
    category: m.food.category,
    energyPer100g: m.food.per100g.energy ?? null,
    proteinPer100g: m.food.per100g.protein ?? null,
    portions: m.food.portions.slice(0, 6),
  }));
  return NextResponse.json({ results }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
