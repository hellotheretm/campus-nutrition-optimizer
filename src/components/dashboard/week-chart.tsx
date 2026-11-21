"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ErrorBar, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ConfidenceBadge } from "@/components/nutrition/badges";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/dates";
import { fmtNutrient, fmtPercent, plainName } from "@/lib/format";
import type { Confidence } from "@/lib/nutrition/estimator";
import type { NutrientId } from "@/lib/nutrition/nutrients";
import { NUTRIENTS } from "@/lib/nutrition/nutrients";

export interface WeekDay {
  date: string;
  label: string;
  logged: number;
  values: Partial<Record<NutrientId, { value: number; low: number; high: number; confidence: Confidence; unknown: number }>>;
}

interface Row {
  date: string;
  label: string;
  logged: number;
  value: number | null;
  err: [number, number] | null;
  low: number | null;
  high: number | null;
  confidence: Confidence;
  unknown: number;
}

/**
 * One nutrient across the last seven days. Days with nothing logged have no
 * bar (they are not zero); whiskers show the likely range of the estimate.
 */
export function WeekChart({
  days,
  options,
  references,
  initial,
}: {
  days: WeekDay[];
  options: NutrientId[];
  references: Partial<Record<NutrientId, { amount: number; kind: "goal" | "limit" }>>;
  initial: NutrientId;
}) {
  const [id, setId] = useState<NutrientId>(initial);
  const unit = NUTRIENTS[id].unit;
  const ref = references[id] ?? null;
  const rows: Row[] = days.map((d) => {
    const v = d.logged ? d.values[id] : undefined;
    return {
      date: d.date,
      label: d.label,
      logged: d.logged,
      value: v ? v.value : null,
      err: v ? [Math.max(0, v.value - v.low), Math.max(0, v.high - v.value)] : null,
      low: v ? v.low : null,
      high: v ? v.high : null,
      confidence: v?.confidence ?? "none",
      unknown: v?.unknown ?? 0,
    };
  });
  const daysWithData = rows.filter((r) => r.value !== null).length;
  const pct = (v: number | null) => (v !== null && ref ? (v / ref.amount) * 100 : null);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="week-heading" className="font-semibold">
            Last 7 days: {plainName(id)}
          </h2>
          <p className="text-sm text-muted-foreground">
            Eaten items only. Whiskers show the likely range{ref ? `; the line marks the ${ref.kind === "limit" ? "daily limit benchmark" : "daily reference"}` : ""}.
          </p>
        </div>
        <Select value={id} onValueChange={(v) => setId(v as NutrientId)}>
          <SelectTrigger className="w-48" aria-label="Nutrient to chart">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o} value={o}>
                {o === "energy" ? "Calories" : plainName(o)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {daysWithData === 0 ? (
        <p className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">
          Nothing logged in the last seven days{rows.some((r) => r.logged) ? ` has data for ${plainName(id).toLowerCase()}` : ""}. Days you log will appear here.
        </p>
      ) : (
        <div className="h-64 w-full" role="img" aria-label={`Bar chart of ${plainName(id)} for the last seven days. The same values are in the table below.`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                interval={0}
              />
              <YAxis
                width={48}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickFormatter={(v: number) => `${Math.round(v).toLocaleString("en-US")}`}
                unit={unit === "kcal" ? "" : ` ${unit}`}
                domain={[0, (max: number) => Math.max(max, ref?.amount ?? 0) * 1.08]}
              />
              {ref && (
                <ReferenceLine
                  y={ref.amount}
                  stroke="var(--muted-foreground)"
                  strokeWidth={1}
                  ifOverflow="extendDomain"
                  label={{ value: ref.kind === "limit" ? "Limit" : "Reference", position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 11 }}
                />
              )}
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                content={({ active, payload }) => {
                  const row = (active && payload?.[0]?.payload) as Row | undefined;
                  if (!row) return null;
                  return (
                    <div className="grid gap-1 rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-border">
                      <p className="font-medium">{formatDate(row.date, "long")}</p>
                      {row.value === null ? (
                        <p className="text-muted-foreground">{row.logged ? "No data for this nutrient" : "Nothing logged"}</p>
                      ) : (
                        <>
                          <p>
                            ≈ {fmtNutrient(id, row.value)}
                            {ref ? ` · ${fmtPercent(pct(row.value))} of ${ref.kind === "limit" ? "limit" : "reference"}` : ""}
                          </p>
                          {row.low !== null && row.high !== null && row.high - row.low > 0.001 && (
                            <p className="text-muted-foreground">
                              Likely {fmtNutrient(id, row.low)} to {fmtNutrient(id, row.high)}
                            </p>
                          )}
                          {row.unknown > 0 && <p className="text-muted-foreground">{row.unknown} item(s) without data, not counted</p>}
                          <ConfidenceBadge confidence={row.confidence} />
                        </>
                      )}
                    </div>
                  );
                }}
              />
              <Bar dataKey="value" fill="var(--viz-series)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}>
                <ErrorBar dataKey="err" width={6} stroke="var(--foreground)" strokeOpacity={0.55} strokeWidth={1.5} direction="y" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <details className="group text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show as a table</summary>
        <div className="mt-2 overflow-x-auto rounded-2xl ring-1 ring-foreground/[0.07]">
          <table className="w-full min-w-[28rem] text-sm">
            <caption className="sr-only">{plainName(id)} by day</caption>
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Day
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Amount
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Likely range
                </th>
                {ref && (
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    % of {ref.kind === "limit" ? "limit" : "reference"}
                  </th>
                )}
                <th scope="col" className="px-3 py-2 font-medium">
                  Confidence
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/[0.06]">
              {rows.map((r) => (
                <tr key={r.date}>
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    {formatDate(r.date, "medium")}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.value === null ? (r.logged ? "No data" : "Nothing logged") : `≈ ${fmtNutrient(id, r.value)}`}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                    {r.low !== null && r.high !== null ? `${fmtNutrient(id, r.low)} – ${fmtNutrient(id, r.high)}` : "—"}
                  </td>
                  {ref && <td className="px-3 py-2 text-right tabular-nums">{fmtPercent(pct(r.value))}</td>}
                  <td className="px-3 py-2">{r.value === null ? "—" : <ConfidenceBadge confidence={r.confidence} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
