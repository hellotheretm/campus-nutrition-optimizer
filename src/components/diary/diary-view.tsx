"use client";

import { Copy, EllipsisVertical, ListChecks, LoaderCircle, NotebookPen, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  copyDiaryDayAction,
  deleteDiaryEntryAction,
  logFoodAction,
  markEntriesAction,
  saveMealFromEntriesAction,
  updateDiaryEntryAction,
} from "@/app/actions/diary";
import { EmptyState, Panel } from "@/components/app/page-header";
import { DateNav, isoToLocalDate, localDateToIso } from "@/components/common/date-nav";
import { Stepper } from "@/components/common/stepper";
import { AddFoodDialog } from "@/components/diary/add-food-dialog";
import { DIARY_MEALS, type DiaryMealKey } from "@/components/diary/log-food-dialog";
import { CoverageList } from "@/components/nutrition/coverage-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { addDays, formatDate } from "@/lib/dates";
import { fmtGrams, fmtKcal, servingsText } from "@/lib/format";
import type { NutrientEstimates } from "@/lib/nutrition/estimator";
import { coverageOf, KEY_NUTRIENTS, LIMIT_KEYS, totalsOf } from "@/lib/nutrition/daily";
import type { ReferenceProfile } from "@/lib/nutrition/references";

export interface DiaryEntryView {
  id: string;
  meal: DiaryMealKey;
  status: "logged" | "planned";
  name: string;
  servingLabel: string | null;
  servings: number;
  grams: number | null;
  locationName: string | null;
  source: "dining" | "usda" | "custom";
  foodId: string | null;
  fdcId: number | null;
  /** Snapshot for the logged amount (already multiplied by servings). */
  nutrients: Partial<NutrientEstimates>;
}

interface DiaryViewProps {
  date: string;
  today: string;
  entries: DiaryEntryView[];
  previousCount: number;
  reference: ReferenceProfile;
  showCalories: boolean;
  showPercentages: boolean;
  /** Daily calorie and macro targets from Settings (only those set). */
  targets: Partial<Record<"energy" | "protein" | "fat" | "carbohydrate", number>>;
  university: { id: string; name: string; isDemo: boolean } | null;
}

function guessMeal(date: string, today: string): DiaryMealKey {
  if (date !== today) return "lunch";
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  return h < 10.5 ? "breakfast" : h < 15 ? "lunch" : h < 21 ? "dinner" : "snack";
}

function kcalText(list: DiaryEntryView[]): { text: string; unknown: number } {
  if (!list.length) return { text: "—", unknown: 0 };
  const t = totalsOf(list).energy;
  if (!t || t.known === 0) return { text: "Unknown", unknown: list.length };
  return { text: `≈ ${fmtKcal(t.value)}`, unknown: t.unknown };
}

/** Everything needed to add a deleted entry back (for "Undo"). */
function readdPayload(e: DiaryEntryView, date: string) {
  const base = { servings: e.servings, date, meal: e.meal, status: e.status };
  if (e.source === "dining" && e.foodId) return { kind: "menu", foodId: e.foodId, locationName: e.locationName, ...base };
  if (e.source === "usda" && e.fdcId) return { kind: "usda", fdcId: e.fdcId, grams: e.grams ?? 100, ...base };
  if (e.source === "custom") {
    const nutrients: Record<string, number> = {};
    for (const [k, est] of Object.entries(e.nutrients)) if (est && est.value !== null) nutrients[k] = est.value / e.servings;
    return { kind: "custom", name: e.name, servingLabel: e.servingLabel ?? "1 serving", nutrients, ...base };
  }
  return null;
}

export function DiaryView(props: DiaryViewProps) {
  const { date, today, entries, previousCount, university } = props;
  const [pending, start] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [addMeal, setAddMeal] = useState<DiaryMealKey>("lunch");
  const [copyOpen, setCopyOpen] = useState(false);
  const [includePlanned, setIncludePlanned] = useState(date > today);
  const planned = entries.filter((e) => e.status === "planned");
  const prev = addDays(date, -1);

  function openAdd(meal?: DiaryMealKey) {
    setAddMeal(meal ?? guessMeal(date, today));
    setAddOpen(true);
  }

  function copyPrevious() {
    start(async () => {
      const res = await copyDiaryDayAction(prev, date, { asStatus: date >= today ? "planned" : "logged" });
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data ? `Copied ${res.data} item${res.data === 1 ? "" : "s"} from ${formatDate(prev, "medium")}` : "Nothing to copy");
    });
  }

  function markAllEaten() {
    start(async () => {
      const res = await markEntriesAction(
        planned.map((e) => e.id),
        "logged",
      );
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Marked ${res.data} item${res.data === 1 ? "" : "s"} as eaten`);
    });
  }

  return (
    <div className="grid gap-4">
      <Panel className="glass-strong flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between md:p-4">
        <DateNav date={date} today={today} />
        <div className="flex flex-wrap items-center gap-2">
          {planned.length > 0 && date <= today && (
            <Button variant="outline" size="sm" className="rounded-full" onClick={markAllEaten} disabled={pending}>
              <ListChecks aria-hidden="true" />
              Mark planned as eaten
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="rounded-full" disabled={pending}>
                {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Copy aria-hidden="true" />}
                Copy
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!previousCount} onSelect={copyPrevious}>
                Copy {formatDate(prev, "medium")} into this day
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!entries.length} onSelect={() => setCopyOpen(true)}>
                Copy this day to another date…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" className="rounded-full" onClick={() => openAdd()}>
            <Plus aria-hidden="true" />
            Add food
          </Button>
        </div>
      </Panel>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="grid min-w-0 gap-4">
          {entries.length === 0 && (
            <Panel>
              <EmptyState
                icon={<NotebookPen className="size-5" aria-hidden="true" />}
                title={`Nothing logged for ${formatDate(date, "long")}`}
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button size="sm" className="rounded-full" onClick={() => openAdd()}>
                      <Plus aria-hidden="true" />
                      Add food
                    </Button>
                    {previousCount > 0 && (
                      <Button size="sm" variant="outline" className="rounded-full" onClick={copyPrevious} disabled={pending}>
                        Copy {formatDate(prev, "medium")}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="rounded-full" asChild>
                      <Link href={`/menus?date=${date}`}>Browse menus</Link>
                    </Button>
                  </div>
                }
              >
                Add dishes from the dining-hall menus, a USDA food or your own entry. You can track here without ever using the meal
                optimizer.
              </EmptyState>
            </Panel>
          )}
          {DIARY_MEALS.map((m) => (
            <MealSection
              key={m.key}
              meal={m.key}
              label={m.label}
              entries={entries.filter((e) => e.meal === m.key)}
              date={date}
              showCalories={props.showCalories}
              onAdd={() => openAdd(m.key)}
            />
          ))}
        </div>
        <DaySummary {...props} includePlanned={includePlanned} onIncludePlanned={setIncludePlanned} />
      </div>

      <AddFoodDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        date={date}
        today={today}
        meal={addMeal}
        onMealChange={setAddMeal}
        university={university}
      />
      <CopyToDialog open={copyOpen} onOpenChange={setCopyOpen} date={date} today={today} />
    </div>
  );
}

function MealSection({
  meal,
  label,
  entries,
  date,
  showCalories,
  onAdd,
}: {
  meal: DiaryMealKey;
  label: string;
  entries: DiaryEntryView[];
  date: string;
  showCalories: boolean;
  onAdd: () => void;
}) {
  const kcal = kcalText(entries);
  return (
    <Panel aria-labelledby={`meal-${meal}`} className="@container p-4 md:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`meal-${meal}`} className="font-semibold">
            {label}
          </h2>
          <p className="text-xs text-muted-foreground">
            {entries.length ? `${entries.length} item${entries.length === 1 ? "" : "s"}` : "Nothing yet"}
            {showCalories && entries.length > 0 ? ` · ${kcal.text}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {entries.length > 0 && <SaveMealButton label={label} entries={entries} />}
          <Button variant="ghost" size="sm" className="rounded-full" onClick={onAdd}>
            <Plus aria-hidden="true" />
            Add<span className="sr-only"> to {label}</span>
          </Button>
        </div>
      </div>
      {entries.length > 0 && (
        <ul className="mt-2 divide-y divide-foreground/[0.07]">
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} date={date} showCalories={showCalories} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

const SOURCE_LABEL: Record<DiaryEntryView["source"], string> = {
  dining: "Dining hall",
  usda: "USDA FoodData Central",
  custom: "Your entry",
};

function EntryRow({ entry, date, showCalories }: { entry: DiaryEntryView; date: string; showCalories: boolean }) {
  const [pending, start] = useTransition();
  const [servings, setServings] = useState(entry.servings);
  const [synced, setSynced] = useState(entry.servings);
  const timer = useRef<number | undefined>(undefined);
  // Adopt the server's value after a refresh.
  if (entry.servings !== synced) {
    setSynced(entry.servings);
    setServings(entry.servings);
  }
  const scale = servings / entry.servings;
  const val = (id: "energy" | "protein" | "carbohydrate" | "fat") => {
    const est = entry.nutrients[id];
    return est && est.value !== null ? est.value * scale : null;
  };
  const energy = val("energy");
  const official = entry.nutrients.energy?.provenance === "official";

  function changeServings(v: number) {
    setServings(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      start(async () => {
        const res = await updateDiaryEntryAction(entry.id, { servings: v });
        if (!res.ok) {
          toast.error(res.error);
          setServings(entry.servings);
        }
      });
    }, 450);
  }

  function update(patch: { meal?: DiaryMealKey; status?: "logged" | "planned" }, message: string) {
    start(async () => {
      const res = await updateDiaryEntryAction(entry.id, patch);
      if (!res.ok) return void toast.error(res.error);
      toast.success(message);
    });
  }

  function remove() {
    start(async () => {
      const res = await deleteDiaryEntryAction(entry.id);
      if (!res.ok) return void toast.error(res.error);
      const payload = readdPayload(entry, date);
      toast.success(`Removed ${entry.name}`, {
        action: payload
          ? {
              label: "Undo",
              onClick: () => {
                void logFoodAction(payload, { refresh: true }).then((r) => {
                  if (!r.ok) toast.error(r.error);
                });
              },
            }
          : undefined,
      });
    });
  }

  return (
    <li className="flex flex-col gap-2 py-3 @md:flex-row @md:items-center @md:gap-3" aria-busy={pending}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {entry.foodId ? (
            <Link href={`/foods/${entry.foodId}`} className="font-medium underline-offset-4 hover:underline">
              {entry.name}
            </Link>
          ) : (
            <span className="font-medium">{entry.name}</span>
          )}
          {entry.status === "planned" && (
            <Badge variant="outline" className="rounded-full">
              Planned
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {servingsText(servings)} × {entry.servingLabel ?? "serving"} · {entry.locationName ?? SOURCE_LABEL[entry.source]}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {showCalories && <>{energy === null ? "kcal unknown" : `${official ? "" : "≈ "}${fmtKcal(energy)}`} · </>}P {fmtGrams(val("protein"))} · C{" "}
          {fmtGrams(val("carbohydrate"))} · F {fmtGrams(val("fat"))}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {entry.status === "planned" && (
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => update({ status: "logged" }, "Marked as eaten")} disabled={pending}>
            Mark eaten<span className="sr-only">: {entry.name}</span>
          </Button>
        )}
        <Stepper size="sm" value={servings} onChange={changeServings} min={0.5} max={20} label={`Servings of ${entry.name}`} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label={`More actions for ${entry.name}`}>
              <EllipsisVertical aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {entry.status === "logged" ? (
              <DropdownMenuItem onSelect={() => update({ status: "planned" }, "Moved back to planned")}>Mark as planned</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => update({ status: "logged" }, "Marked as eaten")}>Mark as eaten</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Move to</DropdownMenuLabel>
            {DIARY_MEALS.filter((m) => m.key !== entry.meal).map((m) => (
              <DropdownMenuItem key={m.key} onSelect={() => update({ meal: m.key }, `Moved to ${m.label.toLowerCase()}`)}>
                {m.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={remove} className="text-destructive focus:text-destructive">
              <Trash2 aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function SaveMealButton({ label, entries }: { label: string; entries: DiaryEntryView[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`My ${label.toLowerCase()}`);
  const [pending, start] = useTransition();
  const customCount = entries.filter((e) => e.source === "custom").length;

  function save() {
    start(async () => {
      const res = await saveMealFromEntriesAction(
        name,
        entries.map((e) => e.id),
      );
      if (!res.ok) return void toast.error(res.error);
      setOpen(false);
      toast.success(`Saved “${name.trim()}”`, {
        description: res.data.skipped
          ? `${res.data.skipped} custom item${res.data.skipped === 1 ? " was" : "s were"} left out.`
          : "Find it under Add food → Meals.",
      });
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setOpen(true)}>
        <Save aria-hidden="true" />
        <span className="hidden sm:inline">Save meal</span>
        <span className="sr-only sm:hidden">Save {label} as a meal</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save {label.toLowerCase()} as a meal</DialogTitle>
            <DialogDescription>
              Saved meals can be added to any day in one step.
              {customCount > 0 ? " Custom entries aren’t included because they have no shared food record." : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`save-meal-${label}`}>Name</Label>
            <Input id={`save-meal-${label}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <DialogFooter>
            <Button onClick={save} disabled={pending || !name.trim()}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Save meal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CopyToDialog({ open, onOpenChange, date, today }: { open: boolean; onOpenChange: (o: boolean) => void; date: string; today: string }) {
  const router = useRouter();
  const [target, setTarget] = useState<Date | undefined>(isoToLocalDate(addDays(date, 1)));
  const [pending, start] = useTransition();
  const to = target ? localDateToIso(target) : null;

  function copy() {
    if (!to) return;
    start(async () => {
      const res = await copyDiaryDayAction(date, to, { asStatus: to >= today ? "planned" : "logged" });
      if (!res.ok) return void toast.error(res.error);
      onOpenChange(false);
      toast.success(`Copied ${res.data} item${res.data === 1 ? "" : "s"} to ${formatDate(to, "medium")}`, {
        action: { label: "Open", onClick: () => router.push(`/diary?date=${to}`) },
      });
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Copy this day</DialogTitle>
          <DialogDescription>
            Copies every item from {formatDate(date, "long")}. Items copied to today or a later date are added as planned.
          </DialogDescription>
        </DialogHeader>
        <Calendar mode="single" selected={target} onSelect={setTarget} className="mx-auto rounded-2xl" />
        <DialogFooter>
          <Button onClick={copy} disabled={!to || to === date || pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {to && to !== date ? `Copy to ${formatDate(to, "medium")}` : "Choose a date"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DaySummary({
  entries,
  reference,
  showCalories,
  showPercentages,
  targets,
  includePlanned,
  onIncludePlanned,
}: DiaryViewProps & { includePlanned: boolean; onIncludePlanned: (v: boolean) => void }) {
  const logged = entries.filter((e) => e.status === "logged");
  const planned = entries.filter((e) => e.status === "planned");
  const counted = includePlanned ? entries : logged;
  const totals = totalsOf(counted);
  const eaten = kcalText(logged);
  const plannedKcal = kcalText(planned);
  const macro = (id: "protein" | "carbohydrate" | "fat") => {
    const t = totals[id];
    return t && t.known > 0 ? `≈ ${fmtGrams(t.value)}` : "—";
  };
  const goals = coverageOf(
    totals,
    reference,
    KEY_NUTRIENTS.filter((id) => id !== "protein"),
  );
  const limits = coverageOf(totals, reference, LIMIT_KEYS, "limit");

  return (
    <Panel aria-labelledby="day-summary" className="grid gap-5 xl:sticky xl:top-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="day-summary" className="font-semibold">
          Day summary
        </h2>
        {planned.length > 0 && (
          <div className="flex items-center gap-2">
            <Switch id="include-planned" checked={includePlanned} onCheckedChange={onIncludePlanned} />
            <Label htmlFor="include-planned" className="text-xs font-normal text-muted-foreground">
              Include planned
            </Label>
          </div>
        )}
      </div>

      {showCalories && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">Eaten</p>
            <p className="font-semibold tabular-nums">{eaten.text}</p>
          </div>
          <div className="rounded-2xl bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">Planned</p>
            <p className="font-semibold tabular-nums">{plannedKcal.text}</p>
          </div>
          {eaten.unknown + plannedKcal.unknown > 0 && (
            <p className="col-span-2 text-[11px] text-muted-foreground">
              {eaten.unknown + plannedKcal.unknown} item(s) have no calorie data and aren’t counted.
            </p>
          )}
          {targets.energy !== undefined && (
            <p className="col-span-2 text-xs text-muted-foreground">
              Your calorie target: {Math.round(targets.energy).toLocaleString("en-US")} kcal (a number you set in Settings).
            </p>
          )}
        </div>
      )}

      <dl className="grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["protein", "Protein"],
            ["carbohydrate", "Carbs"],
            ["fat", "Fat"],
          ] as const
        ).map(([id, label]) => (
          <div key={id} className="rounded-2xl bg-muted/60 p-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm font-semibold tabular-nums">{macro(id)}</dd>
            {targets[id] !== undefined && <dd className="text-[11px] text-muted-foreground">of {Math.round(targets[id]!)} g</dd>}
          </div>
        ))}
      </dl>

      {counted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {entries.length ? "Only planned items so far. Turn on “Include planned” to preview them." : "Add a food to see vitamins and minerals."}
        </p>
      ) : (
        <>
          <section aria-label="Vitamins, minerals and fiber" className="grid gap-2">
            <h3 className="text-sm font-semibold">Vitamins, minerals and fiber</h3>
            <CoverageList items={goals} showPercent={showPercentages} className="sm:grid-cols-2 sm:gap-x-6 xl:grid-cols-1" />
          </section>
          <section aria-label="Limit benchmarks" className="grid gap-2">
            <h3 className="text-sm font-semibold">Nutrients to keep in moderation</h3>
            <CoverageList items={limits} showPercent={showPercentages} className="sm:grid-cols-2 sm:gap-x-6 xl:grid-cols-1" />
          </section>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Percentages use {reference.shortLabel}: general benchmarks for healthy people, not personal targets, and one day is never a
        deficiency. Each entry keeps the nutrition snapshot from when you added it.
      </p>
    </Panel>
  );
}
