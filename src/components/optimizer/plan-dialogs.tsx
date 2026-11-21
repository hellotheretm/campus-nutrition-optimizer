"use client";

import { ArrowRight, Loader2, Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtKcal, fmtPercent, servingsText } from "@/lib/format";
import { MEAL_PERIOD_LABELS } from "@/lib/menus/types";
import { nutrientName } from "@/lib/optimizer/targets";
import { STRATEGIES, type PlanMeal, type PlanRequest, type PlanResult, type StrategyKey } from "@/lib/optimizer/types";
import { cn } from "@/lib/utils";
import { goalsMet, liveTotals, periodIndex, type Working } from "./shared";

interface MealDiff {
  period: PlanMeal["period"];
  location: { before: string | null; after: string | null };
  added: { name: string; servings: number }[];
  removed: { name: string; servings: number }[];
  changed: { name: string; before: number; after: number }[];
  kept: number;
}

function diffMeals(before: PlanMeal[], after: PlanMeal[]): MealDiff[] {
  const periods = [...new Set([...before, ...after].map((m) => m.period))].sort((a, b) => periodIndex(a) - periodIndex(b));
  return periods.map((p) => {
    const b = before.find((m) => m.period === p);
    const a = after.find((m) => m.period === p);
    const bi = b?.items ?? [];
    const ai = a?.items ?? [];
    return {
      period: p,
      location: { before: bi.length ? (b?.locationName ?? null) : null, after: ai.length ? (a?.locationName ?? null) : null },
      added: ai.filter((x) => !bi.some((y) => y.foodId === x.foodId)).map((x) => ({ name: x.name, servings: x.servings })),
      removed: bi.filter((x) => !ai.some((y) => y.foodId === x.foodId)).map((x) => ({ name: x.name, servings: x.servings })),
      changed: ai.flatMap((x) => {
        const y = bi.find((z) => z.foodId === x.foodId);
        return y && y.servings !== x.servings ? [{ name: x.name, before: y.servings, after: x.servings }] : [];
      }),
      kept: ai.filter((x) => bi.some((y) => y.foodId === x.foodId && y.servings === x.servings)).length,
    };
  });
}

/** Before/after preview for re-planning, so nothing changes until the user agrees. */
export function DiffDialog({
  open,
  onOpenChange,
  title,
  description,
  before,
  next,
  showCalories,
  onAccept,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  before: Working;
  next: Working;
  showCalories: boolean;
  onAccept: () => void;
}) {
  const diffs = useMemo(() => diffMeals(before.meals, next.meals), [before.meals, next.meals]);
  const b = useMemo(() => liveTotals(before.meals, next.result), [before.meals, next.result]);
  const a = useMemo(() => liveTotals(next.meals, next.result), [next.meals, next.result]);
  const changes = diffs.some((d) => d.added.length || d.removed.length || d.changed.length);
  const metB = goalsMet(b.coverage);
  const metA = goalsMet(a.coverage);
  const rows = a.coverage
    .filter((r) => r.amount && r.kind !== "info")
    .map((r) => {
      const old = b.coverage.find((x) => x.id === r.id);
      // "Below the reference" uses the discounted value, the same test as "references met".
      const below = Math.min(old?.conservative ?? 0, r.conservative ?? 0) < (r.amount ?? 0);
      return { id: r.id, kind: r.kind, before: old?.percent ?? null, after: r.percent, below };
    })
    .filter((d): d is { id: typeof d.id; kind: typeof d.kind; before: number; after: number; below: boolean } => d.before !== null && d.after !== null);
  // Changes matter below a reference (above it nothing more is gained); limits are always shown.
  const goalDeltas = rows
    .filter((d) => d.kind === "goal" && d.below && Math.abs(d.after - d.before) >= 3)
    .sort((x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before))
    .slice(0, 6);
  const deltas = [...goalDeltas, ...rows.filter((d) => d.kind === "limit")];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="-mx-2 grid gap-5 overflow-y-auto px-2">
          {!changes ? (
            <p className="rounded-2xl bg-muted/60 p-4 text-sm">The optimizer kept the same items and portions. Nothing would change.</p>
          ) : (
            <ul className="grid gap-3">
              {diffs.map((d) => {
                const any = d.added.length || d.removed.length || d.changed.length;
                return (
                  <li key={d.period} className="grid gap-1.5 rounded-2xl p-3 ring-1 ring-border">
                    <p className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{MEAL_PERIOD_LABELS[d.period]}</span>
                      <span className="text-xs text-muted-foreground">
                        {d.location.before !== d.location.after && d.location.before && d.location.after
                          ? `${d.location.before} → ${d.location.after}`
                          : (d.location.after ?? d.location.before ?? "")}
                      </span>
                    </p>
                    {!any ? (
                      <p className="text-sm text-muted-foreground">No change</p>
                    ) : (
                      <ul className="grid gap-1 text-sm">
                        {d.removed.map((x) => (
                          <li key={`r-${x.name}`} className="flex items-start gap-2">
                            <Minus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span>
                              <span className="sr-only">Removed: </span>
                              <span className="line-through decoration-foreground/40">{x.name}</span>{" "}
                              <span className="text-muted-foreground">({servingsText(x.servings)})</span>
                            </span>
                          </li>
                        ))}
                        {d.added.map((x) => (
                          <li key={`a-${x.name}`} className="flex items-start gap-2">
                            <Plus className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                            <span>
                              <span className="sr-only">Added: </span>
                              <span className="font-medium">{x.name}</span> <span className="text-muted-foreground">({servingsText(x.servings)})</span>
                            </span>
                          </li>
                        ))}
                        {d.changed.map((x) => (
                          <li key={`c-${x.name}`} className="flex items-start gap-2">
                            <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span>
                              {x.name}: {servingsText(x.before)} → {servingsText(x.after)} servings
                            </span>
                          </li>
                        ))}
                        {d.kept > 0 && <li className="pl-6 text-xs text-muted-foreground">{d.kept} other item(s) unchanged</li>}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {changes && (
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">What changes for the day</h3>
              <p className="text-sm text-muted-foreground">
                References met (after discounting uncertain estimates): {metB.met} → {metA.met} of {metA.total}
                {showCalories && next.result.energy.shown && b.energy.value !== null && a.energy.value !== null
                  ? ` · Energy ≈ ${fmtKcal(b.energy.value)} → ${fmtKcal(a.energy.value)}`
                  : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {goalDeltas.length
                  ? "Nutrients not yet met (after the uncertainty discount) that change, plus the limits."
                  : "No nutrient that is still short of its reference changes by more than a few points."}
              </p>
              {deltas.length > 0 && (
                <div className="overflow-x-auto rounded-2xl ring-1 ring-foreground/[0.07]">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Change in percent of reference by nutrient</caption>
                    <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Nutrient
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          Now
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          Re-planned
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-foreground/[0.06]">
                      {deltas.map((d) => (
                        <tr key={d.id}>
                          <th scope="row" className="px-3 py-1.5 text-left font-normal">
                            {nutrientName(d.id).replace(/^./, (c) => c.toUpperCase())}
                            {d.kind === "limit" && <span className="text-muted-foreground"> (limit)</span>}
                          </th>
                          <td className="px-3 py-1.5 text-right tabular-nums">{fmtPercent(d.before)}</td>
                          <td className="px-3 py-1.5 text-right font-medium tabular-nums">{fmtPercent(d.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep current plan
          </Button>
          <Button onClick={onAccept} disabled={!changes}>
            Use the re-planned version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface StrategyOption {
  strategy: StrategyKey;
  request: PlanRequest;
  result: PlanResult;
}

/** The same settings solved with each strategy, side by side. */
export function CompareDialog({
  open,
  onOpenChange,
  current,
  options,
  showCalories,
  onUse,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  current: Working;
  options: StrategyOption[] | null;
  showCalories: boolean;
  onUse: (o: StrategyOption) => void;
}) {
  // Every option is measured against the same references (the Balanced strategy's), since some
  // strategies tighten their own targets (e.g. a stricter sodium limit) and would not compare fairly.
  const baseline = useMemo(
    () => (current.request.strategy === "balanced" ? current.result.targets : (options?.find((o) => o.strategy === "balanced")?.result.targets ?? current.result.targets)),
    [current, options],
  );
  const currentLive = useMemo(() => liveTotals(current.meals, { ...current.result, targets: baseline }), [current, baseline]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compare strategies</DialogTitle>
          <DialogDescription>
            The same meals, markets and filters, optimized with different priorities. Locked items stay in every option, and every option is measured against the same standard references.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-2 overflow-y-auto px-2" aria-busy={!options}>
          {!options ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <p className="flex items-center gap-2 text-sm text-muted-foreground sm:col-span-2" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Solving each strategy…
              </p>
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-44 rounded-2xl" />
              ))}
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              <OptionCard
                label={`${STRATEGIES[current.request.strategy].label} (current)`}
                description={STRATEGIES[current.request.strategy].description}
                meals={current.meals}
                live={currentLive}
                result={current.result}
                showCalories={showCalories}
                current
              />
              {options.map((o) => (
                <OptionCard
                  key={o.strategy}
                  label={STRATEGIES[o.strategy].label}
                  description={STRATEGIES[o.strategy].description}
                  meals={o.result.meals}
                  live={liveTotals(o.result.meals, { ...o.result, targets: baseline })}
                  result={o.result}
                  showCalories={showCalories}
                  onUse={() => onUse(o)}
                />
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OptionCard({
  label,
  description,
  meals,
  live,
  result,
  showCalories,
  current,
  onUse,
}: {
  label: string;
  description: string;
  meals: PlanMeal[];
  live: ReturnType<typeof liveTotals>;
  result: PlanResult;
  showCalories: boolean;
  current?: boolean;
  onUse?: () => void;
}) {
  const items = meals.reduce((n, m) => n + m.items.length, 0);
  const met = goalsMet(live.coverage);
  const sodium = live.coverage.find((r) => r.id === "sodium");
  const lowest = live.coverage
    .filter((r) => r.kind === "goal" && r.percent !== null && r.percent < 70)
    .sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0))
    .slice(0, 2);
  const failed = !items;
  return (
    <li className={cn("grid content-between gap-3 rounded-2xl p-4 ring-1 ring-border", current && "bg-muted/50")}>
      <div className="grid gap-1">
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {failed ? (
        <p className="text-sm text-muted-foreground">{result.infeasibility?.reasons[0] ?? "No plan fits these settings with this strategy."}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">References met</dt>
          <dd className="text-right tabular-nums">
            {met.met} of {met.total}
          </dd>
          <dt className="text-muted-foreground">Items</dt>
          <dd className="text-right tabular-nums">{items}</dd>
          {sodium && sodium.percent !== null && (
            <>
              <dt className="text-muted-foreground">Sodium</dt>
              <dd className="text-right tabular-nums">{fmtPercent(sodium.percent)} of limit</dd>
            </>
          )}
          {showCalories && result.energy.shown && live.energy.value !== null && (
            <>
              <dt className="text-muted-foreground">Energy</dt>
              <dd className="text-right tabular-nums">≈ {fmtKcal(live.energy.value)}</dd>
            </>
          )}
          {lowest.length > 0 && (
            <>
              <dt className="text-muted-foreground">Lowest</dt>
              <dd className="text-right">{lowest.map((r) => `${nutrientName(r.id)} ${fmtPercent(r.percent)}`).join(", ")}</dd>
            </>
          )}
        </dl>
      )}
      {!current && !failed && onUse && (
        <Button variant="outline" size="sm" className="justify-self-start rounded-full" onClick={onUse}>
          Use this plan
        </Button>
      )}
    </li>
  );
}

export function SaveDialog({
  open,
  onOpenChange,
  defaultName,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultName: string;
  onSave: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(defaultName);
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            const done = await onSave(name.trim());
            setPending(false);
            if (done) onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>Save this plan</DialogTitle>
            <DialogDescription>Saved plans appear in History. Totals are recalculated from the stored menu when you save.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="plan-name">Name</Label>
            <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Save plan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
