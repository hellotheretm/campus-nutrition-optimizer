import { CalendarClock, NotebookPen, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader, Panel } from "@/components/app/page-header";
import { PlanActions } from "@/components/history/plan-actions";
import { ConfidenceBadge } from "@/components/nutrition/badges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth";
import { defaultUniversity, getUniversity } from "@/lib/data/catalog";
import { getProfile, listDiary, listPlans, type DiaryEntry } from "@/lib/data/user";
import { addDays, formatDate, relativeDayLabel, timeAgo, todayIn } from "@/lib/dates";
import { fmtGrams, fmtKcal } from "@/lib/format";
import { MEAL_PERIOD_LABELS } from "@/lib/menus/types";
import { coverageOf, groupByDate, KEY_NUTRIENTS, overallConfidence, totalsOf } from "@/lib/nutrition/daily";
import { getReferenceProfile, type ReferenceProfile } from "@/lib/nutrition/references";
import { STRATEGIES, type PlanResult } from "@/lib/optimizer/types";

export const metadata: Metadata = {
  title: "History",
  description: "Your past diary days and saved meal plans.",
};

export default function HistoryPage() {
  return (
    <>
      <PageHeader
        eyebrow="History"
        title="Your history"
        description="Past diary days and saved meal plans. Only you can see these."
      />
      <Suspense
        fallback={
          <div className="grid gap-4" aria-busy="true" aria-label="Loading your history">
            <Skeleton className="h-72 rounded-3xl" />
            <Skeleton className="h-48 rounded-3xl" />
          </div>
        }
      >
        <HistoryContent />
      </Suspense>
    </>
  );
}

async function HistoryContent() {
  const user = await requireUser("/history");
  const profile = await getProfile(user.id);
  const university = (profile.universityId ? await getUniversity(profile.universityId) : null) ?? (await defaultUniversity());
  const today = todayIn(university?.timezone ?? "America/Chicago");
  const entries = await listDiary(user.id, addDays(today, -29), addDays(today, 14));
  const plans = await listPlans(user.id, 30);
  const reference = getReferenceProfile({ standard: profile.referenceStandard, ageGroup: profile.ageGroup, sex: profile.sex });

  const days = groupByDate(entries);
  const past = days.filter(([d]) => d <= today);
  const upcoming = days.filter(([d]) => d > today).reverse();

  return (
    <div className="grid grid-cols-1 gap-6">
      {upcoming.length > 0 && (
        <Panel aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading" className="mb-3 font-semibold">
            Coming up
          </h2>
          <ul className="flex flex-wrap gap-2">
            {upcoming.map(([date, list]) => (
              <li key={date}>
                <Link
                  href={`/diary?date=${date}`}
                  className="inline-flex items-center gap-2 rounded-full bg-muted/70 px-3 py-1.5 text-sm ring-1 ring-border hover:bg-muted"
                >
                  <span className="font-medium">{relativeDayLabel(date, today)}</span>
                  <span className="text-muted-foreground">
                    {list.length} planned item{list.length === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel aria-labelledby="diary-history-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="diary-history-heading" className="font-semibold">
              Diary, last 30 days
            </h2>
            <p className="text-sm text-muted-foreground">
              Totals count what you marked as eaten. Days with nothing logged are left out rather than counted as zero.
            </p>
          </div>
          <Button asChild size="sm" variant="outline" className="rounded-full">
            <Link href="/diary">
              <NotebookPen aria-hidden="true" />
              Open today
            </Link>
          </Button>
        </div>
        {past.length === 0 ? (
          <EmptyState icon={<CalendarClock className="size-5" aria-hidden="true" />} title="No diary days yet">
            When you log food, each day shows up here with its totals and how confident the estimates are.
          </EmptyState>
        ) : (
          <DiaryDays days={past} today={today} reference={reference} showCalories={profile.showCalories} />
        )}
      </Panel>

      <Panel aria-labelledby="plans-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="plans-heading" className="font-semibold">
              Saved meal plans
            </h2>
            <p className="text-sm text-muted-foreground">Plans stay separate from your diary until you choose to add them.</p>
          </div>
          <Button asChild size="sm" variant="outline" className="rounded-full">
            <Link href="/optimizer">
              <Sparkles aria-hidden="true" />
              New plan
            </Link>
          </Button>
        </div>
        {plans.length === 0 ? (
          <EmptyState icon={<Sparkles className="size-5" aria-hidden="true" />} title="No saved plans">
            Generate a plan in the meal optimizer and save it to find it here.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-foreground/[0.07]">
            {plans.map((p) => {
              const result = p.result as unknown as PlanResult;
              const name = p.name ?? `Plan for ${formatDate(p.date, "medium")}`;
              const meals = (result.meals ?? []).filter((m) => m.status === "planned");
              const items = meals.reduce((n, m) => n + m.items.length, 0);
              return (
                <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{name}</p>
                    <p className="text-xs text-muted-foreground">
                      For {formatDate(p.date, "long")} · {STRATEGIES[result.strategy]?.label ?? "Balanced"} · {items} item{items === 1 ? "" : "s"}
                      {profile.showCalories && result.energy?.shown && result.energy.value !== null ? ` · ≈ ${fmtKcal(result.energy.value)}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {meals.map((m) => `${MEAL_PERIOD_LABELS[m.period]}${m.locationName ? ` at ${m.locationName}` : ""}`).join(" · ")}
                      {meals.length ? " · " : ""}saved {timeAgo(p.createdAt)}
                    </p>
                  </div>
                  <PlanActions id={p.id} name={name} date={p.date} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function DiaryDays({
  days,
  today,
  reference,
  showCalories,
}: {
  days: [string, DiaryEntry[]][];
  today: string;
  reference: ReferenceProfile;
  showCalories: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl ring-1 ring-foreground/[0.07]">
      <table className="w-full min-w-[36rem] text-sm">
        <caption className="sr-only">Diary totals by day</caption>
        <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Day
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Items
            </th>
            {showCalories && (
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Energy
              </th>
            )}
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Protein
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Fiber
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Vitamins &amp; minerals
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-foreground/[0.06] bg-card/60">
          {days.map(([date, list]) => {
            const logged = list.filter((e) => e.status === "logged");
            const planned = list.length - logged.length;
            const totals = totalsOf(logged);
            const val = (id: "energy" | "protein" | "fiber") => {
              const t = totals[id];
              return t && t.known > 0 ? t.value : null;
            };
            const conf = overallConfidence(coverageOf(totals, reference, KEY_NUTRIENTS));
            const energy = val("energy");
            return (
              <tr key={date}>
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  <Link href={`/diary?date=${date}`} className="font-medium underline-offset-4 hover:underline">
                    {relativeDayLabel(date, today)}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{formatDate(date, "long")}</span>
                </th>
                <td className="px-3 py-2 text-muted-foreground">
                  {logged.length} eaten
                  {planned ? ` · ${planned} planned` : ""}
                </td>
                {showCalories && (
                  <td className="px-3 py-2 text-right tabular-nums">{logged.length ? (energy === null ? "Unknown" : `≈ ${fmtKcal(energy)}`) : "—"}</td>
                )}
                <td className="px-3 py-2 text-right tabular-nums">{logged.length ? fmtGrams(val("protein")) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{logged.length ? fmtGrams(val("fiber")) : "—"}</td>
                <td className="px-3 py-2">{logged.length ? <ConfidenceBadge confidence={conf} prefix="Estimates" /> : <span className="text-muted-foreground">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
