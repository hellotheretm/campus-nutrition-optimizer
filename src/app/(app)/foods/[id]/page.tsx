import { ArrowLeft, ExternalLink, History, Info, TriangleExclamationPoint } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Panel } from "@/components/app/page-header";
import { LogFoodButton } from "@/components/diary/log-food-dialog";
import { FavoriteButton } from "@/components/foods/favorite-button";
import { ConfidenceBadge, MethodBadge, ProvenanceBadge } from "@/components/nutrition/badges";
import { AllergenChips, DietaryChips } from "@/components/nutrition/label-chips";
import { NutrientTable } from "@/components/nutrition/nutrient-table";
import { Skeleton } from "@/components/ui/skeleton";
import { getSessionUser } from "@/lib/auth";
import { getFoodDetail } from "@/lib/data/catalog";
import { getProfile, listFavorites, menuFoodKey } from "@/lib/data/user";
import { formatDate, todayIn } from "@/lib/dates";
import { fmtNutrient, fmtPercent } from "@/lib/format";
import { MEAL_PERIOD_LABELS } from "@/lib/menus/types";
import type { NutrientEstimates } from "@/lib/nutrition/estimator";
import { METHOD_DESCRIPTIONS, METHOD_LABELS } from "@/lib/nutrition/provenance";
import type { NutrientId } from "@/lib/nutrition/nutrients";
import { getReferenceProfile, type ReferenceProfile } from "@/lib/nutrition/references";
import { USDA_SOURCE_LABELS, fdcUrl } from "@/lib/nutrition/usda-index-format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Food details" };

type Params = Promise<{ id: string }>;

export default function FoodPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<FoodSkeleton />}>
      <FoodContent params={params} />
    </Suspense>
  );
}

function FoodSkeleton() {
  return (
    <div className="grid gap-5" aria-busy="true" aria-label="Loading food details">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-40 rounded-3xl" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-96 rounded-3xl" />
        <Skeleton className="h-96 rounded-3xl" />
      </div>
    </div>
  );
}

const LABEL_ROWS: { id: NutrientId; indent?: boolean; bold?: boolean }[] = [
  { id: "fat", bold: true },
  { id: "saturated_fat", indent: true },
  { id: "trans_fat", indent: true },
  { id: "cholesterol", bold: true },
  { id: "sodium", bold: true },
  { id: "carbohydrate", bold: true },
  { id: "fiber", indent: true },
  { id: "sugars", indent: true },
  { id: "added_sugars", indent: true },
  { id: "protein", bold: true },
  { id: "vitamin_d" },
  { id: "calcium" },
  { id: "iron" },
  { id: "potassium" },
];

function LabelValue({ n, id }: { n: Partial<NutrientEstimates>; id: NutrientId }) {
  const est = n[id];
  if (!est || est.value === null || est.confidence === "none") return <span className="text-muted-foreground italic">Unknown</span>;
  return (
    <span className="tabular-nums">
      {est.provenance === "official" ? "" : "≈ "}
      {fmtNutrient(id, est.value)}
    </span>
  );
}

function NutritionLabel({ nutrients, servingText, reference }: { nutrients: Partial<NutrientEstimates>; servingText: string; reference: ReferenceProfile }) {
  const energy = nutrients.energy;
  return (
    <div className="rounded-2xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10">
      <p className="text-2xl font-extrabold tracking-tight">Nutrition per serving</p>
      <p className="mt-1 border-b-8 border-foreground pb-2 text-sm">
        Serving size <span className="font-semibold">{servingText}</span>
      </p>
      <div className="flex items-end justify-between border-b-4 border-foreground py-2">
        <span className="text-lg font-extrabold">Calories</span>
        <span className="text-3xl font-extrabold tabular-nums">
          {energy && energy.value !== null ? `${energy.provenance === "official" ? "" : "≈"}${Math.round(energy.value)}` : "Unknown"}
        </span>
      </div>
      <p className="border-b border-foreground/30 py-1 text-right text-xs font-semibold">
        {reference.standard === "fda_dv" ? "% Daily Value" : "% of reference"}
      </p>
      <dl>
        {LABEL_ROWS.map(({ id, indent, bold }) => {
          const est = nutrients[id];
          const ref = reference.values[id]?.amount ?? reference.limits[id];
          const pct = est && est.value !== null && ref ? fmtPercent((est.value / ref) * 100) : "";
          return (
            <div key={id} className={cn("flex items-baseline justify-between gap-3 border-b border-foreground/20 py-1 text-sm", indent && "pl-4", id === "protein" && "border-b-8 border-foreground")}>
              <dt className={cn(bold && "font-semibold")}>
                {
                  {
                    fat: "Total fat",
                    saturated_fat: "Saturated fat",
                    trans_fat: "Trans fat",
                    cholesterol: "Cholesterol",
                    sodium: "Sodium",
                    carbohydrate: "Total carbohydrate",
                    fiber: "Dietary fiber",
                    sugars: "Total sugars",
                    added_sugars: "Added sugars",
                    protein: "Protein",
                    vitamin_d: "Vitamin D",
                    calcium: "Calcium",
                    iron: "Iron",
                    potassium: "Potassium",
                  }[id as string]
                }{" "}
                <span className="font-normal">
                  <LabelValue n={nutrients} id={id} />
                </span>
              </dt>
              <dd className="font-semibold tabular-nums">{pct}</dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Values without “≈” were published by the dining operator. “≈” marks estimates; see the full table for ranges and sources.
      </p>
    </div>
  );
}

async function FoodContent({ params }: { params: Params }) {
  const { id } = await params;
  const detail = await getFoodDetail(decodeURIComponent(id));
  if (!detail) notFound();
  const { food, nutrients, university, appearances, upcoming, revisions } = detail;
  const user = await getSessionUser();
  const profile = user ? await getProfile(user.id) : null;
  const favoriteKey = menuFoodKey(food.universityId, food.lineageKey);
  const favorites = user ? await listFavorites(user.id) : [];
  const reference = getReferenceProfile({
    standard: profile?.referenceStandard ?? "fda_dv",
    ageGroup: profile?.ageGroup ?? "unspecified",
    sex: profile?.sex ?? "unspecified",
  });
  const today = todayIn(university?.timezone ?? "America/Chicago");
  const est = food.estimate;
  const grams = est?.servingGrams;
  const servingText = `${food.servingAmount ?? 1} ${food.servingUnit ?? "serving"}${
    grams?.value ? ` (${grams.basis === "stated" ? "" : "≈ "}${Math.round(grams.value)} g)` : ""
  }`;
  const latest = appearances[0];
  const next = upcoming[0];
  const isLatestRevision = revisions[0]?.id === food.id;
  const menuHref = university ? `/menus?u=${university.slug}${latest && latest.date !== today ? `&date=${latest.date}` : ""}` : "/menus";

  return (
    <article className="grid gap-5">
      <Link href={menuHref} className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to menus
      </Link>

      <Panel>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
              {university?.shortName ?? "Dining hall"}
              {university?.isDemo ? " · demo data" : ""}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance md:text-3xl">{food.name}</h1>
            {food.description && <p className="mt-1 text-sm text-muted-foreground">{food.description}</p>}
            <p className="mt-2 text-sm text-muted-foreground">
              {servingText}
              {latest && (
                <>
                  {" "}
                  · {latest.date === today ? "on today's menu" : `last served ${formatDate(latest.date, "medium")}`} ({MEAL_PERIOD_LABELS[latest.period].toLowerCase()}, {latest.location})
                </>
              )}
              {next && (!latest || latest.date !== today) && (
                <>
                  {" "}
                  · next on {formatDate(next.date, "medium")} ({MEAL_PERIOD_LABELS[next.period].toLowerCase()}, {next.location})
                </>
              )}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <ConfidenceBadge confidence={est?.overallConfidence ?? "none"} long />
              <MethodBadge method={est?.method ?? null} />
            </div>
            <div className="mt-3 grid gap-1.5">
              <DietaryChips labels={food.dietaryLabels} />
              <AllergenChips allergens={food.allergens} showEmpty />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <LogFoodButton
              food={{ id: food.id, name: food.name, servingLabel: `${food.servingAmount ?? 1} ${food.servingUnit ?? "serving"}` }}
              date={today}
              today={today}
              period={latest?.date === today ? latest.period : next?.period}
              locationName={latest?.date === today ? latest.location : null}
              signedIn={Boolean(user)}
              size="default"
              label="Log this"
            />
            <FavoriteButton
              foodKey={favoriteKey}
              name={food.name}
              initial={favorites.some((f) => f.foodKey === favoriteKey)}
              signedIn={Boolean(user)}
              next={`/foods/${food.id}`}
            />
          </div>
        </div>
        {!isLatestRevision && revisions[0] && (
          <p className="mt-4 flex items-start gap-2 rounded-2xl bg-amber-500/10 p-3 text-sm">
            <History className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              This is an older version of this dish.{" "}
              <Link href={`/foods/${revisions[0].id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                See the current recipe
              </Link>
              .
            </span>
          </p>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <NutritionLabel nutrients={nutrients} servingText={servingText} reference={reference} />
          <Panel className="p-4 md:p-5">
            <h2 className="text-sm font-semibold">Ingredients and allergens</h2>
            {food.ingredients ? (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{food.ingredients}</p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">The source didn&apos;t publish an ingredient list for this item.</p>
            )}
            <p className="mt-3 flex gap-2 rounded-xl bg-muted/60 p-3 text-xs leading-relaxed">
              <TriangleExclamationPoint className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {university?.allergenNotice ??
                  "Allergen labels come from the dining operator. Recipes, suppliers and cross-contact can change, so confirm with dining staff if you have an allergy."}{" "}
                Nutrient estimates never establish that a food is free of an allergen.
              </span>
            </p>
          </Panel>
        </div>

        <Panel className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">All nutrients per serving</h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            Ranges show where the true value most likely falls. Unknown values are not zero.
          </p>
          <NutrientTable nutrients={nutrients} reference={reference} />
        </Panel>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">How these numbers were estimated</h2>
          {est && <span className="text-xs text-muted-foreground">Estimator v{est.version}</span>}
        </div>
        {est ? (
          <div className="mt-3 grid gap-5">
            <div className="rounded-2xl bg-muted/50 p-4">
              <p className="font-medium">{METHOD_LABELS[est.method]}</p>
              <p className="mt-1 text-sm text-muted-foreground">{METHOD_DESCRIPTIONS[est.method]}</p>
              {est.explanation.length > 0 && (
                <ul className="mt-3 grid list-disc gap-1 pl-5 text-sm">
                  {est.explanation.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="inline text-muted-foreground">Serving weight: </dt>
                  <dd className="inline">
                    {grams?.value
                      ? `${grams.basis === "stated" ? "" : "≈ "}${Math.round(grams.value)} g${grams.low && grams.high && grams.basis !== "stated" ? ` (${Math.round(grams.low)}–${Math.round(grams.high)} g)` : ""} · ${{ stated: "stated by source", volume: "from volume", portion: "typical portion", energy: "from calories", recipe: "from recipe", unknown: "unknown basis" }[grams.basis]}`
                      : "Unknown"}
                  </dd>
                </div>
                {est.ingredientCoverage !== null && (
                  <div>
                    <dt className="inline text-muted-foreground">Recipe matched to USDA: </dt>
                    <dd className="inline">{Math.round(est.ingredientCoverage * 100)}% by weight</dd>
                  </div>
                )}
              </dl>
            </div>

            {est.warnings.length > 0 && (
              <ul className="grid gap-1.5 text-sm">
                {est.warnings.map((w, i) => (
                  <li key={i} className="flex gap-2">
                    <Info className="mt-0.5 size-4 shrink-0 text-conf-medium" aria-hidden="true" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}

            {est.matches.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">USDA FoodData Central records used</h3>
                <div className="overflow-x-auto rounded-2xl ring-1 ring-foreground/[0.07]">
                  <table className="w-full min-w-[36rem] text-sm">
                    <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">Ingredient</th>
                        <th scope="col" className="px-3 py-2 font-medium">USDA record</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                        <th scope="col" className="px-3 py-2 font-medium">Dataset</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-foreground/[0.06] bg-card/60">
                      {est.matches.map((m, i) => (
                        <tr key={`${m.fdcId}-${i}`}>
                          <td className="px-3 py-2">{m.role === "dish" ? <span className="text-muted-foreground">Whole dish</span> : m.ingredient}</td>
                          <td className="px-3 py-2">
                            <a href={fdcUrl(m.fdcId)} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 text-primary underline-offset-4 hover:underline">
                              {m.description}
                              <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                              <span className="sr-only">(FDC {m.fdcId}, opens in a new tab)</span>
                            </a>
                            {m.alternatives ? <span className="block text-xs text-muted-foreground">{m.alternatives} similar records were also plausible</span> : null}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{m.grams ? `${Math.round(m.grams)} g` : "—"}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{USDA_SOURCE_LABELS[m.source]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>Legend:</span>
              <ProvenanceBadge provenance="official" />
              <ProvenanceBadge provenance="usda_match" />
              <ProvenanceBadge provenance="usda_recipe" />
              <ProvenanceBadge provenance="approximate" />
              <ProvenanceBadge provenance="unknown" />
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            This item hasn&apos;t been estimated yet. Only values published by the dining operator are shown.
          </p>
        )}
      </Panel>

      <div className="grid gap-5 md:grid-cols-2">
        <Panel>
          <h2 className="text-sm font-semibold">On the menu</h2>
          {upcoming.length > 0 && (
            <>
              <h3 className="mt-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Coming up</h3>
              <ul className="mt-1.5 grid gap-1.5 text-sm">
                {upcoming.map((a, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>{formatDate(a.date, "medium")}</span>
                    <span className="text-right text-muted-foreground">
                      {MEAL_PERIOD_LABELS[a.period]} · {a.location}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3 className="mt-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Recently served</h3>
          {appearances.length ? (
            <ul className="mt-3 grid gap-1.5 text-sm">
              {appearances.map((a, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{formatDate(a.date, "medium")}</span>
                  <span className="text-right text-muted-foreground">
                    {MEAL_PERIOD_LABELS[a.period]} · {a.location}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No stored menus include this version.</p>
          )}
        </Panel>
        <Panel>
          <h2 className="text-sm font-semibold">Recipe versions</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            When the source changes a dish&apos;s nutrition or ingredients, a new version is kept so past diary entries stay accurate.
          </p>
          <ul className="mt-3 grid gap-1.5 text-sm">
            {revisions.map((r) => (
              <li key={r.id} className="flex justify-between gap-3">
                {r.id === food.id ? (
                  <span className="font-medium">Version {r.revision} (this page)</span>
                ) : (
                  <Link href={`/foods/${r.id}`} className="text-primary underline-offset-4 hover:underline">
                    Version {r.revision}
                  </Link>
                )}
                <span className="text-muted-foreground">
                  {formatDate(r.firstSeen, "short")}–{formatDate(r.lastSeen, "short")}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </article>
  );
}
