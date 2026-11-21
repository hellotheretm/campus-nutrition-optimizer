"use client";

import { BookmarkCheck, ChevronDown, Columns3, Loader2, LockOpen, NotebookPen, Save, Shuffle, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { addPlanToDiaryAction, compareStrategiesAction, generatePlanAction, savePlanAction } from "@/app/actions/optimizer";
import { Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatDate } from "@/lib/dates";
import { MEAL_PERIOD_LABELS } from "@/lib/menus/types";
import { explainItems } from "@/lib/optimizer/coverage";
import { hasMacroTargets, resolveMacroTargets, STRATEGIES, type MenuChoice, type PlanMeal, type PlanPeriod, type PlanRequest, type PlanRequestInput, type PlanResult, type TargetSummary } from "@/lib/optimizer/types";
import { MealCard } from "./meal-card";
import { CompareDialog, DiffDialog, SaveDialog, type StrategyOption } from "./plan-dialogs";
import { PlanInputs } from "./plan-inputs";
import { ModelPanel, PlanTotals } from "./plan-panels";
import {
  applyStored,
  clearStoredSettings,
  goalsMet,
  initialInputs,
  inputsFromRequest,
  itemFromChoice,
  liveTotals,
  loadStoredSettings,
  lockedOf,
  periodIndex,
  selectionOf,
  servable,
  storeSettings,
  type Inputs,
  type OptimizerDefaults,
  type OptimizerUniversity,
  type PeriodAvailability,
  type SavedPlanView,
  type Working,
} from "./shared";

const key = (period: string, foodId: string) => `${period}:${foodId}`;

/** Recomputes each item's "why" after edits (pure; returns copies). */
function withWhy(meals: PlanMeal[], targets: TargetSummary[]): PlanMeal[] {
  const copy = meals.map((m) => ({ ...m, items: m.items.map((i) => ({ ...i, why: [...i.why] })) }));
  explainItems(copy, targets);
  return copy;
}

/** Keeps the user's own lock choices when items come back from a solve where others were held in place. */
function restoreLocks(meals: PlanMeal[], userLocked: Set<string>): PlanMeal[] {
  return meals.map((m) => ({ ...m, items: m.items.map((i) => ({ ...i, locked: userLocked.has(key(m.period, i.foodId)) })) }));
}

const userLocks = (meals: PlanMeal[]) => new Set(lockedOf(meals).map((l) => key(l.period, l.foodId)));
const failed = (r: PlanResult) => r.status === "infeasible" || r.status === "no_menu" || r.status === "error";

export function OptimizerApp({
  university,
  universities,
  date,
  today,
  minDate,
  maxDate,
  availability,
  defaults,
  signedIn,
  showCalories,
  showPercentages,
  saved,
}: {
  university: OptimizerUniversity;
  universities: { id: string; slug: string; name: string; isDemo: boolean }[];
  date: string;
  today: string;
  minDate: string;
  maxDate: string;
  availability: PeriodAvailability[];
  defaults: OptimizerDefaults;
  signedIn: boolean;
  showCalories: boolean;
  showPercentages: boolean;
  saved: SavedPlanView | null;
}) {
  const router = useRouter();
  const [inputs, setInputs] = useState<Inputs>(() => (saved ? inputsFromRequest(saved.request, availability) : initialInputs(defaults, availability)));
  const [working, setWorking] = useState<Working | null>(() =>
    saved
      ? {
          request: saved.request,
          result: saved.result,
          meals: saved.result.meals,
          edited: Boolean(saved.result.edited),
          seen: saved.result.signature ? [saved.result.signature] : [],
          planId: saved.id,
          savedName: saved.name,
        }
      : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ title: string; description: string; before: Working; next: Working } | null>(null);
  const [compare, setCompare] = useState<{ options: StrategyOption[] | null } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const restored = useRef(Boolean(saved));

  // Settings remembered in this browser (guests: across visits; signed in: this tab).
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const stored = loadStoredSettings(!signedIn);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from browser storage after hydration
    if (stored) setInputs((prev) => applyStored(prev, stored));
  }, [signedIn]);
  useEffect(() => {
    if (restored.current) storeSettings(inputs, !signedIn);
  }, [inputs, signedIn]);

  const lockedCount = working ? lockedOf(working.meals).length : 0;
  const itemCount = working ? working.meals.reduce((n, m) => n + m.items.length, 0) : 0;
  const isBusy = busy !== null;

  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  function announce(text: string) {
    setAnnouncement(text);
  }

  function validateGoals(): string | null {
    return hasMacroTargets(inputs.targets) ? resolveMacroTargets(inputs.targets).error : null;
  }

  function buildRequest(): PlanRequestInput {
    const meals = availability
      .filter((a) => inputs.meals[a.period].enabled && servable(a).length > 0)
      .map((a) => ({ period: a.period, locationIds: inputs.meals[a.period].locationIds.filter((id) => servable(a).some((l) => l.id === id)) }));
    const locks = working && working.request.date === date ? lockedOf(working.meals).filter((l) => meals.some((m) => m.period === l.period)) : [];
    return {
      universityId: university.id,
      date,
      meals,
      strategy: inputs.strategy,
      reference: inputs.reference,
      macroTargets: hasMacroTargets(inputs.targets) ? inputs.targets : null,
      focus: inputs.focus,
      preferences: inputs.preferences,
      maxItemsPerMeal: inputs.maxItemsPerMeal,
      maxServingsPerItem: inputs.maxServingsPerItem,
      locks,
    };
  }

  function fresh(request: PlanRequest, result: PlanResult, prev?: Working | null): Working {
    const locked = prev ? userLocks(prev.meals) : new Set(request.locks.map((l) => key(l.period, l.foodId)));
    return {
      request,
      result,
      meals: withWhy(restoreLocks(result.meals, locked), result.targets),
      edited: false,
      seen: [...(prev?.seen ?? []), result.signature].filter(Boolean).slice(-10),
      planId: null,
      savedName: null,
    };
  }

  function describe(w: Working) {
    const meals = w.meals.filter((m) => m.items.length);
    const n = meals.reduce((s, m) => s + m.items.length, 0);
    const met = goalsMet(liveTotals(w.meals, w.result).coverage);
    return `Plan ready: ${meals.length} meal${meals.length === 1 ? "" : "s"}, ${n} item${n === 1 ? "" : "s"}, meeting ${met.met} of ${met.total} references.`;
  }

  function generate() {
    const problem = validateGoals();
    if (problem) return void toast.error(problem);
    const request = buildRequest();
    if (!request.meals.length) return void toast.error("Choose at least one meal that has a menu.");
    void run("generate", async () => {
      const res = await generatePlanAction(request);
      if (!res.ok) return void toast.error(res.error);
      const next = fresh(res.data.request, res.data.result, null);
      setWorking(next);
      announce(failed(res.data.result) ? "The optimizer couldn't build a plan. See the explanation." : describe(next));
      requestAnimationFrame(() => headingRef.current?.focus());
    });
  }

  /** Applies a change to the plan on screen; edits mark the plan as edited and unsaved. */
  function edit(fn: (meals: PlanMeal[]) => PlanMeal[], undoLabel?: string) {
    if (!working) return;
    const prev = working;
    const meals = withWhy(fn(prev.meals), prev.result.targets);
    setWorking({ ...prev, meals, edited: true, planId: null });
    if (undoLabel) toast(undoLabel, { action: { label: "Undo", onClick: () => setWorking(prev) } });
  }

  const mapItem = (period: string, foodId: string, f: (i: PlanMeal["items"][number]) => PlanMeal["items"][number]) => (meals: PlanMeal[]) =>
    meals.map((m) => (m.period === period ? { ...m, items: m.items.map((i) => (i.foodId === foodId ? f(i) : i)) } : m));

  function regenerateMeal(period: PlanPeriod) {
    if (!working) return;
    const w = working;
    const meal = w.meals.find((m) => m.period === period)!;
    const label = MEAL_PERIOD_LABELS[period].toLowerCase();
    const lockedIds = new Set(meal.items.filter((i) => i.locked).map((i) => i.foodId));
    const current = meal.items.filter((i) => !i.locked).map((i) => i.foodId);
    // Versions of this meal shown before, so repeated presses don't cycle back.
    const history = (w.mealHistory?.[period] ?? []).slice(-3).map((ids) => ids.filter((id) => !lockedIds.has(id)));
    const base: PlanRequestInput = {
      ...w.request,
      locks: lockedOf(w.meals, (m, i) => m.period !== period || i.locked),
      avoidSignatures: [],
    };
    const freshOf = (lists: string[][]) => lists.filter((ids) => ids.length).map((foodIds) => ({ period, foodIds }));
    void run(`meal:${period}`, async () => {
      let res = await generatePlanAction({ ...base, freshMeals: freshOf([current, ...history]) });
      const empty = (x: typeof res) => x.ok && (failed(x.data.result) || !x.data.result.meals.find((m) => m.period === period)?.items.length);
      if (empty(res) && history.length) res = await generatePlanAction({ ...base, freshMeals: freshOf([current]) });
      if (!res.ok) return void toast.error(res.error);
      const r = res.data.result;
      const newMeal = r.meals.find((m) => m.period === period);
      if (failed(r) || !newMeal || !newMeal.items.length) {
        return void toast.error(r.infeasibility?.reasons[0] ?? `No different ${label} fits your settings. Try unlocking items or allowing more markets.`);
      }
      const locked = userLocks(w.meals);
      const meals = w.meals.map((m) => (m.period === period ? restoreLocks([newMeal], locked)[0] : m));
      setWorking({
        ...w,
        result: r,
        meals: withWhy(meals, r.targets),
        seen: [...w.seen, r.signature].slice(-10),
        planId: null,
        mealHistory: { ...w.mealHistory, [period]: [...(w.mealHistory?.[period] ?? []), meal.items.map((i) => i.foodId)].slice(-4) },
      });
      announce(`New ${label} ready.`);
      toast.success(`New ${label} ready`, { action: { label: "Undo", onClick: () => setWorking(w) } });
    });
  }

  function replaceAuto(period: PlanPeriod, foodId: string) {
    if (!working) return;
    const w = working;
    const old = w.meals.find((m) => m.period === period)?.items.find((i) => i.foodId === foodId);
    const excluded = [...w.request.excluded.filter((e) => !(e.period === period && e.foodId === foodId)), { period, foodId }];
    const request: PlanRequestInput = {
      ...w.request,
      locks: lockedOf(w.meals, (m, i) => !(m.period === period && i.foodId === foodId)),
      excluded,
      freshMeals: [],
      avoidSignatures: [],
    };
    void run(`meal:${period}`, async () => {
      const res = await generatePlanAction(request);
      if (!res.ok) return void toast.error(res.error);
      const r = res.data.result;
      if (failed(r)) return void toast.error(r.infeasibility?.reasons[0] ?? "Couldn't find a replacement.");
      const locked = userLocks(w.meals);
      const newMeal = r.meals.find((m) => m.period === period);
      const meals = w.meals.map((m) => (m.period === period && newMeal ? restoreLocks([newMeal], locked)[0] : m));
      const added = newMeal?.items.filter((i) => !w.meals.find((m) => m.period === period)?.items.some((x) => x.foodId === i.foodId)) ?? [];
      setWorking({ ...w, request: { ...w.request, excluded }, result: r, meals: withWhy(meals, r.targets), edited: true, planId: null });
      const msg = added.length ? `Replaced ${old?.name ?? "item"} with ${added.map((a) => a.name).join(" and ")}` : `Removed ${old?.name ?? "item"}; nothing else on the menu improved the plan`;
      announce(msg);
      toast.success(msg, { action: { label: "Undo", onClick: () => setWorking(w) } });
    });
  }

  function replan(from: PlanPeriod | null) {
    if (!working) return;
    const w = working;
    const locks = from ? lockedOf(w.meals, (m, i) => periodIndex(m.period) < periodIndex(from) || i.locked) : lockedOf(w.meals);
    const request: PlanRequestInput = { ...w.request, locks, freshMeals: [], avoidSignatures: [] };
    void run(from ? `meal:${from}` : "replan", async () => {
      const res = await generatePlanAction(request);
      if (!res.ok) return void toast.error(res.error);
      const r = res.data.result;
      if (failed(r)) return void toast.error(r.infeasibility?.reasons[0] ?? "Couldn't re-plan with these locks.");
      const next: Working = {
        ...w,
        result: r,
        meals: withWhy(restoreLocks(r.meals, userLocks(w.meals)), r.targets),
        seen: [...w.seen, r.signature].slice(-10),
        planId: null,
      };
      setDiff({
        title: from ? `Re-plan ${MEAL_PERIOD_LABELS[from].toLowerCase()} and later` : "Re-plan around your changes",
        description: from
          ? "Earlier meals and locked items stay as they are; the rest of the day is optimized again. Review the changes before applying them."
          : "Locked items (including ones you added or resized) stay; everything else is optimized again. Review the changes before applying them.",
        before: w,
        next,
      });
    });
  }

  function anotherOption() {
    if (!working) return;
    const w = working;
    const locks = lockedOf(w.meals);
    if (locks.length >= itemCount) return void toast("Everything is locked. Unlock an item to see another option.");
    const request: PlanRequestInput = { ...w.request, locks, avoidSignatures: w.seen.slice(-10), freshMeals: [] };
    void run("another", async () => {
      const res = await generatePlanAction(request);
      if (!res.ok) return void toast.error(res.error);
      const r = res.data.result;
      if (failed(r)) return void toast.error("No other combination fits these settings. Try unlocking items or allowing more markets.");
      const next = { ...fresh(res.data.request, r, w), request: { ...res.data.request, avoidSignatures: [] } };
      setWorking(next);
      announce(describe(next));
      toast.success("Here's another option", { action: { label: "Undo", onClick: () => setWorking(w) } });
    });
  }

  function compareStrategies() {
    if (!working) return;
    const w = working;
    setCompare({ options: null });
    void run("compare", async () => {
      const res = await compareStrategiesAction({ ...w.request, locks: lockedOf(w.meals), avoidSignatures: [], freshMeals: [] });
      if (!res.ok) {
        setCompare(null);
        return void toast.error(res.error);
      }
      setCompare({ options: res.data });
    });
  }

  function applyOption(o: StrategyOption) {
    if (!working) return;
    const w = working;
    setWorking(fresh(o.request, o.result, w));
    setInputs((p) => ({ ...p, strategy: o.strategy }));
    setCompare(null);
    toast.success(`Switched to ${STRATEGIES[o.strategy].label}`, { action: { label: "Undo", onClick: () => setWorking(w) } });
  }

  async function save(name: string): Promise<boolean> {
    if (!working) return false;
    const w = working;
    const m = w.result.model;
    const res = await savePlanAction({
      request: { ...w.request, locks: lockedOf(w.meals), avoidSignatures: [], freshMeals: [] },
      meals: selectionOf(w.meals),
      stats: { candidates: m.candidates, variables: m.variables, constraints: m.constraints, solveMs: m.solveMs, objective: m.objective },
      edited: w.edited,
      name: name || undefined,
    });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setWorking((cur) => (cur === w ? { ...w, planId: res.data.id, savedName: name || null } : cur));
    toast.success("Plan saved", { action: { label: "History", onClick: () => router.push("/history") } });
    return true;
  }

  function addToDiary(status: "planned" | "logged") {
    if (!working) return;
    const w = working;
    void run("diary", async () => {
      const res = await addPlanToDiaryAction({ universityId: university.id, date, meals: selectionOf(w.meals), status, planId: w.planId });
      if (!res.ok) return void toast.error(res.error);
      const href = date === today ? "/diary" : `/diary?date=${date}`;
      toast.success(`Added ${res.data} item${res.data === 1 ? "" : "s"} to your diary ${status === "planned" ? "as planned" : "as eaten"}`, {
        action: { label: "Open diary", onClick: () => router.push(href) },
      });
    });
  }

  function resetSettings() {
    clearStoredSettings(!signedIn);
    setInputs(initialInputs(defaults, availability));
    toast("Settings reset to your defaults");
  }

  // Daily reference amounts behind each item's nutrient bars (the plan's own references).
  const highlightRefs = useMemo(
    () => Object.fromEntries((working?.result.targets ?? []).filter((t) => t.kind === "goal" && t.amount).map((t) => [t.id, t.amount as number])),
    [working?.result.targets],
  );
  const orderedMeals = useMemo(() => (working ? [...working.meals].sort((a, b) => periodIndex(a.period) - periodIndex(b.period)) : []), [working]);
  const planned = orderedMeals.filter((m) => m.status === "planned" && m.items.length);
  const lastPlanned = planned.at(-1)?.period;

  return (
    <div className="grid grid-cols-1 gap-6">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <PlanInputs
        inputs={inputs}
        setInputs={setInputs}
        availability={availability}
        university={university}
        universities={universities}
        date={date}
        today={today}
        minDate={minDate}
        maxDate={maxDate}
        busy={busy === "generate"}
        lockedCount={lockedCount}
        hasPlan={Boolean(working)}
        signedIn={signedIn}
        onGenerate={generate}
        onReset={resetSettings}
      />

      {!working ? (
        busy === "generate" ? (
          <Panel className="flex items-center gap-3 text-sm text-muted-foreground" aria-busy="true">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Building your plan from {formatDate(date, "long")}&apos;s menus…
          </Panel>
        ) : (
          <Intro signedIn={signedIn} />
        )
      ) : (
        <section aria-labelledby="plan-heading" className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
          <div className={`grid min-w-0 gap-4 transition-opacity ${busy === "generate" || busy === "another" || busy === "replan" ? "opacity-60" : ""}`}>
            <Panel className="grid gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="plan-heading" ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
                    {working.savedName || `Your plan for ${formatDate(working.request.date, "long")}`}
                  </h2>
                  <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
                    <Tag>{STRATEGIES[working.request.strategy].label}</Tag>
                    {working.result.macroTargets?.length ? <Tag>Your targets ±{working.request.macroTargets?.tolerancePct ?? 5}%</Tag> : null}
                    {working.edited && <Tag>Edited by you</Tag>}
                    {working.planId && (
                      <Tag>
                        <BookmarkCheck className="size-3" aria-hidden="true" /> Saved
                      </Tag>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {signedIn ? (
                    <>
                      <Button variant="outline" size="sm" className="rounded-full" onClick={() => setSaveOpen(true)} disabled={isBusy || !itemCount || Boolean(working.planId)}>
                        <Save aria-hidden="true" /> {working.planId ? "Saved" : "Save plan"}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" className="rounded-full" disabled={isBusy || !itemCount}>
                            {busy === "diary" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <NotebookPen aria-hidden="true" />}
                            Add to diary
                            <ChevronDown aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem onSelect={() => addToDiary("planned")}>As planned (not eaten yet)</DropdownMenuItem>
                          {date <= today && <DropdownMenuItem onSelect={() => addToDiary("logged")}>As eaten</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  ) : (
                    <Button asChild variant="outline" size="sm" className="rounded-full">
                      <Link href={`/login?next=${encodeURIComponent("/optimizer")}`}>Sign in to save or log this plan</Link>
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-foreground/[0.07] pt-4">
                <Button variant="secondary" size="sm" className="rounded-full" onClick={anotherOption} disabled={isBusy || !itemCount}>
                  {busy === "another" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Shuffle aria-hidden="true" />}
                  Another option
                </Button>
                <Button variant="secondary" size="sm" className="rounded-full" onClick={compareStrategies} disabled={isBusy || !itemCount}>
                  {busy === "compare" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Columns3 aria-hidden="true" />}
                  Compare strategies
                </Button>
                <Button variant="secondary" size="sm" className="rounded-full" onClick={() => replan(null)} disabled={isBusy || !lockedCount || lockedCount >= itemCount}>
                  {busy === "replan" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                  Re-plan around my changes
                </Button>
                {lockedCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full"
                    disabled={isBusy}
                    onClick={() => edit((meals) => meals.map((m) => ({ ...m, items: m.items.map((i) => ({ ...i, locked: false })) })), "Unlocked all items")}
                  >
                    <LockOpen aria-hidden="true" /> Unlock all ({lockedCount})
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Lock items to keep them when re-planning. Items you resize, swap in or add are locked automatically.
              </p>
            </Panel>

            {failed(working.result) && working.result.infeasibility && (
              <Panel role="alert" className="grid gap-2 border-l-4 border-l-primary">
                <p className="flex items-center gap-2 font-semibold">
                  <TriangleAlert className="size-4 text-primary" aria-hidden="true" />
                  {itemCount ? "This plan couldn't meet every hard limit" : "The optimizer couldn't build a plan"}
                </p>
                <ul className="grid list-disc gap-1 pl-5 text-sm">
                  {working.result.infeasibility.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                {working.result.infeasibility.suggestions.length > 0 && (
                  <>
                    <p className="text-sm font-medium">What you can try</p>
                    <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
                      {working.result.infeasibility.suggestions.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </>
                )}
              </Panel>
            )}

            {working.result.warnings.length > 0 && (
              <ul className="grid gap-1 rounded-2xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
                {working.result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}

            {orderedMeals.map((meal) => (
              <MealCard
                key={meal.period}
                meal={meal}
                isLast={meal.period === lastPlanned}
                availability={availability.find((a) => a.period === meal.period)}
                universityId={university.id}
                date={working.request.date}
                preferences={working.request.preferences}
                showCalories={showCalories && working.result.energy.shown}
                references={highlightRefs}
                busy={isBusy}
                pending={busy === `meal:${meal.period}`}
                handlers={{
                  onServings: (foodId, servings) => edit(mapItem(meal.period, foodId, (i) => ({ ...i, servings, locked: true }))),
                  onToggleLock: (foodId) => edit(mapItem(meal.period, foodId, (i) => ({ ...i, locked: !i.locked }))),
                  onRemove: (foodId) => {
                    const name = meal.items.find((i) => i.foodId === foodId)?.name ?? "Item";
                    edit((meals) => meals.map((m) => (m.period === meal.period ? { ...m, items: m.items.filter((i) => i.foodId !== foodId) } : m)), `Removed ${name}`);
                  },
                  onReplaceAuto: (foodId) => replaceAuto(meal.period as PlanPeriod, foodId),
                  onReplaceManual: (foodId, choice: MenuChoice) =>
                    edit(
                      (meals) =>
                        meals.map((m) =>
                          m.period === meal.period
                            ? { ...m, items: m.items.map((i) => (i.foodId === foodId ? itemFromChoice(choice, 1, Math.max(working.request.maxServingsPerItem, 1)) : i)) }
                            : m,
                        ),
                      `Swapped in ${choice.name}`,
                    ),
                  onAdd: (choice: MenuChoice) =>
                    edit(
                      (meals) =>
                        meals.map((m) =>
                          m.period === meal.period
                            ? {
                                ...m,
                                status: "planned",
                                note: null,
                                locationId: m.items.length ? m.locationId : choice.locationId,
                                locationName: m.items.length ? m.locationName : choice.locationName,
                                items: [...m.items, itemFromChoice(choice, 1, Math.max(working.request.maxServingsPerItem, 1))],
                              }
                            : m,
                        ),
                      `Added ${choice.name}`,
                    ),
                  onRegenerate: () => regenerateMeal(meal.period as PlanPeriod),
                  onReplanFromHere: () => replan(meal.period as PlanPeriod),
                }}
              />
            ))}
          </div>

          <aside className="grid gap-4 xl:sticky xl:top-6" aria-label="Plan totals and method">
            <PlanTotals meals={working.meals} result={working.result} showCalories={showCalories} showPercentages={showPercentages} />
            <ModelPanel result={working.result} edited={working.edited} />
          </aside>
        </section>
      )}

      {diff && (
        <DiffDialog
          open
          onOpenChange={(o) => !o && setDiff(null)}
          title={diff.title}
          description={diff.description}
          before={diff.before}
          next={diff.next}
          showCalories={showCalories}
          onAccept={() => {
            const prev = diff.before;
            setWorking(diff.next);
            setDiff(null);
            announce(describe(diff.next));
            toast.success("Plan updated", { action: { label: "Undo", onClick: () => setWorking(prev) } });
          }}
        />
      )}
      {compare && working && (
        <CompareDialog
          open
          onOpenChange={(o) => !o && setCompare(null)}
          current={working}
          options={compare.options}
          showCalories={showCalories}
          onUse={applyOption}
        />
      )}
      {saveOpen && working && (
        <SaveDialog open onOpenChange={setSaveOpen} defaultName={`${formatDate(working.request.date, "medium")} plan`} onSave={save} />
      )}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-6 items-center gap-1 rounded-full bg-foreground/[0.06] px-2.5 font-medium">{children}</span>;
}

function Intro({ signedIn }: { signedIn: boolean }) {
  const steps = [
    ["Choose meals and markets", "Pick which meals to plan. Leave markets open to let the optimizer choose, or pick the ones you'll be near."],
    ["Get an optimized day", "A mixed-integer program chooses items and portions that cover your references, counting uncertain estimates conservatively."],
    ["Make it yours", "Change servings, lock favorites, swap or add items, and re-plan the rest. Every number updates as you go."],
  ];
  return (
    <Panel aria-labelledby="intro-heading" className="grid gap-5">
      <div>
        <h2 id="intro-heading" className="font-semibold">
          Your plan will appear here
        </h2>
        <p className="text-sm text-muted-foreground">
          Suggestions built only from published menus. They&apos;re ideas for balanced eating, not medical advice.
          {!signedIn && " Sign in if you'd like to save plans or add them to a food diary."}
        </p>
      </div>
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map(([title, body], i) => (
          <li key={title} className="grid gap-1 rounded-2xl bg-muted/50 p-4">
            <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
            <span className="font-medium">{title}</span>
            <span className="text-sm text-muted-foreground">{body}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
