"use client";

import { ChevronDown, ExternalLink, Info, Loader2, MapPin, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Panel } from "@/components/app/page-header";
import { DateNav } from "@/components/common/date-nav";
import { TargetsFields } from "@/components/nutrition/targets-fields";
import { TagInput } from "@/components/settings/tag-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { plainName } from "@/lib/format";
import { ALLERGEN_LABELS, MAJOR_ALLERGENS } from "@/lib/menus/labels";
import type { NutrientId } from "@/lib/nutrition/nutrients";
import { AGE_GROUP_LABELS, type AgeGroup } from "@/lib/nutrition/references";
import { STRATEGIES, STRATEGY_KEYS, type StrategyKey } from "@/lib/optimizer/types";
import { cn } from "@/lib/utils";
import { servable, type Inputs, type OptimizerUniversity, type PeriodAvailability } from "./shared";

const FOCUS_OPTIONS: NutrientId[] = [
  "protein",
  "fiber",
  "calcium",
  "iron",
  "vitamin_d",
  "potassium",
  "magnesium",
  "vitamin_c",
  "folate",
  "vitamin_b12",
  "zinc",
  "vitamin_a",
  "sodium",
];

export function PlanInputs({
  inputs,
  setInputs,
  availability,
  university,
  universities,
  date,
  today,
  minDate,
  maxDate,
  busy,
  lockedCount,
  hasPlan,
  signedIn,
  onGenerate,
  onReset,
}: {
  inputs: Inputs;
  setInputs: (fn: (prev: Inputs) => Inputs) => void;
  availability: PeriodAvailability[];
  university: OptimizerUniversity;
  universities: { id: string; slug: string; name: string; isDemo: boolean }[];
  date: string;
  today: string;
  minDate: string;
  maxDate: string;
  busy: boolean;
  lockedCount: number;
  hasPlan: boolean;
  signedIn: boolean;
  onGenerate: () => void;
  onReset: () => void;
}) {
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const anyServed = availability.some((a) => servable(a).length > 0);
  const enabledCount = availability.filter((a) => inputs.meals[a.period].enabled && servable(a).length > 0).length;
  const offered = availability.filter((a) => a.locations.length > 0);
  const demo = universities.find((u) => u.isDemo && u.id !== university.id);
  const set = <K extends keyof Inputs>(key: K, value: Inputs[K]) => setInputs((p) => ({ ...p, [key]: value }));
  const setDiet = <K extends keyof Inputs["preferences"]>(key: K, value: Inputs["preferences"][K]) =>
    setInputs((p) => ({ ...p, preferences: { ...p.preferences, [key]: value } }));

  const prefs = inputs.preferences;
  const filterCount =
    (prefs.pattern !== "none" ? 1 : 0) +
    [prefs.avoidGluten, prefs.avoidDairy, prefs.avoidNuts].filter(Boolean).length +
    prefs.avoidAllergens.length +
    prefs.excludedIngredients.length +
    prefs.dislikes.length;
  const summary = [
    // People under 19 always get the DRIs for ages 14–18 (see getReferenceProfile).
    inputs.reference.standard === "dri" || inputs.reference.ageGroup === "under_19"
      ? `DRIs, ${AGE_GROUP_LABELS[inputs.reference.ageGroup].toLowerCase()}`
      : "FDA Daily Values",
    filterCount ? `${filterCount} food filter${filterCount === 1 ? "" : "s"}` : "no food filters",
    prefs.preferred.length ? `${prefs.preferred.length} favorite${prefs.preferred.length === 1 ? "" : "s"}` : null,
    `up to ${inputs.maxItemsPerMeal} items per meal`,
    inputs.focus.length ? `extra weight on ${inputs.focus.length}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    // grid-cols-1 (minmax(0, 1fr)) keeps wide controls from stretching the panel past a phone screen.
    <Panel aria-labelledby="settings-heading" className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="settings-heading" className="font-semibold">
            Plan settings
          </h2>
          <p className="text-sm text-muted-foreground">
            {university.name}
            {university.isDemo && " (demo data, not a real campus)"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {universities.length > 1 && (
            <Select value={university.slug} onValueChange={(v) => router.push(`/optimizer?u=${encodeURIComponent(v)}`)}>
              <SelectTrigger className="h-9 max-w-60 rounded-full" aria-label={`University: ${university.name}. Change university`}>
                <span className="min-w-0 truncate">{university.shortName}</span>
              </SelectTrigger>
              <SelectContent>
                {universities.map((u) => (
                  <SelectItem key={u.id} value={u.slug}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DateNav date={date} today={today} minDate={minDate} maxDate={maxDate} />
        </div>
      </div>

      {!anyServed && (
        <div className="flex gap-3 rounded-2xl bg-muted/70 p-4 text-sm" role="status">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="grid gap-2">
            <p className="font-medium">No menu data for this day</p>
            <p className="text-muted-foreground">
              {!university.autoSyncAllowed && university.integrationStatus !== "live"
                ? `${university.shortName} menus aren't in this app yet. Automatic retrieval is off on this server and no import covers this date. The optimizer only plans from real, stored menus, so there's nothing to plan with.`
                : "No menu has been published or imported for this date yet, so there's nothing to plan with. Try another day."}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {university.menuSourceUrl && (
                <a href={university.menuSourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  Official menus <ExternalLink className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
              {demo && (
                <Link href={`/optimizer?u=${demo.slug}`} className="font-medium text-primary hover:underline">
                  Try the demo campus
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      <fieldset className="grid gap-3" disabled={!anyServed}>
        <legend className="mb-2 text-sm font-medium">Meals to plan</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(offered.length ? offered : availability.filter((a) => ["breakfast", "lunch", "dinner"].includes(a.period))).map((a) => (
            <MealToggle
              key={a.period}
              availability={a}
              value={inputs.meals[a.period]}
              onChange={(v) => setInputs((p) => ({ ...p, meals: { ...p.meals, [a.period]: v } }))}
            />
          ))}
        </div>
      </fieldset>

      <section aria-labelledby="targets-heading" className="grid gap-3 rounded-2xl bg-muted/50 p-4">
        <div>
          <h3 id="targets-heading" className="text-sm font-medium">
            Daily targets (optional)
          </h3>
          <p className="text-xs text-muted-foreground">
            Every plan covers as many vitamin, mineral, protein and fiber references as the menus allow. Any target you set here
            is hit within your tolerance, as close to exact as possible.
          </p>
        </div>
        <TargetsFields value={inputs.targets} onChange={(v) => set("targets", v)} />
        <p className="text-xs text-muted-foreground">
          These are your own numbers; the app never sets or suggests a calorie deficit. Items without known values for a target
          aren&apos;t used, and food labels round, so totals can differ slightly from 4/9/4 math.
          {inputs.reference.ageGroup === "under_19" &&
            " Teens are still growing and need enough energy every day; a doctor or registered dietitian can help choose calorie targets."}
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:items-start">
        <div className="grid gap-1.5">
          <Label htmlFor="strategy">Strategy</Label>
          <Select value={inputs.strategy} onValueChange={(v) => set("strategy", v as StrategyKey)}>
            <SelectTrigger id="strategy" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STRATEGY_KEYS.map((k) => (
                <SelectItem key={k} value={k}>
                  {STRATEGIES[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground md:pt-7">{STRATEGIES[inputs.strategy].description}</p>
      </div>

      <Collapsible open={moreOpen} onOpenChange={setMoreOpen} className="grid grid-cols-1 gap-4">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left ring-1 ring-border transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">More options</span>
              <span className="block text-xs text-muted-foreground">{summary}</span>
            </span>
            <ChevronDown className={cn("size-4 shrink-0 transition-transform", moreOpen && "rotate-180")} aria-hidden="true" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid grid-cols-1 gap-6">
          <Group title="Nutrition reference" hint="Population benchmarks, not personal prescriptions.">
            <RadioGroup
              value={inputs.reference.standard}
              onValueChange={(v) => set("reference", { ...inputs.reference, standard: v as "fda_dv" | "dri" })}
              className="grid gap-2 sm:grid-cols-2"
              aria-label="Reference standard"
            >
              <Label htmlFor="std-dv" className="flex cursor-pointer items-start gap-3 rounded-xl p-3 font-normal ring-1 ring-border">
                <RadioGroupItem id="std-dv" value="fda_dv" className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span className="font-medium">FDA Daily Values</span>
                  <span className="text-xs text-muted-foreground">The numbers on food labels.</span>
                </span>
              </Label>
              <Label htmlFor="std-dri" className="flex cursor-pointer items-start gap-3 rounded-xl p-3 font-normal ring-1 ring-border">
                <RadioGroupItem id="std-dri" value="dri" className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span className="font-medium">Dietary Reference Intakes</span>
                  <span className="text-xs text-muted-foreground">By age group and sex.</span>
                </span>
              </Label>
            </RadioGroup>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="age">Age group</Label>
                <Select value={inputs.reference.ageGroup} onValueChange={(v) => set("reference", { ...inputs.reference, ageGroup: v as AgeGroup })}>
                  <SelectTrigger id="age" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(AGE_GROUP_LABELS) as AgeGroup[]).map((a) => (
                      <SelectItem key={a} value={a}>
                        {AGE_GROUP_LABELS[a]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sex">Reference values for</Label>
                <Select
                  value={inputs.reference.sex}
                  onValueChange={(v) => set("reference", { ...inputs.reference, sex: v as Inputs["reference"]["sex"] })}
                >
                  <SelectTrigger id="sex" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unspecified">Prefer not to say</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Group>

          <Group
            title="Food preferences"
            hint="Filters use the dining operator's allergen labels and ingredient text, which can be incomplete. They can't guarantee an item is free of an allergen; please confirm with dining staff."
          >
            <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:items-end">
              <div className="grid gap-1.5">
                <Label htmlFor="pattern">Eating pattern</Label>
                <Select value={prefs.pattern} onValueChange={(v) => setDiet("pattern", v as Inputs["preferences"]["pattern"])}>
                  <SelectTrigger id="pattern" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No restriction</SelectItem>
                    <SelectItem value="vegetarian">Vegetarian</SelectItem>
                    <SelectItem value="vegan">Vegan</SelectItem>
                    <SelectItem value="pescatarian">Pescatarian</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2 pb-2">
                <SwitchInline id="opt-gluten" label="Avoid gluten" checked={prefs.avoidGluten} onChange={(v) => setDiet("avoidGluten", v)} />
                <SwitchInline id="opt-dairy" label="Avoid dairy" checked={prefs.avoidDairy} onChange={(v) => setDiet("avoidDairy", v)} />
                <SwitchInline id="opt-nuts" label="Avoid nuts" checked={prefs.avoidNuts} onChange={(v) => setDiet("avoidNuts", v)} />
              </div>
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Allergens to avoid</legend>
              <div className="flex flex-wrap gap-2">
                {[...MAJOR_ALLERGENS, "gluten" as const].map((a) => {
                  const on = prefs.avoidAllergens.includes(a);
                  return (
                    <Chip key={a} on={on} onClick={() => setDiet("avoidAllergens", on ? prefs.avoidAllergens.filter((x) => x !== a) : [...prefs.avoidAllergens, a])}>
                      {ALLERGEN_LABELS[a]}
                    </Chip>
                  );
                })}
              </div>
            </fieldset>
            <div className="grid gap-4 md:grid-cols-3">
              <TagInput
                id="opt-excluded"
                label="Never include"
                hint="Ingredients to exclude, e.g. mushrooms."
                values={prefs.excludedIngredients}
                onChange={(v) => setDiet("excludedIngredients", v)}
                placeholder="Type and press Enter"
              />
              <TagInput
                id="opt-dislikes"
                label="Rather not"
                hint="Left out of generated plans; you can still add them yourself."
                values={prefs.dislikes}
                onChange={(v) => setDiet("dislikes", v)}
                placeholder="Type and press Enter"
              />
              <TagInput
                id="opt-preferred"
                label="Favorites"
                hint="The optimizer leans toward these."
                values={prefs.preferred}
                onChange={(v) => setDiet("preferred", v)}
                placeholder="Type and press Enter"
              />
            </div>
            {signedIn && (
              <p className="text-xs text-muted-foreground">
                Changes here apply to this plan only. To change your saved defaults, go to{" "}
                <Link href="/settings" className="font-medium text-primary hover:underline">
                  Settings
                </Link>
                .
              </p>
            )}
          </Group>

          <Group title="Extra weight" hint="Optional. Nutrients you'd like the optimizer to pay more attention to today (up to 8).">
            <div className="flex flex-wrap gap-2">
              {FOCUS_OPTIONS.map((id) => {
                const on = inputs.focus.includes(id);
                return (
                  <Chip
                    key={id}
                    on={on}
                    disabled={!on && inputs.focus.length >= 8}
                    onClick={() => set("focus", on ? inputs.focus.filter((x) => x !== id) : [...inputs.focus, id])}
                  >
                    {id === "sodium" ? "Less sodium" : plainName(id)}
                  </Chip>
                );
              })}
            </div>
          </Group>

          <Group title="Meal size">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="max-items">Items per meal, at most</Label>
                <Select value={String(inputs.maxItemsPerMeal)} onValueChange={(v) => set("maxItemsPerMeal", Number(v))}>
                  <SelectTrigger id="max-items" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[2, 3, 4, 5, 6].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} items
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="max-servings">Servings of one item, at most</Label>
                <Select value={String(inputs.maxServingsPerItem)} onValueChange={(v) => set("maxServingsPerItem", Number(v))}>
                  <SelectTrigger id="max-servings" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 1.5, 2, 3].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n === 1 ? "1 serving" : `${n} servings`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Group>
          <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.07] pt-4">
            <Button type="button" variant="ghost" size="sm" onClick={onReset}>
              Reset settings
            </Button>
            <p className="text-xs text-muted-foreground">
              {signedIn ? "Settings are remembered in this tab; your defaults come from Settings." : "Settings are remembered in this browser only."}
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button size="lg" className="rounded-full" onClick={onGenerate} disabled={busy || !enabledCount}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
          {busy ? "Building your plan…" : hasPlan ? "Generate a new plan" : "Generate plan"}
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {!anyServed
            ? "Nothing to plan for this day."
            : !enabledCount
              ? "Choose at least one meal."
              : lockedCount
                ? `${lockedCount} locked item${lockedCount === 1 ? "" : "s"} will stay in the plan.`
                : "Usually takes a second or two."}
        </p>
      </div>
    </Panel>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Chip({ on, onClick, disabled, children }: { on: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-sm ring-1 ring-border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50",
        on ? "bg-primary text-primary-foreground ring-primary" : "bg-background/60 hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function SwitchInline({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}

function MealToggle({
  availability,
  value,
  onChange,
}: {
  availability: PeriodAvailability;
  value: { enabled: boolean; locationIds: string[] };
  onChange: (v: { enabled: boolean; locationIds: string[] }) => void;
}) {
  const open = servable(availability);
  const closedOrMissing = availability.locations.filter((l) => !open.some((o) => o.id === l.id));
  const usable = open.length > 0;
  const chosen = value.locationIds.filter((id) => open.some((o) => o.id === id));
  const where = !chosen.length
    ? open.length === 1
      ? open[0].name
      : `Any of ${open.length} markets`
    : chosen.length === 1
      ? open.find((o) => o.id === chosen[0])!.name
      : `${chosen.length} markets`;
  const id = `meal-${availability.period}`;
  return (
    <div className={cn("grid gap-2 rounded-2xl p-3 ring-1 ring-border", value.enabled && usable && "bg-accent/40 ring-primary/40", !usable && "opacity-70")}>
      <div className="flex items-start gap-3">
        <Checkbox
          id={id}
          checked={value.enabled && usable}
          disabled={!usable}
          onCheckedChange={(c) => onChange({ ...value, enabled: c === true })}
          className="mt-0.5"
        />
        <Label htmlFor={id} className="grid gap-0.5 font-normal">
          <span className="font-medium">{availability.label}</span>
          <span className="text-xs text-muted-foreground">
            {usable
              ? `${open.length} market${open.length === 1 ? "" : "s"} with menus`
              : availability.locations.length
                ? "No menu available"
                : "Not served this day"}
          </span>
        </Label>
      </div>
      {usable && value.enabled && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 justify-start rounded-full" aria-label={`Where to eat ${availability.label.toLowerCase()}: ${where}`}>
              <MapPin aria-hidden="true" />
              <span className="truncate">{where}</span>
              <ChevronDown className="ml-auto opacity-60" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-3">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{availability.label}: where</legend>
              <p className="text-xs text-muted-foreground">Each meal comes from one market. Leave all unchecked to let the optimizer choose.</p>
              {open.map((l) => {
                const cid = `${id}-${l.id}`;
                const on = chosen.includes(l.id);
                return (
                  <div key={l.id} className="flex items-start gap-2">
                    <Checkbox
                      id={cid}
                      checked={on}
                      onCheckedChange={(c) => onChange({ ...value, locationIds: c === true ? [...chosen, l.id] : chosen.filter((x) => x !== l.id) })}
                      className="mt-0.5"
                    />
                    <Label htmlFor={cid} className="grid gap-0.5 font-normal">
                      <span>{l.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {l.itemCount} items{l.hours ? ` · ${l.hours}` : ""}
                      </span>
                    </Label>
                  </div>
                );
              })}
              {closedOrMissing.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Not available: {closedOrMissing.map((l) => `${l.name} (${l.status === "closed" ? "closed" : "no menu"})`).join(", ")}
                </p>
              )}
              {chosen.length > 0 && (
                <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => onChange({ ...value, locationIds: [] })}>
                  Any market
                </Button>
              )}
            </fieldset>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

