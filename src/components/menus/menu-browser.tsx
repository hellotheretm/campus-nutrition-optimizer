"use client";

import { Clock, ExternalLink, FlaskConical, Info, MapPin, Search, SlidersHorizontal, TriangleExclamationPoint, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DateNav } from "@/components/common/date-nav";
import { LogFoodButton } from "@/components/diary/log-food-dialog";
import { ConfidenceBadge, FreshnessBadge } from "@/components/nutrition/badges";
import { NutrientBars } from "@/components/nutrition/nutrient-bars";
import { AllergenChips, DietaryChips } from "@/components/nutrition/label-chips";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { MealPeriod } from "@/db/schema";
import type { MenuFoodCard, MenuLocationView, MenuPeriodView, MenuView } from "@/lib/data/catalog";
import { formatDate, formatTime } from "@/lib/dates";
import { fmtGrams } from "@/lib/format";
import { ALLERGEN_LABELS, MAJOR_ALLERGENS } from "@/lib/menus/labels";
import { MEAL_PERIODS, MEAL_PERIOD_LABELS } from "@/lib/menus/types";
import { cn } from "@/lib/utils";

const DIET_FILTERS = [
  { key: "vegetarian", label: "Vegetarian" },
  { key: "vegan", label: "Vegan" },
  { key: "made_without_gluten", label: "Made without gluten" },
  { key: "halal", label: "Halal" },
] as const;

type DietKey = (typeof DIET_FILTERS)[number]["key"];

interface UniversityOption {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  isDemo: boolean;
}

function periodFor(loc: MenuLocationView, period: MealPeriod): MenuPeriodView | undefined {
  return loc.periods.find((p) => p.period === period);
}

function matches(item: MenuFoodCard, q: string, diet: Set<DietKey>, hide: Set<string>): boolean {
  if (q && !`${item.name} ${item.station ?? ""}`.toLowerCase().includes(q)) return false;
  for (const d of diet) {
    // Vegan items also satisfy "vegetarian".
    if (d === "vegetarian" && (item.dietaryLabels.includes("vegetarian") || item.dietaryLabels.includes("vegan"))) continue;
    if (!item.dietaryLabels.includes(d)) return false;
  }
  for (const a of hide) {
    if (item.allergens.includes(a)) return false;
    if ((a === "wheat" || a === "gluten") && (item.allergens.includes("wheat") || item.allergens.includes("gluten"))) return false;
  }
  return true;
}

export function MenuBrowser({
  view,
  universities,
  initialPeriod,
  initialLocation,
  signedIn,
  showCalories,
  savedAllergens,
}: {
  view: MenuView;
  universities: UniversityOption[];
  initialPeriod: MealPeriod | null;
  initialLocation: string | null;
  signedIn: boolean;
  showCalories: boolean;
  savedAllergens: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { university, date, today, locations } = view;

  const offered = useMemo(
    () => MEAL_PERIODS.filter((p) => locations.some((l) => l.periods.some((v) => v.period === p))),
    [locations],
  );
  const [periodState, setPeriodState] = useState<MealPeriod | null>(initialPeriod);
  const period = periodState && offered.includes(periodState) ? periodState : (offered[0] ?? null);
  const [location, setLocationState] = useState<string>(
    initialLocation && locations.some((l) => l.location.slug === initialLocation) ? initialLocation : "all",
  );
  const [query, setQuery] = useState("");
  const [diet, setDiet] = useState<Set<DietKey>>(new Set());
  const [hide, setHide] = useState<Set<string>>(new Set(savedAllergens.filter((a) => a in ALLERGEN_LABELS)));

  function syncUrl(next: { meal?: string | null; loc?: string | null }) {
    const p = new URLSearchParams(window.location.search);
    if (next.meal !== undefined) {
      if (next.meal) p.set("meal", next.meal);
      else p.delete("meal");
    }
    if (next.loc !== undefined) {
      if (next.loc && next.loc !== "all") p.set("loc", next.loc);
      else p.delete("loc");
    }
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }

  const setPeriod = (p: MealPeriod) => {
    setPeriodState(p);
    syncUrl({ meal: p });
  };
  const setLocation = (slug: string) => {
    setLocationState(slug);
    syncUrl({ loc: slug });
  };

  const q = query.trim().toLowerCase();
  const filtersActive = diet.size > 0 || hide.size > 0 || q.length > 0;
  const shown = location === "all" ? locations : locations.filter((l) => l.location.slug === location);
  const serving = period ? shown.filter((l) => periodFor(l, period)) : [];
  const notServing = period ? shown.filter((l) => !periodFor(l, period)) : shown;
  const isNutrislicePending = university.provider === "nutrislice" && !university.autoSync.allowed;
  const anyItems = serving.some((l) => (periodFor(l, period!)?.itemCount ?? 0) > 0);

  return (
    <div className="grid grid-cols-1 gap-5">
      {/* Controls */}
      <div className="glass-strong grid min-w-0 grid-cols-1 gap-3 rounded-3xl p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-2">
          {universities.length > 1 && (
            <Select value={university.slug} onValueChange={(slug) => router.push(`/menus?u=${encodeURIComponent(slug)}${date !== today ? `&date=${date}` : ""}`)}>
              <SelectTrigger className="h-9 w-auto min-w-44 rounded-full" aria-label="University">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {universities.map((u) => (
                  <SelectItem key={u.slug} value={u.slug}>
                    {u.shortName}
                    {u.isDemo ? " (demo)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DateNav date={date} today={today} />
        </div>

        {offered.length > 0 && period && (
          <Tabs value={period} onValueChange={(v) => setPeriod(v as MealPeriod)}>
            <TabsList className="h-10 w-fit max-w-full rounded-full" aria-label="Meal">
              {offered.map((p) => (
                <TabsTrigger key={p} value={p} className="rounded-full px-4">
                  {MEAL_PERIOD_LABELS[p]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Dining market">
            {[{ slug: "all", name: "All markets" }, ...locations.map((l) => ({ slug: l.location.slug, name: l.location.name }))].map((l) => {
              const loc = locations.find((x) => x.location.slug === l.slug);
              const closed = loc && period ? !periodFor(loc, period) || periodFor(loc, period)?.status === "closed" : false;
              return (
                <button
                  key={l.slug}
                  type="button"
                  aria-pressed={location === l.slug}
                  onClick={() => setLocation(l.slug)}
                  className={cn(
                    "h-8 shrink-0 rounded-full px-3 text-xs font-medium whitespace-nowrap ring-1 ring-border transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    location === l.slug ? "bg-foreground text-background ring-foreground" : "bg-background/60 hover:bg-muted",
                    closed && location !== l.slug && "text-muted-foreground",
                  )}
                >
                  {l.name}
                  {closed && <span className="ml-1 opacity-70">· closed</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full min-w-48 sm:w-60">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search this menu"
              aria-label="Search this menu"
              className="h-9 rounded-full pl-9"
            />
          </div>
          {DIET_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={diet.has(f.key)}
              onClick={() =>
                setDiet((s) => {
                  const n = new Set(s);
                  if (n.has(f.key)) n.delete(f.key);
                  else n.add(f.key);
                  return n;
                })
              }
              className={cn(
                "h-8 rounded-full px-3 text-xs font-medium ring-1 ring-border outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                diet.has(f.key) ? "bg-emerald-700 text-white ring-emerald-700" : "bg-background/60 hover:bg-muted",
              )}
            >
              {f.label}
            </button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 rounded-full">
                <SlidersHorizontal aria-hidden="true" />
                Allergens{hide.size ? ` (${hide.size})` : ""}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72" align="start">
              <p className="text-sm font-medium">Hide items labeled with</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[...MAJOR_ALLERGENS, "gluten" as const].map((a) => (
                  <Label key={a} className="flex items-center gap-2 text-sm font-normal">
                    <Checkbox
                      checked={hide.has(a)}
                      onCheckedChange={(c) =>
                        setHide((s) => {
                          const n = new Set(s);
                          if (c) n.add(a);
                          else n.delete(a);
                          return n;
                        })
                      }
                    />
                    {ALLERGEN_LABELS[a]}
                  </Label>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Uses the dining operator&apos;s labels only. Unlabeled items can still contain allergens or have cross-contact. Ask staff if you
                have an allergy.
              </p>
            </PopoverContent>
          </Popover>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-full"
              onClick={() => {
                setQuery("");
                setDiet(new Set());
                setHide(new Set());
              }}
            >
              <X aria-hidden="true" /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* Notices */}
      {university.isDemo && (
        <Alert className="rounded-2xl border-amber-500/30 bg-amber-500/5">
          <FlaskConical aria-hidden="true" />
          <AlertTitle>Demo University is fictional</AlertTitle>
          <AlertDescription>
            Its menus are generated from sample recipes so you can try every feature. Nothing here describes a real dining hall, so don&apos;t
            use it for real decisions.
          </AlertDescription>
        </Alert>
      )}
      {university.autoSync.mode === "unofficial" && (
        <p className="flex gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Menus are copied from {university.shortName}&apos;s public Nutrislice menus. This is an unofficial copy, not endorsed by the
            university or Nutrislice, and it can lag behind changes. Confirm allergens with dining staff.
            {university.menuSourceUrl && (
              <>
                {" "}
                <a className="font-medium text-primary underline-offset-4 hover:underline" href={university.menuSourceUrl} target="_blank" rel="noreferrer">
                  Official menus<span className="sr-only"> (opens in a new tab)</span>
                </a>
              </>
            )}
          </span>
        </p>
      )}
      {isNutrislicePending && (
        <Alert className="rounded-2xl border-primary/25 bg-primary/5">
          <Info aria-hidden="true" />
          <AlertTitle>{university.shortName} menus aren&apos;t connected yet</AlertTitle>
          <AlertDescription>
            <p>
              {university.shortName} publishes its menus through Nutrislice, and automatic sync is turned off on this server. Until it is turned
              on or menu files are imported, menus here stay empty rather than guessed. Dining hours below come from the official dining website.
            </p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {university.menuSourceUrl && (
                <a className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline" href={university.menuSourceUrl} target="_blank" rel="noreferrer">
                  Official menus <ExternalLink className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
              {university.nutritionInfoUrl && (
                <a className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline" href={university.nutritionInfoUrl} target="_blank" rel="noreferrer">
                  Nutrition &amp; allergen info <ExternalLink className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
              {universities.some((u) => u.isDemo) && (
                <Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/menus?u=${universities.find((u) => u.isDemo)!.slug}`}>
                  Explore the demo campus
                </Link>
              )}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {offered.length === 0 && (
        <div className="glass rounded-3xl p-8 text-center">
          <p className="font-medium">No dining markets are scheduled to open on {formatDate(date, "long")}.</p>
          <p className="mt-1 text-sm text-muted-foreground">Try another day.</p>
        </div>
      )}

      {/* Locations */}
      {period &&
        serving.map((loc) => {
          const pv = periodFor(loc, period)!;
          const stations = pv.stations
            .map((s) => ({ ...s, items: s.items.filter((i) => matches(i, q, diet, hide)) }))
            .filter((s) => s.items.length > 0);
          const hiddenCount = pv.itemCount - stations.reduce((n, s) => n + s.items.length, 0);
          return (
            <section key={loc.location.id} className="glass rounded-3xl p-4 md:p-6" aria-labelledby={`loc-${loc.location.slug}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id={`loc-${loc.location.slug}`} className="text-lg font-semibold tracking-tight md:text-xl">
                    {loc.location.name}
                  </h2>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    {pv.scheduled ? (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3.5" aria-hidden="true" />
                        {MEAL_PERIOD_LABELS[period]} {formatTime(pv.scheduled.open)}–{formatTime(pv.scheduled.close)}
                      </span>
                    ) : null}
                    {(loc.location.building || loc.location.address) && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3.5" aria-hidden="true" />
                        {loc.location.building ?? loc.location.address}
                      </span>
                    )}
                  </p>
                </div>
                <FreshnessBadge {...pv.freshness} />
              </div>

              {pv.status === "closed" ? (
                <p className="mt-4 rounded-2xl bg-muted/60 p-4 text-sm">
                  Closed for {MEAL_PERIOD_LABELS[period].toLowerCase()}
                  {pv.note ? `: ${pv.note}` : "."}
                </p>
              ) : pv.status !== "available" ? (
                <div className="mt-4 rounded-2xl bg-muted/60 p-4 text-sm">
                  <p className="font-medium">{pv.freshness.label}</p>
                  <p className="mt-1 text-muted-foreground">{pv.freshness.detail}</p>
                  {!university.isDemo && university.menuSourceUrl && (
                    <a
                      href={university.menuSourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Check the official menu <ExternalLink className="size-3.5" aria-hidden="true" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  )}
                </div>
              ) : stations.length === 0 ? (
                <p className="mt-4 rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">
                  No items match your filters here ({hiddenCount} hidden).
                </p>
              ) : (
                <div className="mt-5 grid gap-6">
                  {stations.map((s) => (
                    <div key={s.name}>
                      <h3 className="mb-2.5 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">{s.name}</h3>
                      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {s.items.map((item) => (
                          <li key={item.id}>
                            <FoodCard
                              item={item}
                              date={date}
                              today={today}
                              period={period}
                              locationName={loc.location.name}
                              signedIn={signedIn}
                              showCalories={showCalories}
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {hiddenCount > 0 && <p className="text-xs text-muted-foreground">{hiddenCount} more item{hiddenCount === 1 ? "" : "s"} hidden by your filters.</p>}
                </div>
              )}
            </section>
          );
        })}

      {period && notServing.length > 0 && (
        <p className="px-1 text-sm text-muted-foreground">
          Not serving {MEAL_PERIOD_LABELS[period].toLowerCase()} on {formatDate(date, "medium")}:{" "}
          {notServing.map((l) => l.location.name).join(", ")}.
        </p>
      )}

      {period && anyItems && (
        <p className="flex gap-2 px-1 text-xs text-muted-foreground">
          <TriangleExclamationPoint className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {university.allergenNotice ??
              "Allergen and dietary labels come from the dining operator. Recipes and suppliers change and cross-contact is possible, so confirm with dining staff if you have a food allergy."}{" "}
            Vitamin and mineral values are estimates; open an item to see how each was calculated.
          </span>
        </p>
      )}
    </div>
  );
}

function FoodCard({
  item,
  date,
  today,
  period,
  locationName,
  signedIn,
  showCalories,
}: {
  item: MenuFoodCard;
  date: string;
  today: string;
  period: MealPeriod;
  locationName: string;
  signedIn: boolean;
  showCalories: boolean;
}) {
  return (
    <article className="group flex h-full flex-col rounded-2xl bg-card/85 p-3.5 ring-1 ring-foreground/[0.07] transition-shadow hover:shadow-md hover:ring-primary/25">
      <div className="flex items-start justify-between gap-3">
        <h4 className="min-w-0 text-[0.95rem] leading-snug font-medium">
          <Link href={`/foods/${item.id}`} className="outline-none hover:text-primary focus-visible:underline">
            {item.name}
          </Link>
        </h4>
        {showCalories && (
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {item.energy !== null ? `${Math.round(item.energy)}` : "—"}
            <span className="ml-0.5 text-xs font-normal text-muted-foreground">kcal</span>
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{item.servingLabel}</p>
      <dl className="mt-2.5 grid grid-cols-3 gap-1 rounded-xl bg-muted/50 px-2.5 py-1.5 text-center text-xs">
        {(
          [
            ["Protein", item.protein],
            ["Carbs", item.carbohydrate],
            ["Fat", item.fat],
          ] as const
        ).map(([label, v]) => (
          <div key={label}>
            <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</dt>
            <dd className="font-medium tabular-nums">{fmtGrams(v)}</dd>
          </div>
        ))}
      </dl>
      <NutrientBars items={item.highlights} className="mt-2.5" />
      <div className="mt-2.5 grid gap-1.5">
        <DietaryChips labels={item.dietaryLabels} max={3} />
        <AllergenChips allergens={item.allergens} />
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <ConfidenceBadge confidence={item.confidence} prefix="Micros" />
        <LogFoodButton
          food={{ id: item.id, name: item.name, servingLabel: item.servingLabel }}
          date={date}
          today={today}
          period={period}
          locationName={locationName}
          signedIn={signedIn}
        />
      </div>
    </article>
  );
}
