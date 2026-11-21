"use client";

import { ChevronDown, ExternalLink, Info, Loader2, MapPin, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { Panel } from "@/components/app/page-header";
import { DateNav } from "@/components/common/date-nav";
import { TagInput } from "@/components/settings/tag-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { plainName } from "@/lib/format";
import { ALLERGEN_LABELS, MAJOR_ALLERGENS } from "@/lib/menus/labels";
import type { NutrientId } from "@/lib/nutrition/nutrients";
import { AGE_GROUP_LABELS, goalsAllowed, type AgeGroup } from "@/lib/nutrition/references";
import { GOAL_MODES, KCAL_PER_GRAM, macroCalories, MACRO_TOLERANCES, STRATEGIES, STRATEGY_KEYS, type GoalMode, type StrategyKey } from "@/lib/optimizer/types";
import { cn } from "@/lib/utils";
import { servable, type Inputs, type OptimizerUniversity, type PeriodAvailability, type StrictTargets } from "./shared";

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

function numOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

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
  const adult = goalsAllowed(inputs.reference.ageGroup);
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
    inputs.reference.standard === "dri" ? `DRIs, ${AGE_GROUP_LABELS[inputs.reference.ageGroup].toLowerCase()}` : "FDA Daily Values",
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

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-medium">What to aim for</legend>
        <RadioGroup
          value={inputs.goalMode}
          onValueChange={(v) => set("goalMode", v as GoalMode)}
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
          aria-label="Goal mode"
        >
          {(Object.keys(GOAL_MODES) as GoalMode[]).map((m) => (
            <Label
              key={m}
              htmlFor={`mode-${m}`}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-2xl p-3 font-normal ring-1 ring-border transition-colors hover:bg-muted/60",
                inputs.goalMode === m && "bg-accent/60 ring-2 ring-primary/60",
              )}
            >
              <RadioGroupItem id={`mode-${m}`} value={m} className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="font-medium">{GOAL_MODES[m].label}</span>
                <span className="text-xs leading-snug text-muted-foreground">{GOAL_MODES[m].description}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>

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

      {inputs.goalMode === "daily" && adult && <StrictTargetsBox value={inputs.strict} onChange={(v) => set("strict", v)} />}

      {inputs.goalMode !== "balanced" && !(inputs.goalMode === "daily" && adult && inputs.strict.enabled) && (
        <div className="grid gap-3 rounded-2xl bg-muted/50 p-4">
          <p className="text-sm font-medium">Calorie and protein goals (optional)</p>
          {adult ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <NumberField id="kcal-min" label="Calories, at least" suffix="kcal" value={inputs.energyMin} onChange={(v) => set("energyMin", v)} min={600} max={6000} />
                <NumberField id="kcal-max" label="Calories, at most" suffix="kcal" value={inputs.energyMax} onChange={(v) => set("energyMax", v)} min={600} max={6000} />
                <NumberField id="protein-min" label="Protein, at least" suffix="g" value={inputs.proteinMin} onChange={(v) => set("proteinMin", v)} min={10} max={300} />
              </div>
              <p className="text-xs text-muted-foreground">Leave blank for no target. These are your own references; the app never sets a calorie deficit for you.</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {inputs.reference.ageGroup === "under_19"
                ? "Calorie and protein targets aren't used for people under 19. Plans focus on balanced, varied meals."
                : "Calorie and protein goals are offered to adults who choose an age group of 19 or older under More options. Plans still balance vitamins, minerals, protein and fiber without them."}
            </p>
          )}
        </div>
      )}

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

/**
 * Strict daily targets. Calories are always computed as 4 × protein + 9 × fat + 4 × carbs,
 * so the four numbers can't disagree; typing a calorie total adjusts carbs to match.
 */
function StrictTargetsBox({ value, onChange }: { value: StrictTargets; onChange: (v: StrictTargets) => void }) {
  const uid = useId();
  const [kcalDraft, setKcalDraft] = useState<string | null>(null);
  const { protein, fat, carbohydrate } = value;
  const complete = protein !== null && fat !== null && carbohydrate !== null;
  const kcal = complete ? macroCalories({ protein, fat, carbohydrate }) : null;
  const update = (patch: Partial<StrictTargets>) => onChange({ ...value, ...patch });

  function commitCalories(raw: string) {
    setKcalDraft(null);
    const target = numOrNull(raw);
    if (target === null || protein === null || fat === null) return;
    const carbs = Math.max(0, Math.round((target - protein * KCAL_PER_GRAM.protein - fat * KCAL_PER_GRAM.fat) / KCAL_PER_GRAM.carbohydrate));
    update({ carbohydrate: carbs });
  }

  const share = (grams: number, perGram: number) => (kcal ? Math.round(((grams * perGram) / kcal) * 100) : 0);

  return (
    <div className="grid gap-3 rounded-2xl bg-muted/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor={`${uid}-on`} className="text-sm font-medium">
            Strict calorie and macro targets
          </Label>
          <p id={`${uid}-hint`} className="text-xs text-muted-foreground">
            The plan must land within your tolerance on all four, as close to exact as the menus allow.
          </p>
        </div>
        <Switch id={`${uid}-on`} aria-describedby={`${uid}-hint`} checked={value.enabled} onCheckedChange={(enabled) => update({ enabled })} />
      </div>
      {value.enabled && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor={`${uid}-kcal`}>Calories</Label>
              <div className="relative">
                <Input
                  id={`${uid}-kcal`}
                  type="number"
                  inputMode="numeric"
                  min={1000}
                  max={6000}
                  value={kcalDraft ?? (kcal !== null ? Math.round(kcal) : "")}
                  onChange={(e) => setKcalDraft(e.target.value)}
                  onBlur={(e) => commitCalories(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitCalories(e.currentTarget.value);
                  }}
                  aria-describedby={`${uid}-kcal-hint`}
                  placeholder="Auto"
                  className="pr-12"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">kcal</span>
              </div>
            </div>
            <NumberField id={`${uid}-p`} label="Protein" suffix="g" value={protein} onChange={(v) => update({ protein: v })} min={20} max={400} placeholder="Grams" />
            <NumberField id={`${uid}-f`} label="Fat" suffix="g" value={fat} onChange={(v) => update({ fat: v })} min={10} max={300} placeholder="Grams" />
            <NumberField id={`${uid}-c`} label="Carbs" suffix="g" value={carbohydrate} onChange={(v) => update({ carbohydrate: v })} min={20} max={900} placeholder="Grams" />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor={`${uid}-tol`} className="text-sm">
                Tolerance
              </Label>
              <Select value={String(value.tolerancePct)} onValueChange={(v) => update({ tolerancePct: Number(v) as StrictTargets["tolerancePct"] })}>
                <SelectTrigger id={`${uid}-tol`} className="h-8 w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MACRO_TOLERANCES.map((t) => (
                    <SelectItem key={t} value={String(t)}>
                      ±{t}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p id={`${uid}-kcal-hint`} className="min-w-0 text-xs text-muted-foreground" aria-live="polite">
              {complete
                ? `${protein} g × 4 + ${fat} g × 9 + ${carbohydrate} g × 4 = ${Math.round(kcal!).toLocaleString("en-US")} kcal · protein ${share(protein, 4)}%, fat ${share(fat, 9)}%, carbs ${share(carbohydrate, 4)}% of calories`
                : "Enter protein and fat, then either carbs or a calorie total (carbs fill in to match)."}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            These are your own targets; the app never sets a calorie deficit for you. Items without known calories and macros
            aren&apos;t used, and food labels round their numbers, so totals can differ slightly from 4/9/4 math.
          </p>
        </>
      )}
    </div>
  );
}

function NumberField({
  id,
  label,
  suffix,
  value,
  onChange,
  min,
  max,
  placeholder,
}: {
  id: string;
  label: string;
  suffix: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value ?? ""}
          onChange={(e) => onChange(numOrNull(e.target.value))}
          placeholder={placeholder ?? "No target"}
          className="pr-12"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">{suffix}</span>
      </div>
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

