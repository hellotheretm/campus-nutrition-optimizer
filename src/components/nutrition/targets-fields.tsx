"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  KCAL_PER_GRAM,
  MACRO_LIMITS,
  MACRO_TOLERANCES,
  resolveMacroTargets,
  type MacroId,
  type MacroTargetsInput,
  type Tolerance,
} from "@/lib/optimizer/types";
import { cn } from "@/lib/utils";

const FIELDS: { id: MacroId; label: string; unit: string }[] = [
  { id: "energy", label: "Calories", unit: "kcal" },
  { id: "protein", label: "Protein", unit: "g" },
  { id: "fat", label: "Fat", unit: "g" },
  { id: "carbohydrate", label: "Carbs", unit: "g" },
];

function numOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US");

/**
 * Daily calorie and macro targets. Every field is optional. Protein, fat and
 * carbs always agree with calories by 4/9/4 math: with three of the four set,
 * the fourth is calculated and shown in its field; all four set must add up.
 */
export function TargetsFields({
  value,
  onChange,
  className,
}: {
  value: MacroTargetsInput;
  onChange: (v: MacroTargetsInput) => void;
  className?: string;
}) {
  const uid = useId();
  const resolved = resolveMacroTargets(value);
  const t = resolved.targets;
  const update = (patch: Partial<MacroTargetsInput>) => onChange({ ...value, ...patch });
  const anySet = FIELDS.some((f) => value[f.id] !== null);
  const allMacros = t.protein !== undefined && t.fat !== undefined && t.carbohydrate !== undefined && t.energy !== undefined;
  const share = (id: "protein" | "fat" | "carbohydrate") => Math.round(((t[id]! * KCAL_PER_GRAM[id]) / t.energy!) * 100);

  return (
    <div className={cn("grid gap-3", className)}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {FIELDS.map((f) => {
          const calculated = resolved.derived === f.id && t[f.id] !== undefined;
          return (
            <div key={f.id} className="grid gap-1.5">
              <Label htmlFor={`${uid}-${f.id}`}>{f.label}</Label>
              <div className="relative">
                <Input
                  id={`${uid}-${f.id}`}
                  type="number"
                  inputMode="decimal"
                  min={MACRO_LIMITS[f.id].min}
                  max={MACRO_LIMITS[f.id].max}
                  value={value[f.id] ?? ""}
                  onChange={(e) => update({ [f.id]: numOrNull(e.target.value) })}
                  placeholder={calculated ? `${fmt(t[f.id]!)} (auto)` : "No target"}
                  aria-describedby={`${uid}-math`}
                  className={cn("pr-12", calculated && "placeholder:font-medium placeholder:text-foreground/80")}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">{f.unit}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={`${uid}-tol`} className="text-sm">
            Tolerance
          </Label>
          <Select value={String(value.tolerancePct)} onValueChange={(v) => update({ tolerancePct: Number(v) as Tolerance })}>
            <SelectTrigger id={`${uid}-tol`} className="h-8 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MACRO_TOLERANCES.map((tol) => (
                <SelectItem key={tol} value={String(tol)}>
                  ±{tol}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p id={`${uid}-math`} className={cn("min-w-0 text-xs", resolved.error ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
          {resolved.error
            ? resolved.error
            : allMacros
              ? `${fmt(t.protein!)} g × 4 + ${fmt(t.fat!)} g × 9 + ${fmt(t.carbohydrate!)} g × 4 = ${Math.round(t.energy!).toLocaleString("en-US")} kcal · protein ${share("protein")}%, fat ${share("fat")}%, carbs ${share("carbohydrate")}% of calories`
              : anySet
                ? "Fill in three of the four and the last is calculated, so your macros always add up to your calories."
                : "Leave all blank to plan for vitamins and minerals only, or set any of these."}
        </p>
      </div>
    </div>
  );
}
