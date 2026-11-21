import type { Metadata } from "next";
import { Suspense } from "react";
import { EmptyState, PageHeader, Panel } from "@/components/app/page-header";
import { OptimizerApp } from "@/components/optimizer/optimizer-app";
import type { OptimizerDefaults, OptimizerUniversity, PeriodAvailability, SavedPlanView } from "@/components/optimizer/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { getSessionUser } from "@/lib/auth";
import { defaultUniversity, getMenuView, listUniversities } from "@/lib/data/catalog";
import { DEFAULT_DIETARY, getPlan, getProfile, NO_TARGETS } from "@/lib/data/user";
import { addDays, formatTime, isIsoDate, todayIn } from "@/lib/dates";
import { MEAL_PERIOD_LABELS } from "@/lib/menus/types";
import { PLAN_PERIODS, planRequestSchema, type PlanResult } from "@/lib/optimizer/types";

export const metadata: Metadata = {
  title: "Meal optimizer",
  description: "Build a day of dining-hall meals that covers your vitamin, mineral, protein and fiber references, with transparent confidence labels.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function OptimizerPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        eyebrow="Meal optimizer"
        title="Plan meals from the menu"
        description="Choose meals and dining markets. The optimizer picks items and portions that cover your vitamin, mineral, protein and fiber references, counting uncertain estimates conservatively. You don't need to track anything to use it."
      />
      <Suspense fallback={<OptimizerSkeleton />}>
        <OptimizerContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function OptimizerSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading the optimizer">
      <Panel className="grid gap-4">
        <Skeleton className="h-9 w-64 rounded-full" />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-10 w-40 rounded-full" />
      </Panel>
      <Skeleton className="h-48 rounded-3xl" />
    </div>
  );
}

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

async function OptimizerContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const user = await getSessionUser();
  const profile = user ? await getProfile(user.id) : null;
  const universities = await listUniversities();

  // A saved plan (from History) opens with its own date and campus.
  let saved: SavedPlanView | null = null;
  const planParam = one(sp.plan);
  if (planParam && user) {
    const row = await getPlan(user.id, planParam);
    const request = row ? planRequestSchema.safeParse(row.request) : null;
    if (row && request?.success) {
      saved = { id: row.id, name: row.name, request: request.data, result: row.result as unknown as PlanResult };
    }
  }

  const requested = saved?.request.universityId ?? one(sp.u);
  const match = (key: string | null | undefined) => (key ? universities.find((u) => u.id === key || u.slug === key) : undefined);
  const university = match(requested) ?? match(profile?.universityId) ?? match((await defaultUniversity())?.id);
  if (!university) {
    return (
      <EmptyState title="No universities are set up yet">
        An administrator can add one from the built-in catalog, or you can request your campus.
      </EmptyState>
    );
  }

  const today = todayIn(university.timezone);
  const minDate = addDays(today, -7);
  const maxDate = addDays(today, 14);
  const requestedDate = saved?.request.date ?? one(sp.date);
  const date = requestedDate && isIsoDate(requestedDate) ? requestedDate : today;
  const view = await getMenuView(university.id, date);

  const availability: PeriodAvailability[] = PLAN_PERIODS.map((period) => ({
    period,
    label: MEAL_PERIOD_LABELS[period],
    locations: (view?.locations ?? []).flatMap((l) => {
      const p = l.periods.find((x) => x.period === period);
      if (!p) return [];
      return [
        {
          id: l.location.id,
          name: l.location.name,
          status: p.status,
          itemCount: p.itemCount,
          hours: p.scheduled ? `${formatTime(p.scheduled.open)}–${formatTime(p.scheduled.close)}` : null,
        },
      ];
    }),
  }));

  const ageGroup = profile?.ageGroup ?? "unspecified";
  const defaults: OptimizerDefaults = {
    reference: { standard: profile?.referenceStandard ?? "fda_dv", ageGroup, sex: profile?.sex ?? "unspecified" },
    preferences: profile?.dietary ?? DEFAULT_DIETARY,
    targets: profile?.targets ?? NO_TARGETS,
  };

  const uni: OptimizerUniversity = {
    id: university.id,
    slug: university.slug,
    name: university.name,
    shortName: university.shortName,
    isDemo: university.isDemo,
    autoSyncAllowed: university.autoSync.allowed,
    integrationStatus: university.integrationStatus,
    menuSourceUrl: university.menuSourceUrl,
  };

  return (
    <OptimizerApp
      key={`${university.id}:${date}:${saved?.id ?? ""}`}
      university={uni}
      universities={universities.map((u) => ({ id: u.id, slug: u.slug, name: u.name, isDemo: u.isDemo }))}
      date={date}
      today={today}
      minDate={minDate}
      maxDate={maxDate}
      availability={availability}
      defaults={defaults}
      signedIn={Boolean(user)}
      showCalories={profile?.showCalories ?? true}
      showPercentages={profile?.showPercentages ?? true}
      saved={saved}
    />
  );
}
