import type { NutrientEstimates } from "@/lib/nutrition/estimator";
import { NUTRIENT_LIST, type NutrientCategory, type NutrientId } from "@/lib/nutrition/nutrients";
import type { ReferenceProfile } from "@/lib/nutrition/references";
import { fmtNutrient, fmtPercent, fmtRange, plainName } from "@/lib/format";
import { ConfidenceBadge, ProvenanceBadge } from "./badges";

const GROUPS: { title: string; categories: NutrientCategory[] }[] = [
  { title: "Energy and macronutrients", categories: ["energy", "macronutrient"] },
  { title: "Fats", categories: ["fat_detail", "fatty_acid"] },
  { title: "Vitamins", categories: ["vitamin"] },
  { title: "Minerals", categories: ["mineral"] },
  { title: "Other", categories: ["other"] },
];

/**
 * Every tracked nutrient with its value, likely range, share of the
 * reference, provenance and confidence. Unknown values say "Unknown".
 */
export function NutrientTable({
  nutrients,
  reference,
  factor = 1,
}: {
  nutrients: Partial<NutrientEstimates>;
  reference: ReferenceProfile;
  factor?: number;
}) {
  const refWord = reference.standard === "fda_dv" ? "% DV" : "% of RDA/AI";
  return (
    <div className="grid gap-6">
      {GROUPS.map((g) => {
        const defs = NUTRIENT_LIST.filter((n) => g.categories.includes(n.category) && !n.hidden);
        if (!defs.length) return null;
        return (
          <div key={g.title}>
            <h3 className="mb-2 text-sm font-semibold">{g.title}</h3>
            <div className="overflow-x-auto rounded-2xl ring-1 ring-foreground/[0.07]">
              <table className="w-full min-w-[34rem] text-sm">
                <caption className="sr-only">
                  {g.title}: amount per serving, likely range, {refWord}, data source and confidence
                </caption>
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Nutrient</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{refWord}</th>
                    <th scope="col" className="px-3 py-2 font-medium">Source</th>
                    <th scope="col" className="px-3 py-2 font-medium">Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/[0.06] bg-card/60">
                  {defs.map((def) => {
                    const id = def.id as NutrientId;
                    const est = nutrients[id];
                    const known = est && est.value !== null && est.confidence !== "none";
                    const value = known ? est.value! * factor : null;
                    const ref = reference.values[id]?.amount ?? reference.limits[id];
                    const range = known ? fmtRange(id, (est.low ?? est.value!) * factor, (est.high ?? est.value!) * factor) : null;
                    return (
                      <tr key={id} className="align-top">
                        <th scope="row" className="px-3 py-2 text-left font-normal">
                          {plainName(id)}
                          {est?.note && <span className="block text-xs text-muted-foreground">{est.note}</span>}
                        </th>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {known ? (
                            <>
                              <span className="font-medium">
                                {est.provenance === "official" ? "" : "≈ "}
                                {fmtNutrient(id, value)}
                              </span>
                              {range && <span className="block text-xs text-muted-foreground">{range}</span>}
                            </>
                          ) : (
                            <span className="text-muted-foreground italic">Unknown</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {known && ref ? fmtPercent((value! / ref) * 100) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <ProvenanceBadge provenance={est?.provenance ?? "unknown"} />
                        </td>
                        <td className="px-3 py-2">
                          <ConfidenceBadge confidence={est?.confidence ?? "none"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Percentages use {reference.label}. They are general benchmarks for healthy people, not personal targets, and a single food or day
        is never a deficiency.
      </p>
    </div>
  );
}
