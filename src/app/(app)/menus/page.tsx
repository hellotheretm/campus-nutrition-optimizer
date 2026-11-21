import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/app/page-header";
import { MenuBrowser } from "@/components/menus/menu-browser";
import { MenusSkeleton } from "@/components/menus/menus-skeleton";
import { EmptyState } from "@/components/app/page-header";
import { getSessionUser } from "@/lib/auth";
import { defaultUniversity, getMenuView, listUniversities, type MenuView } from "@/lib/data/catalog";
import { getProfile } from "@/lib/data/user";
import type { MealPeriod } from "@/db/schema";
import { MEAL_PERIODS } from "@/lib/menus/types";

export const metadata: Metadata = {
  title: "Dining menus",
  description: "Browse dining-hall menus by day, market and meal, with nutrition and confidence labels.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function MenusPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        eyebrow="Dining menus"
        title="What's on the menu"
        description="Browse by day, dining market and meal. Calories and macros come from the dining operator when published; vitamins and minerals are USDA-based estimates with confidence labels."
      />
      <Suspense fallback={<MenusSkeleton />}>
        <MenusContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function nowHHMM(timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

/** The meal to open first: what's being served now (or next) today, otherwise lunch. */
function defaultPeriod(view: MenuView): MealPeriod | null {
  const offered = MEAL_PERIODS.filter((p) => view.locations.some((l) => l.periods.some((v) => v.period === p)));
  if (!offered.length) return null;
  if (view.date === view.today) {
    const now = nowHHMM(view.university.timezone);
    for (const p of offered) {
      const closes = view.locations
        .flatMap((l) => l.periods.filter((v) => v.period === p && v.scheduled))
        .map((v) => v.scheduled!.close);
      if (closes.some((c) => c > now)) return p;
    }
    return offered[offered.length - 1];
  }
  return offered.includes("lunch") ? "lunch" : offered[0];
}

async function MenusContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const user = await getSessionUser();
  const profile = user ? await getProfile(user.id) : null;
  const universities = await listUniversities();
  const requested = one(sp.u);
  const fallback = profile?.universityId ?? (await defaultUniversity())?.slug ?? null;
  const target = requested && universities.some((u) => u.slug === requested || u.id === requested) ? requested : fallback;
  if (!target) {
    return (
      <EmptyState title="No universities are set up yet">
        An administrator can add one from the built-in catalog, or you can request your campus.
      </EmptyState>
    );
  }
  const view = await getMenuView(target, one(sp.date));
  if (!view) {
    return <EmptyState title="That university isn't available">Choose another campus from the list.</EmptyState>;
  }
  const requestedMeal = one(sp.meal);
  const initialPeriod = MEAL_PERIODS.includes(requestedMeal as MealPeriod) ? (requestedMeal as MealPeriod) : defaultPeriod(view);

  return (
    <MenuBrowser
      view={view}
      universities={universities.map((u) => ({ id: u.id, slug: u.slug, name: u.name, shortName: u.shortName, isDemo: u.isDemo }))}
      initialPeriod={initialPeriod}
      initialLocation={one(sp.loc) ?? null}
      signedIn={Boolean(user)}
      showCalories={profile?.showCalories ?? true}
      savedAllergens={profile?.dietary.avoidAllergens ?? []}
    />
  );
}
