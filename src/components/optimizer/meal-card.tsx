"use client";

import { Ellipsis, Lock, LockOpen, MapPin, Plus, RefreshCw, Replace, Search, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { menuChoicesAction } from "@/app/actions/optimizer";
import { Panel } from "@/components/app/page-header";
import { Stepper } from "@/components/common/stepper";
import { ConfidenceBadge } from "@/components/nutrition/badges";
import { NutrientBars } from "@/components/nutrition/nutrient-bars";
import { labelWithGrams, weightText } from "@/lib/nutrition/grams";
import { highlightsFor } from "@/lib/nutrition/highlights";
import type { NutrientId } from "@/lib/nutrition/nutrients";
import { AllergenChips, DietaryChips } from "@/components/nutrition/label-chips";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtKcal, fmtNumber, servingsText } from "@/lib/format";
import { allergenLabel } from "@/lib/menus/labels";
import { MEAL_PERIOD_LABELS } from "@/lib/menus/types";
import { CONFIDENCE_LABELS } from "@/lib/nutrition/provenance";
import { energyTotal, planLines } from "@/lib/optimizer/coverage";
import type { DietFilterInput, MenuChoice, PlanItem, PlanMeal } from "@/lib/optimizer/types";
import { cn } from "@/lib/utils";
import type { PeriodAvailability } from "./shared";

export interface MealCardHandlers {
  onServings: (foodId: string, servings: number) => void;
  onToggleLock: (foodId: string) => void;
  onRemove: (foodId: string) => void;
  onReplaceAuto: (foodId: string) => void;
  onReplaceManual: (foodId: string, choice: MenuChoice) => void;
  onAdd: (choice: MenuChoice) => void;
  onRegenerate: () => void;
  onReplanFromHere: () => void;
}

export function MealCard({
  meal,
  isLast,
  availability,
  universityId,
  date,
  preferences,
  showCalories,
  busy,
  pending,
  handlers,
  references,
}: {
  meal: PlanMeal;
  isLast: boolean;
  availability: PeriodAvailability | undefined;
  universityId: string;
  date: string;
  preferences: DietFilterInput;
  showCalories: boolean;
  busy: boolean;
  /** This card's own regenerate/replace is running. */
  pending: boolean;
  handlers: MealCardHandlers;
  /** The plan's daily reference amounts, for each item's nutrient bars. */
  references: Partial<Record<NutrientId, number>>;
}) {
  const label = MEAL_PERIOD_LABELS[meal.period];
  const [picker, setPicker] = useState<{ mode: "add" } | { mode: "replace"; foodId: string; name: string } | null>(null);
  const kcal = useMemo(() => energyTotal(planLines([meal])), [meal]);
  const headingId = `meal-${meal.period}-heading`;
  const unlocked = meal.items.filter((i) => !i.locked).length;

  return (
    <Panel aria-labelledby={headingId} aria-busy={pending} className={cn("@container grid gap-3 transition-opacity", pending && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={headingId} className="text-lg font-semibold">
            {label}
          </h3>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {meal.locationName && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden="true" />
                {meal.locationName}
              </span>
            )}
            {showCalories && kcal.value !== null && meal.items.length > 0 && <span>≈ {fmtKcal(kcal.value)}</span>}
            {meal.items.length > 0 && (
              <span>
                {meal.items.length} item{meal.items.length === 1 ? "" : "s"}
              </span>
            )}
          </p>
        </div>
        {meal.status === "planned" && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={handlers.onRegenerate}
              disabled={busy || unlocked === 0}
              title={unlocked === 0 ? "Unlock an item to regenerate this meal" : undefined}
            >
              <RefreshCw className={cn(pending && "animate-spin")} aria-hidden="true" />
              New {label.toLowerCase()}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label={`More actions for ${label.toLowerCase()}`} disabled={busy}>
                  <Ellipsis aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem onSelect={() => setPicker({ mode: "add" })}>
                  <Plus aria-hidden="true" /> Add an item from the menu
                </DropdownMenuItem>
                {!isLast && (
                  <DropdownMenuItem onSelect={handlers.onReplanFromHere}>
                    <Sparkles aria-hidden="true" /> Re-plan this and later meals
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {meal.status === "unavailable" || meal.items.length === 0 ? (
        <div className="grid gap-3 rounded-2xl bg-muted/60 p-4 text-sm">
          <p className="text-muted-foreground">{meal.note ?? "Nothing planned for this meal."}</p>
          {availability && availability.locations.some((l) => l.status === "available" && l.itemCount > 0) && (
            <Button variant="outline" size="sm" className="justify-self-start rounded-full" onClick={() => setPicker({ mode: "add" })} disabled={busy}>
              <Plus aria-hidden="true" /> Add an item from the menu
            </Button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-foreground/[0.07]">
          {meal.items.map((item) => (
            <ItemRow
              key={item.foodId}
              item={item}
              showCalories={showCalories}
              busy={busy}
              references={references}
              onServings={(v) => handlers.onServings(item.foodId, v)}
              onToggleLock={() => handlers.onToggleLock(item.foodId)}
              onRemove={() => handlers.onRemove(item.foodId)}
              onReplaceAuto={() => handlers.onReplaceAuto(item.foodId)}
              onReplaceManual={() => setPicker({ mode: "replace", foodId: item.foodId, name: item.name })}
            />
          ))}
        </ul>
      )}

      {picker && (
        <MenuPicker
          open
          onOpenChange={(o) => !o && setPicker(null)}
          title={picker.mode === "add" ? `Add to ${label.toLowerCase()}` : `Replace ${picker.name}`}
          universityId={universityId}
          date={date}
          period={meal.period}
          fixedLocation={meal.items.length ? meal.locationId : null}
          locations={(availability?.locations ?? []).filter((l) => l.status === "available" && l.itemCount > 0)}
          preferences={preferences}
          exclude={meal.items.map((i) => i.foodId)}
          showCalories={showCalories}
          onPick={(choice) => {
            if (picker.mode === "add") handlers.onAdd(choice);
            else handlers.onReplaceManual(picker.foodId, choice);
            setPicker(null);
          }}
        />
      )}
    </Panel>
  );
}

function ItemRow({
  item,
  showCalories,
  busy,
  references,
  onServings,
  onToggleLock,
  onRemove,
  onReplaceAuto,
  onReplaceManual,
}: {
  item: PlanItem;
  showCalories: boolean;
  busy: boolean;
  references: Partial<Record<NutrientId, number>>;
  onServings: (v: number) => void;
  onToggleLock: () => void;
  onRemove: () => void;
  onReplaceAuto: () => void;
  onReplaceManual: () => void;
}) {
  const energy = item.nutrients.energy?.value ?? null;
  const protein = item.nutrients.protein?.value ?? null;
  const official = item.nutrients.energy?.provenance === "official";
  return (
    <li className="grid gap-2 py-3 first:pt-1 last:pb-1 @lg:grid-cols-[minmax(0,1fr)_auto] @lg:items-center @lg:gap-4">
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/foods/${item.foodId}`} className="font-medium hover:underline">
            {item.name}
          </Link>
          {item.locked && (
            <span className="inline-flex h-5 items-center gap-1 rounded-full bg-foreground/[0.07] px-2 text-[11px] font-medium">
              <Lock className="size-3" aria-hidden="true" /> Locked
            </span>
          )}
          <ConfidenceBadge confidence={item.confidence} prefix="Micros" />
        </div>
        <p className="text-xs text-muted-foreground">
          {[
            item.station,
            `${servingsText(item.servings)} × ${item.servingLabel}`,
            weightText(item.servingLabel, item.servingGrams, item.gramsExact, item.servings),
            showCalories && energy !== null ? `${official ? "" : "≈ "}${fmtKcal(energy * item.servings)}` : null,
            protein !== null ? `${fmtNumber(protein * item.servings, protein * item.servings < 10 ? 1 : 0)} g protein` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <NutrientBars items={highlightsFor(item.nutrients, { factor: item.servings, references })} reference="day's reference" className="max-w-sm" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <DietaryChips labels={item.dietaryLabels} max={3} />
          <AllergenChips allergens={item.allergens} />
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Stepper
          value={item.servings}
          onChange={onServings}
          step={item.step}
          min={item.step}
          max={6}
          size="sm"
          label={`Servings of ${item.name}`}
          disabled={busy}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("rounded-full", item.locked && "bg-foreground/[0.07]")}
          onClick={onToggleLock}
          aria-pressed={item.locked}
          aria-label={item.locked ? `Unlock ${item.name}` : `Lock ${item.name} so re-planning keeps it`}
          disabled={busy}
        >
          {item.locked ? <Lock aria-hidden="true" /> : <LockOpen aria-hidden="true" />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label={`More actions for ${item.name}`} disabled={busy}>
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={onReplaceAuto}>
              <Sparkles aria-hidden="true" /> Replace with optimizer&apos;s pick
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onReplaceManual}>
              <Replace aria-hidden="true" /> Choose a replacement…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              <Trash2 aria-hidden="true" /> Remove from plan
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function MenuPicker({
  open,
  onOpenChange,
  title,
  universityId,
  date,
  period,
  fixedLocation,
  locations,
  preferences,
  exclude,
  showCalories,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  universityId: string;
  date: string;
  period: PlanMeal["period"];
  fixedLocation: string | null;
  locations: PeriodAvailability["locations"];
  preferences: DietFilterInput;
  exclude: string[];
  showCalories: boolean;
  onPick: (c: MenuChoice) => void;
}) {
  const [locationId, setLocationId] = useState<string>(fixedLocation ?? locations[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ key: string; items: MenuChoice[] | null; error: string | null }>({ key: "", items: null, error: null });
  const key = `${period}|${locationId}`;

  useEffect(() => {
    if (!locationId) return;
    let cancelled = false;
    menuChoicesAction({ universityId, date, period, locationId, preferences }).then((res) => {
      if (cancelled) return;
      setState(res.ok ? { key, items: res.data, error: null } : { key, items: [], error: res.error });
    });
    return () => {
      cancelled = true;
    };
  }, [universityId, date, period, locationId, preferences, key]);

  const loading = state.key !== key;
  const q = query.trim().toLowerCase();
  const items = (state.items ?? []).filter((c) => !exclude.includes(c.foodId) && (!q || c.name.toLowerCase().includes(q) || (c.station ?? "").toLowerCase().includes(q)));
  const fitting = items.filter((c) => !c.conflicts.length);
  const conflicting = items.filter((c) => c.conflicts.length);
  const locName = locations.find((l) => l.id === locationId)?.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {fixedLocation ? `From ${locName ?? "this market"}'s menu (each meal comes from one market).` : "Choose a market, then an item."} Items you add are
            locked so re-planning keeps them.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this menu" aria-label="Search this menu" className="pl-9" />
          </div>
          {!fixedLocation && locations.length > 1 && (
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger aria-label="Dining market" className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="-mx-2 min-h-40 overflow-y-auto px-2" aria-busy={loading}>
          {loading ? (
            <div className="grid gap-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : state.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : !items.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{q ? "No items match your search." : "No other items on this menu."}</p>
          ) : (
            <div className="grid gap-4">
              <ChoiceList items={fitting} showCalories={showCalories} onPick={onPick} />
              {conflicting.length > 0 && (
                <section className="grid gap-2">
                  <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Outside your filters</h4>
                  <ChoiceList items={conflicting} showCalories={showCalories} onPick={onPick} />
                </section>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChoiceList({ items, showCalories, onPick }: { items: MenuChoice[]; showCalories: boolean; onPick: (c: MenuChoice) => void }) {
  if (!items.length) return null;
  return (
    <ul className="grid gap-1.5">
      {items.map((c) => {
        const kcal = c.nutrients.energy?.value ?? null;
        const protein = c.nutrients.protein?.value ?? null;
        return (
          <li key={c.foodId}>
            <button
              type="button"
              onClick={() => onPick(c)}
              className="grid w-full gap-1 rounded-xl p-3 text-left ring-1 ring-border transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="font-medium">{c.name}</span>
              <span className="text-xs text-muted-foreground">
                {[
                  c.station,
                  labelWithGrams(c.servingLabel, c.servingGrams, c.gramsExact),
                  showCalories && kcal !== null ? fmtKcal(kcal) : null,
                  protein !== null ? `${fmtNumber(protein, protein < 10 ? 1 : 0)} g protein` : null,
                  `vitamins & minerals: ${CONFIDENCE_LABELS[c.confidence].toLowerCase()}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {c.conflicts.length > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-foreground/80">
                  <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                  {c.conflicts.slice(0, 2).join("; ")}
                </span>
              )}
              {c.allergens.length > 0 && (
                <span className="text-[11px] text-foreground/80">Allergens listed: {c.allergens.map(allergenLabel).join(", ")}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
