import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/app/page-header";
import { DiaryView, type DiaryEntryView } from "@/components/diary/diary-view";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth";
import { defaultUniversity, getUniversity } from "@/lib/data/catalog";
import { getProfile, listDiary } from "@/lib/data/user";
import { addDays, isIsoDate, todayIn } from "@/lib/dates";
import { getReferenceProfile } from "@/lib/nutrition/references";

export const metadata: Metadata = {
  title: "Food diary",
  description: "Log what you eat from dining halls, USDA foods or your own entries. No meal plan required.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function DiaryPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        eyebrow="Food diary"
        title="Your food diary"
        description="Track what you eat from dining-hall menus, USDA FoodData Central or your own entries. The diary stands on its own: you never need to generate a meal plan to use it."
      />
      <Suspense fallback={<DiarySkeleton />}>
        <DiaryContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function DiarySkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading your diary">
      <Skeleton className="h-16 rounded-3xl" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="grid gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-3xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-3xl" />
      </div>
    </div>
  );
}

async function DiaryContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const requested = raw && isIsoDate(raw) ? raw : null;
  const user = await requireUser(requested ? `/diary?date=${requested}` : "/diary");
  const profile = await getProfile(user.id);
  const university = (profile.universityId ? await getUniversity(profile.universityId) : null) ?? (await defaultUniversity());
  const today = todayIn(university?.timezone ?? "America/Chicago");
  const date = requested ?? today;
  // Sequential on purpose: the local PGlite database serves one transaction at a time.
  const rows = await listDiary(user.id, date, date);
  const previous = await listDiary(user.id, addDays(date, -1), addDays(date, -1));
  const reference = getReferenceProfile({ standard: profile.referenceStandard, ageGroup: profile.ageGroup, sex: profile.sex });

  const entries: DiaryEntryView[] = rows.map((r) => ({
    id: r.id,
    meal: r.meal,
    status: r.status,
    name: r.name,
    servingLabel: r.servingLabel,
    servings: r.servings,
    grams: r.grams,
    locationName: r.locationName,
    source: r.custom ? "custom" : r.fdcId ? "usda" : "dining",
    foodId: r.foodId,
    fdcId: r.fdcId,
    nutrients: r.nutrients,
  }));
  const minor = profile.ageGroup === "under_19";
  const goal = profile.calorieGoal;

  return (
    <DiaryView
      key={date}
      date={date}
      today={today}
      entries={entries}
      previousCount={previous.length}
      reference={reference}
      showCalories={profile.showCalories}
      showPercentages={profile.showPercentages}
      calorieGoal={!minor && (goal.min || goal.max) ? goal : null}
      proteinGoal={minor ? null : profile.proteinGoal}
      university={university ? { id: university.id, name: university.name, isDemo: university.isDemo } : null}
    />
  );
}
