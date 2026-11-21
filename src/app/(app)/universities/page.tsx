import { ArrowUpRight, CalendarRange, Clock, MapPin, School, Sparkles, Store, UtensilsCrossed } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader, Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { IntegrationBadge, INTEGRATION_LABELS } from "@/components/universities/status-badge";
import { listUniversities, type UniversitySummary } from "@/lib/data/catalog";
import { formatDate, timeAgo, todayIn } from "@/lib/dates";

export const metadata: Metadata = {
  title: "Universities",
  description: "Campuses supported by Campus Nutrition Optimizer, where their menu data comes from, and how current it is.",
};

export default function UniversitiesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Universities"
        title="Supported campuses"
        description="Each campus shows where its menu data comes from and how current it is. Menus are only shown when they come from the dining operator's published menus or a menu file, never invented."
        actions={
          <Button asChild variant="outline">
            <Link href="/request-university">Request a university</Link>
          </Button>
        }
      />
      <Suspense
        fallback={
          <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading universities">
            <Skeleton className="h-72 rounded-3xl" />
            <Skeleton className="h-72 rounded-3xl" />
          </div>
        }
      >
        <UniversityList />
      </Suspense>
    </>
  );
}

async function UniversityList() {
  const list = await listUniversities();
  return (
    <div className="grid gap-6">
      {list.length ? (
        <ul className="grid gap-4 md:grid-cols-2" aria-label="Supported universities">
          {list.map((u) => (
            <li key={u.id} className="flex">
              <UniversityCard u={u} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<School className="size-5" aria-hidden="true" />} title="No universities are set up yet">
          An administrator can add one from the built-in catalog.
        </EmptyState>
      )}
      <Panel className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Don&apos;t see your university?</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Tell us which campus to add next. Requests for the same school are combined, and a campus is added only once its
            real menus can be loaded.
          </p>
        </div>
        <Button asChild>
          <Link href="/request-university">Request your university</Link>
        </Button>
      </Panel>
    </div>
  );
}

function UniversityCard({ u }: { u: UniversitySummary }) {
  const today = todayIn(u.timezone);
  const hasMenus = Boolean(u.menuDataThrough && u.menuDataThrough >= today);
  const place = [u.city, u.state].filter(Boolean).join(", ");
  return (
    <article className="glass flex w-full flex-col gap-4 rounded-3xl p-5 md:p-6" aria-labelledby={`uni-${u.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`uni-${u.id}`} className="text-lg font-semibold text-balance">
            {u.name}
          </h2>
          {place && (
            <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="size-3.5" aria-hidden="true" />
              {place}
            </p>
          )}
        </div>
        <IntegrationBadge status={u.integrationStatus} />
      </header>

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <Fact icon={<Store className="size-4" aria-hidden="true" />} term="Dining locations" value={String(u.locationCount)} />
        <Fact
          icon={<Clock className="size-4" aria-hidden="true" />}
          term="Last menu update"
          value={u.lastSync ? timeAgo(u.lastSync.at) : "Never"}
        />
        <Fact
          icon={<CalendarRange className="size-4" aria-hidden="true" />}
          term="Menus through"
          value={u.menuDataThrough ? formatDate(u.menuDataThrough, "short") : "No menus yet"}
        />
      </dl>

      <div className="space-y-2 text-sm text-muted-foreground">
        <p>{INTEGRATION_LABELS[u.integrationStatus].detail}</p>
        {u.integrationNotes && u.integrationNotes !== INTEGRATION_LABELS[u.integrationStatus].detail && <p>{u.integrationNotes}</p>}
        {!hasMenus && !u.isDemo && (
          <p className="font-medium text-foreground">
            No current menus are stored for this campus. Check the official menus while we work on access.
          </p>
        )}
      </div>

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button asChild size="sm">
          <Link href={`/menus?u=${u.slug}`}>
            <UtensilsCrossed aria-hidden="true" />
            Menus
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={`/optimizer?u=${u.slug}`}>
            <Sparkles aria-hidden="true" />
            Plan meals
          </Link>
        </Button>
        {u.menuSourceUrl && (
          <Button asChild size="sm" variant="ghost">
            <a href={u.menuSourceUrl} target="_blank" rel="noopener noreferrer">
              Official menus
              <ArrowUpRight aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </Button>
        )}
        {u.nutritionInfoUrl && (
          <Button asChild size="sm" variant="ghost">
            <a href={u.nutritionInfoUrl} target="_blank" rel="noopener noreferrer">
              Nutrition &amp; allergens
              <ArrowUpRight aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </Button>
        )}
      </div>
    </article>
  );
}

function Fact({ icon, term, value }: { icon: React.ReactNode; term: string; value: string }) {
  return (
    <div className="rounded-2xl bg-background/50 px-3 py-2.5 ring-1 ring-border/60">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {term}
      </dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
