import { ConfidenceBadge } from "@/components/nutrition/badges";
import { fmtNutrient, fmtPercent, plainName } from "@/lib/format";
import type { CoverageItem } from "@/lib/nutrition/daily";
import { cn } from "@/lib/utils";

const clamp = (v: number | null) => (v === null ? 0 : Math.max(0, Math.min(100, v)));

/**
 * Nutrient totals against a reference. Bars are neutral (never red/green
 * grades); the lighter band is the likely range; items without data are
 * counted separately and never as zero.
 */
export function CoverageList({ items, showPercent = true, className }: { items: CoverageItem[]; showPercent?: boolean; className?: string }) {
  return (
    <ul className={cn("grid gap-3", className)}>
      {items.map((c) => {
        const known = c.value !== null;
        return (
          <li key={c.id} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{plainName(c.id)}</span>
              <span className="text-right text-muted-foreground tabular-nums">
                {known ? `≈ ${fmtNutrient(c.id, c.value)}` : "Unknown"}
                {known && showPercent && c.percent !== null && (
                  <span className="ml-1.5 font-medium text-foreground">
                    {fmtPercent(c.percent)}
                    {c.kind === "limit" ? " of limit" : ""}
                  </span>
                )}
              </span>
            </div>
            {showPercent && c.reference !== null && (
              <div className="relative h-1.5 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
                {known && c.lowPercent !== null && c.highPercent !== null && c.highPercent > c.lowPercent && (
                  <div
                    className="absolute inset-y-0 bg-foreground/20"
                    style={{ left: `${clamp(c.lowPercent)}%`, width: `${clamp(c.highPercent) - clamp(c.lowPercent)}%` }}
                  />
                )}
                <div className="absolute inset-y-0 left-0 rounded-full bg-foreground/70" style={{ width: `${clamp(c.percent)}%` }} />
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
              <ConfidenceBadge confidence={c.confidence} />
              {c.unknown > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {c.unknown} item{c.unknown === 1 ? "" : "s"} without data (not counted as zero)
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
