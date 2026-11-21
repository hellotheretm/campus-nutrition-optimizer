"use client";

import { Check, ChevronDown, CircleAlert, Cpu, Info } from "lucide-react";
import { useMemo, useState } from "react";
import { Panel } from "@/components/app/page-header";
import { ConfidenceBadge } from "@/components/nutrition/badges";
import { CoverageList } from "@/components/nutrition/coverage-list";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { fmtKcal, fmtNumber, fmtNutrient } from "@/lib/format";
import { overallConfidence, type CoverageItem } from "@/lib/nutrition/daily";
import { sumNutrients } from "@/lib/nutrition/totals";
import { nutrientName } from "@/lib/optimizer/targets";
import type { CoverageRow, MacroId, PlanMeal, PlanResult } from "@/lib/optimizer/types";
import { cn } from "@/lib/utils";
import { goalsMet, liveTotals } from "./shared";

const FIRST_GOALS = 8;

export function toCoverageItem(r: CoverageRow): CoverageItem {
  const ref = r.amount;
  return {
    id: r.id,
    kind: r.kind === "limit" ? "limit" : "goal",
    reference: ref,
    value: r.value,
    low: r.low,
    high: r.high,
    percent: r.percent,
    lowPercent: r.low !== null && ref ? (r.low / ref) * 100 : null,
    highPercent: r.high !== null && ref ? (r.high / ref) * 100 : null,
    confidence: r.confidence,
    unknown: r.unknownItems,
  };
}

/** Live totals for the plan on screen, recalculated as the user edits. */
export function PlanTotals({
  meals,
  result,
  showCalories,
  showPercentages,
}: {
  meals: PlanMeal[];
  result: PlanResult;
  showCalories: boolean;
  showPercentages: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const live = useMemo(() => liveTotals(meals, result), [meals, result]);
  const macros = useMemo(() => sumNutrients(live.lines.map((l) => ({ nutrients: l.nutrients, factor: l.servings }))), [live.lines]);
  const goals = live.coverage.filter((r) => r.kind === "goal" && r.amount).map(toCoverageItem);
  const limits = live.coverage.filter((r) => r.kind === "limit" && r.amount).map(toCoverageItem);
  const met = goalsMet(live.coverage);
  const confidence = overallConfidence([...goals, ...limits]);
  const shownGoals = showAll ? goals : goals.slice(0, FIRST_GOALS);
  const e = live.energy;
  const strict = result.macroTargets?.length ? result.macroTargets : null;
  const strictTolerance = strict ? Math.round(((strict[0].max - strict[0].target) / strict[0].target) * 100) : 0;
  /** Live comparison with a target (recomputed as the plan is edited). */
  const strictTarget = (id: MacroId, value: number | null): TileTarget | null => {
    const row = strict?.find((r) => r.id === id);
    if (!row) return null;
    const fmt = (v: number) => (id === "energy" ? fmtKcal(v) : fmtNutrient(id, v));
    const inBand = value !== null && value >= row.min - 0.5 && value <= row.max + 0.5;
    const diff = value === null ? null : value - row.target;
    return {
      inBand,
      text: `Target ${fmt(row.target)}${diff === null ? "" : ` · ${diff >= 0 ? "+" : "−"}${fmt(Math.abs(diff))}`}`,
    };
  };

  if (!live.lines.length) {
    return (
      <Panel aria-labelledby="totals-heading" className="grid gap-2">
        <h2 id="totals-heading" className="font-semibold">
          Day totals
        </h2>
        <p className="text-sm text-muted-foreground">Totals appear once the plan has items.</p>
      </Panel>
    );
  }

  return (
    <Panel aria-labelledby="totals-heading" className="grid gap-5">
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="totals-heading" className="font-semibold">
            Day totals
          </h2>
          <ConfidenceBadge confidence={confidence} prefix="Estimates" />
        </div>
        <p className="text-sm text-muted-foreground">
          Meets {met.met} of {met.total} references after discounting uncertain estimates. Compared with {result.referenceLabel}.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 xl:grid-cols-2">
        {showCalories && result.energy.shown && (
          <Tile
            label="Energy"
            value={e.value !== null ? `≈ ${fmtKcal(e.value)}` : "Unknown"}
            detail={strict ? null : e.low !== null && e.high !== null && e.high - e.low > 1 ? `${fmtNumber(e.low)}–${fmtNumber(e.high)} likely` : null}
            target={strictTarget("energy", e.value)}
          />
        )}
        <Tile label="Protein" value={macros.protein?.known ? `≈ ${fmtNutrient("protein", macros.protein.value)}` : "Unknown"} target={strictTarget("protein", macros.protein?.known ? macros.protein.value : null)} />
        <Tile label="Carbs" value={macros.carbohydrate?.known ? `≈ ${fmtNutrient("carbohydrate", macros.carbohydrate.value)}` : "Unknown"} target={strictTarget("carbohydrate", macros.carbohydrate?.known ? macros.carbohydrate.value : null)} />
        <Tile label="Fat" value={macros.fat?.known ? `≈ ${fmtNutrient("fat", macros.fat.value)}` : "Unknown"} target={strictTarget("fat", macros.fat?.known ? macros.fat.value : null)} />
      </dl>
      {strict && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Your targets, each within ±{strictTolerance}%. Calories and macros follow 4/9/4 math; labels round, so small gaps are normal.
        </p>
      )}
      {!strict && showCalories && result.energy.shown && (result.energy.min || result.energy.max) && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Your calorie range: {result.energy.min ? fmtNumber(result.energy.min) : "no minimum"} to {result.energy.max ? fmtNumber(result.energy.max) : "no maximum"} kcal (a reference you set, not a rule).
        </p>
      )}

      {live.uls.length > 0 && (
        <div className="flex gap-2 rounded-2xl bg-muted/70 p-3 text-sm" role="note">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="grid gap-1">
            {live.uls.map((u) => (
              <p key={u.id}>
                At the high end of the estimates, {nutrientName(u.id)} could pass its upper intake level ({fmtNutrient(u.id, u.ul)}). Fewer servings of the items richest in it would help.
              </p>
            ))}
          </div>
        </div>
      )}

      <section aria-labelledby="goals-heading" className="grid gap-3">
        <h3 id="goals-heading" className="text-sm font-semibold">
          Vitamins, minerals, protein and fiber
        </h3>
        <CoverageList items={shownGoals} showPercent={showPercentages} />
        {goals.length > FIRST_GOALS && (
          <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? "Show fewer" : `Show all ${goals.length}`}
          </Button>
        )}
      </section>
      {limits.length > 0 && (
        <section aria-labelledby="limits-heading" className="grid gap-3">
          <h3 id="limits-heading" className="text-sm font-semibold">
            Nutrients to keep moderate
          </h3>
          <CoverageList items={limits} showPercent={showPercentages} />
        </section>
      )}
      <p className="text-xs text-muted-foreground">
        Bars show estimates; the lighter band is the likely range. Items without data for a nutrient are listed, never counted as zero. One day below a reference is
        normal; it&apos;s the average over time that matters.
      </p>
    </Panel>
  );
}

interface TileTarget {
  inBand: boolean;
  text: string;
}

function Tile({ label, value, detail, target }: { label: string; value: string; detail?: string | null; target?: TileTarget | null }) {
  return (
    <div className="rounded-2xl bg-muted/60 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
      {detail && <dd className="text-[11px] text-muted-foreground tabular-nums">{detail}</dd>}
      {target && (
        <dd className="flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
          {target.inBand ? (
            <Check className="size-3 shrink-0 text-conf-high" aria-hidden="true" />
          ) : (
            <CircleAlert className="size-3 shrink-0 text-conf-low" aria-hidden="true" />
          )}
          <span>
            <span className="sr-only">{target.inBand ? "Within target. " : "Outside target. "}</span>
            {target.text}
          </span>
        </dd>
      )}
    </div>
  );
}

/** Model transparency: what the solver did and the assumptions behind every plan. */
export function ModelPanel({ result, edited }: { result: PlanResult; edited: boolean }) {
  const [open, setOpen] = useState(false);
  const m = result.model;
  const stats: [string, string][] = [
    ["Solver", m.solver],
    ["Menu items considered", fmtNumber(m.candidates)],
    ["Variables", fmtNumber(m.variables)],
    ["Constraints", fmtNumber(m.constraints)],
    ["Solve time", m.solveMs ? `${fmtNumber(m.solveMs)} ms` : "—"],
  ];
  return (
    <Panel aria-labelledby="model-heading" className="p-0 md:p-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-3xl p-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:p-6"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Cpu className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span id="model-heading" className="block font-semibold">
                How this plan was built
              </span>
              <span className="block text-xs text-muted-foreground">The optimization model, its assumptions and what it found.</span>
            </span>
            <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-4 px-4 pb-4 md:px-6 md:pb-6">
          {result.summary.length > 0 && (
            <section className="grid gap-1.5">
              <h3 className="text-sm font-semibold">{edited ? "When it was generated" : "Summary"}</h3>
              <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
                {result.summary.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              {edited && <p className="text-xs text-muted-foreground">You changed the plan since; the day totals reflect your edits.</p>}
            </section>
          )}
          <section className="grid gap-1.5">
            <h3 className="text-sm font-semibold">Assumptions</h3>
            <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
              {m.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
          <section className="grid gap-1.5">
            <h3 className="text-sm font-semibold">This run</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {stats.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </CollapsibleContent>
      </Collapsible>
    </Panel>
  );
}
