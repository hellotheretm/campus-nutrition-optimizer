import { Leaf, TriangleExclamationPoint } from "lucide-react";
import { allergenLabel, dietaryLabel } from "@/lib/menus/labels";
import { cn } from "@/lib/utils";

/** Dietary labels exactly as the source published them. */
export function DietaryChips({ labels, className, max }: { labels: string[]; className?: string; max?: number }) {
  if (!labels.length) return null;
  const shown = max ? labels.slice(0, max) : labels;
  return (
    <ul className={cn("flex flex-wrap gap-1", className)} aria-label="Dietary labels from the dining operator">
      {shown.map((l) => (
        <li
          key={l}
          className="inline-flex h-5 items-center gap-1 rounded-full bg-emerald-600/10 px-2 text-[11px] font-medium text-emerald-800 dark:text-emerald-300"
        >
          {(l === "vegan" || l === "vegetarian" || l === "plant_forward") && <Leaf className="size-3" aria-hidden="true" />}
          {dietaryLabel(l)}
        </li>
      ))}
      {max && labels.length > max && (
        <li className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-[11px] text-muted-foreground">+{labels.length - max}</li>
      )}
    </ul>
  );
}

/**
 * Allergens declared by the source. An empty list is shown as "none listed",
 * never as "allergen-free".
 */
export function AllergenChips({ allergens, className, showEmpty = false }: { allergens: string[]; className?: string; showEmpty?: boolean }) {
  if (!allergens.length) {
    return showEmpty ? (
      <p className={cn("text-xs text-muted-foreground", className)}>No allergens listed by the source. That does not mean the item is allergen-free.</p>
    ) : null;
  }
  return (
    <p className={cn("flex flex-wrap items-center gap-1 text-[11px]", className)}>
      <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
        <TriangleExclamationPoint className="size-3" aria-hidden="true" />
        Contains:
      </span>
      {allergens.map((a, i) => (
        <span key={a} className="text-foreground/80">
          {allergenLabel(a)}
          {i < allergens.length - 1 ? "," : ""}
        </span>
      ))}
    </p>
  );
}
