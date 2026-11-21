import { ArrowRight, NotebookPen, Sparkles, UtensilsCrossed } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader, Panel } from "@/components/app/page-header";
import { WeekChart, type WeekDay } from "@/components/dashboard/week-chart";
import { ConfidenceBadge } from "@/components/nutrition/badges";
import { NutrientBars } from "@/components/nutrition/nutrient-bars";
import { CoverageList } from "@/components/nutrition/coverage-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth";
import { defaultUniversity, getMenuView, getUniversity, type MenuFoodCard, type MenuLocationView } from "@/lib/data/catalog";
import { getProfile, listDiary, listPlans, type DiaryEntry } from "@/lib/data/user";
import { addDays, dateRange, formatDate, todayIn, weekdayOf } from "@/lib/dates";
import { fmtGrams, fmtKcal, plainName } from "@/lib/format";
import { MEAL_PERIOD_LABELS } from "@/lib/menus/types";
import { coverageOf, totalsOf } from "@/lib/nutrition/daily";
import type { NutrientId } from "@/lib/nutrition/nutrients";
import { getReferenceProfile, type ReferenceProfile } from "@/lib/nutrition/references";
import { STRATEGIES, type PlanResult } from "@/lib/optimizer/types";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Today's totals, the last seven days and ideas from today's dining-hall menu.",
};

const TODAY_NUTRIENTS: NutrientId[] = ["fiber", "vitamin_c", "vitamin_d", "calcium", "iron", "potassium"];
const CHART_NUTRIENTS: NutrientId[] = [
  "protein",
  "fiber",
  "vitamin_a",
  "vitamin_c",
  "vitamin_d",
  "folate",
  "vitamin_b12",
  "calcium",
  "iron",
  "magnesium",
  "potassium",
  "zinc",
  "sodium",
];
/** Candidates for menu ideas: nutrients the menu cards can highlight. */
const IDEA_NUTRIENTS: NutrientId[] = ["fiber", "vitamin_a", "vitamin_c", "vitamin_d", "folate", "calcium", "iron", "magnesium", "potassium", "zinc"];
/** Nutrients the Dietary Guidelines for Americans list as commonly under-consumed. */
const DEFAULT_IDEAS: NutrientId[] = ["fiber", "calcium", "potassium", "vitamin_d"];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="grid gap-4" aria-busy="true" aria-label="Loading your dashboard">
          <Skeleton className="h-20 w-2/3 rounded-3xl" />
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-80 rounded-3xl lg:col-span-2" />
            <Skeleton className="h-80 rounded-3xl" />
          </div>
          <Skeleton className="h-80 rounded-3xl" />
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}

async function DashboardContent() {
  const user = await requireUser("/dashboard");
  const profile = await getProfile(user.id);
  const university = (profile.universityId ? await getUniversity(profile.universityId) : null) ?? (await defaultUniversity());
  const today = todayIn(university?.timezone ?? "America/Chicago");
  const from = addDays(today, -6);
  const entries = await listDiary(user.id, from, today);
  const plans = await listPlans(user.id, 3);
  const reference = getReferenceProfile({ standard: profile.referenceStandard, ageGroup: profile.ageGroup, sex: profile.sex });
  const menu = university ? await getMenuView(university.id, today).catch(() => null) : null;
  const name = profile.displayName || user.name?.split(" ")[0] || null;

  const todays = entries.filter((e) => e.date === today);
  const loggedToday = todays.filter((e) => e.status === "logged");
  const plannedToday = todays.length - loggedToday.length;
  const totalsToday = totalsOf(loggedToday);
  const energyToday = totalsToday.energy && totalsToday.energy.known > 0 ? totalsToday.energy.value : null;

  const week = buildWeek(entries, from, today, profile.showCalories);
  const anyWeek = week.some((d) => d.logged > 0);
  const focus = pickFocus(entries.filter((e) => e.status === "logged"), reference);
  const ideas = menu ? menuIdeas(menu.locations, focus.ids) : [];

  const references: Partial<Record<NutrientId, { amount: number; kind: "goal" | "limit" }>> = {};
  for (const id of CHART_NUTRIENTS) {
    const goal = reference.values[id]?.amount;
    const limit = reference.limits[id];
    if (goal) references[id] = { amount: goal, kind: "goal" };
    else if (limit) references[id] = { amount: limit, kind: "limit" };
  }

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title={name ? `Hi, ${name}` : "Welcome back"}
        description={`${formatDate(today, "long")}${university ? ` · ${university.name}${university.isDemo ? " (fictional demo)" : ""}` : ""}`}
        actions={
          <>
            <Button asChild className="rounded-full">
              <Link href="/diary">
                <NotebookPen aria-hidden="true" />
                Log food
              </Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/optimizer">
                <Sparkles aria-hidden="true" />
                Plan meals
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {!anyWeek && plans.length === 0 && (
          <Panel aria-labelledby="start-heading" className="glass-strong lg:col-span-3">
            <h2 id="start-heading" className="font-semibold">
              Two tools, use either or both
            </h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Link href="/diary" className="group rounded-2xl p-4 ring-1 ring-border transition-colors hover:bg-muted/60">
                <p className="flex items-center gap-2 font-medium">
                  <NotebookPen className="size-4 text-primary" aria-hidden="true" />
                  Track what you eat
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Log dining-hall dishes, USDA foods or your own entries. No plan needed.
                </p>
              </Link>
              <Link href="/optimizer" className="group rounded-2xl p-4 ring-1 ring-border transition-colors hover:bg-muted/60">
                <p className="flex items-center gap-2 font-medium">
                  <Sparkles className="size-4 text-primary" aria-hidden="true" />
                  Plan from today’s menus
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Get balanced meal suggestions from what’s actually being served. No tracking needed.
                </p>
              </Link>
            </div>
          </Panel>
        )}

        <Panel aria-labelledby="today-heading" className="grid content-start gap-5 lg:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="today-heading" className="font-semibold">
                Today so far
              </h2>
              <p className="text-sm text-muted-foreground">
                {loggedToday.length
                  ? `${loggedToday.length} item${loggedToday.length === 1 ? "" : "s"} eaten${plannedToday ? ` · ${plannedToday} planned` : ""}`
                  : plannedToday
                    ? `${plannedToday} planned item${plannedToday === 1 ? "" : "s"}, nothing marked as eaten yet`
                    : "Nothing logged yet today."}
              </p>
            </div>
            <Button asChild size="sm" variant="ghost" className="rounded-full">
              <Link href="/diary">
                Open diary
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
          {loggedToday.length > 0 && (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {profile.showCalories && (
                  <div className="rounded-2xl bg-muted/60 p-3">
                    <dt className="text-xs text-muted-foreground">Energy</dt>
                    <dd className="font-semibold">{energyToday === null ? "Unknown" : `≈ ${fmtKcal(energyToday)}`}</dd>
                  </div>
                )}
                {(["protein", "carbohydrate", "fat"] as const).map((id) => {
                  const t = totalsToday[id];
                  return (
                    <div key={id} className="rounded-2xl bg-muted/60 p-3">
                      <dt className="text-xs text-muted-foreground">{MACRO_LABEL[id]}</dt>
                      <dd className="font-semibold">{t && t.known > 0 ? `≈ ${fmtGrams(t.value)}` : "—"}</dd>
                    </div>
                  );
                })}
              </dl>
              <CoverageList
                items={coverageOf(totalsToday, reference, TODAY_NUTRIENTS)}
                showPercent={profile.showPercentages}
                className="sm:grid-cols-2 sm:gap-x-6"
              />
            </>
          )}
          <p className="text-xs text-muted-foreground">
            Compared with {reference.shortLabel}: general benchmarks, not personal targets. A single day is never a deficiency.
          </p>
        </Panel>

        <Panel aria-labelledby="ideas-heading" className="grid content-start gap-3">
          <div>
            <h2 id="ideas-heading" className="font-semibold">
              Ideas from today’s menu
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {focus.fromDiary
                ? `${capitalize(listText(focus.ids.map(lowerName)))} ${focus.ids.length === 1 ? "has" : "have"} been on the lower side in what you logged this week. If you’d like more, these are good sources.`
                : `Good sources of ${listText(focus.ids.map(lowerName))}, which many people get less of than recommended.`}
            </p>
          </div>
          {!menu || ideas.length === 0 ? (
            <p className="rounded-2xl bg-muted/60 p-3 text-sm text-muted-foreground">
              {menu
                ? "Today’s menu doesn’t have standout sources of these. Browse the full menu for other options."
                : "Today’s menu isn’t available for your university."}{" "}
              <Link href="/menus" className="font-medium text-foreground underline underline-offset-4">
                Browse menus
              </Link>
            </p>
          ) : (
            <ul className="grid gap-2">
              {ideas.map((i) => (
                <li key={i.card.id}>
                  <Link href={`/foods/${i.card.id}`} className="block rounded-2xl p-3 ring-1 ring-border transition-colors hover:bg-muted/60">
                    <p className="font-medium">{i.card.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {MEAL_PERIOD_LABELS[i.period]} · {i.location}
                    </p>
                    <NutrientBars items={i.highlights} className="mt-2 max-w-sm" />
                    <div className="mt-2">
                      <ConfidenceBadge confidence={i.card.confidence} prefix="Micros" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">Ideas, not instructions. Estimates per serving; see each food for details.</p>
        </Panel>

        <Panel aria-labelledby="week-heading" className="lg:col-span-2">
          <WeekChart days={week} options={profile.showCalories ? ["energy", ...CHART_NUTRIENTS] : CHART_NUTRIENTS} references={references} initial="fiber" />
        </Panel>

        <Panel aria-labelledby="plans-heading" className="grid content-start gap-3">
          <div className="flex items-end justify-between gap-2">
            <h2 id="plans-heading" className="font-semibold">
              Recent plans
            </h2>
            <Link href="/history" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              All history
            </Link>
          </div>
          {plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No saved plans yet.{" "}
              <Link href="/optimizer" className="font-medium text-foreground underline underline-offset-4">
                Try the optimizer
              </Link>
              .
            </p>
          ) : (
            <ul className="grid gap-2">
              {plans.map((p) => {
                const result = p.result as unknown as PlanResult;
                const items = (result.meals ?? []).reduce((n, m) => n + m.items.length, 0);
                return (
                  <li key={p.id}>
                    <Link
                      href={`/optimizer?plan=${encodeURIComponent(p.id)}`}
                      className="block rounded-2xl p-3 ring-1 ring-border transition-colors hover:bg-muted/60"
                    >
                      <p className="font-medium">{p.name ?? `Plan for ${formatDate(p.date, "medium")}`}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(p.date, "medium")} · {STRATEGIES[result.strategy]?.label ?? "Balanced"} · {items} item{items === 1 ? "" : "s"}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <Button asChild variant="outline" size="sm" className="mt-1 w-fit rounded-full">
            <Link href="/menus">
              <UtensilsCrossed aria-hidden="true" />
              Today’s menus
            </Link>
          </Button>
        </Panel>
      </div>
    </>
  );
}

const MACRO_LABEL = { protein: "Protein", carbohydrate: "Carbs", fat: "Fat" } as const;

/** Nutrient name for use mid-sentence: "vitamin D", "dietary fiber". */
function lowerName(id: NutrientId): string {
  const n = plainName(id);
  return /^Vitamin /.test(n) ? n.replace(/^Vitamin/, "vitamin") : n.toLowerCase();
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function listText(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function buildWeek(entries: DiaryEntry[], from: string, to: string, showCalories: boolean): WeekDay[] {
  return dateRange(from, to).map((date) => {
    const logged = entries.filter((e) => e.date === date && e.status === "logged");
    const totals = totalsOf(logged);
    const values: WeekDay["values"] = {};
    for (const id of showCalories ? (["energy", ...CHART_NUTRIENTS] as NutrientId[]) : CHART_NUTRIENTS) {
      const t = totals[id];
      if (t && t.known > 0) values[id] = { value: t.value, low: t.low, high: t.high, confidence: t.confidence, unknown: t.unknown };
    }
    return { date, label: WEEKDAY[weekdayOf(date)], logged: logged.length, values };
  });
}

/**
 * Picks up to two nutrients to suggest foods for: the lowest average share
 * of the reference across days with logged food (needs at least two such
 * days); otherwise commonly under-consumed nutrients.
 */
function pickFocus(logged: DiaryEntry[], reference: ReferenceProfile): { ids: NutrientId[]; fromDiary: boolean } {
  const byDate = new Map<string, DiaryEntry[]>();
  for (const e of logged) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  if (byDate.size >= 2) {
    const scores: { id: NutrientId; avg: number }[] = [];
    for (const id of IDEA_NUTRIENTS) {
      const ref = reference.values[id]?.amount;
      if (!ref) continue;
      const shares: number[] = [];
      for (const list of byDate.values()) {
        const t = totalsOf(list)[id];
        if (t && t.known > 0 && t.confidence !== "none") shares.push(t.value / ref);
      }
      if (shares.length >= 2) scores.push({ id, avg: shares.reduce((a, b) => a + b, 0) / shares.length });
    }
    const low = scores.filter((s) => s.avg < 0.7).sort((a, b) => a.avg - b.avg);
    if (low.length) return { ids: low.slice(0, 2).map((s) => s.id), fromDiary: true };
  }
  return { ids: DEFAULT_IDEAS, fromDiary: false };
}

function menuIdeas(locations: MenuLocationView[], focus: NutrientId[]) {
  const seen = new Set<string>();
  const out: { card: MenuFoodCard; period: keyof typeof MEAL_PERIOD_LABELS; location: string; highlights: MenuFoodCard["highlights"]; score: number }[] = [];
  for (const loc of locations) {
    for (const p of loc.periods) {
      for (const st of p.stations) {
        for (const card of st.items) {
          const hits = card.highlights.filter((h) => focus.includes(h.id));
          if (!hits.length || seen.has(card.name.toLowerCase())) continue;
          seen.add(card.name.toLowerCase());
          out.push({ card, period: p.period, location: loc.location.name, highlights: hits, score: Math.max(...hits.map((h) => h.percent)) });
        }
      }
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

