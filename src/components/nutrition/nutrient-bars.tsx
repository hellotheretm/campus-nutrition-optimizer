import { fmtNutrient, plainName } from "@/lib/format";
import type { NutrientHighlight } from "@/lib/nutrition/highlights";
import { cn } from "@/lib/utils";

const clamp = (n: number | null) => Math.max(0, Math.min(100, n ?? 0));

/**
 * A food's 1–3 standout nutrients as small bars, styled like the day totals:
 * the dark fill is the amount relative to the day's reference (full bar = 100%),
 * the lighter band is the likely range of an estimate. The percentage is
 * spoken to screen readers and shown on hover rather than printed.
 */
export function NutrientBars({ items, reference = "daily value", className }: { items: NutrientHighlight[]; reference?: string; className?: string }) {
  if (!items.length) return null;
  return (
    <ul className={cn("grid gap-1.5", className)} aria-label="Standout nutrients">
      {items.map((h) => {
        const pct = Math.round(h.percent);
        const title = `${h.estimated ? "About " : ""}${pct}% of the ${reference}`;
        return (
          <li key={h.id} className="grid gap-0.5" title={title}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate font-medium text-foreground/85">{plainName(h.id)}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {h.estimated ? "≈ " : ""}
                {fmtNutrient(h.id, h.value)}
                <span className="sr-only">, {title.toLowerCase()}</span>
              </span>
            </div>
            <div className="relative h-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
              {h.lowPercent !== null && h.highPercent !== null && h.highPercent > h.lowPercent && (
                <div
                  className="absolute inset-y-0 bg-foreground/20"
                  style={{ left: `${clamp(h.lowPercent)}%`, width: `${clamp(h.highPercent) - clamp(h.lowPercent)}%` }}
                />
              )}
              <div className="absolute inset-y-0 left-0 rounded-full bg-foreground/70" style={{ width: `${clamp(h.percent)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
