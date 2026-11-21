"use client";

import { LoaderCircle } from "lucide-react";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { saveProfileAction } from "@/app/actions/profile";
import { Panel } from "@/components/app/page-header";
import { TagInput } from "@/components/settings/tag-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ProfileData } from "@/lib/data/user";
import { ALLERGEN_LABELS, MAJOR_ALLERGENS } from "@/lib/menus/labels";
import { TargetsFields } from "@/components/nutrition/targets-fields";
import { AGE_GROUP_LABELS, type AgeGroup, type ReferenceSex } from "@/lib/nutrition/references";
import { resolveMacroTargets } from "@/lib/optimizer/types";
import { cn } from "@/lib/utils";

interface UniversityOption {
  id: string;
  name: string;
  isDemo: boolean;
}

const AGE_ORDER: AgeGroup[] = ["unspecified", "under_19", "19_30", "31_50", "51_70", "71_plus"];
const AGE_TEXT: Record<AgeGroup, string> = { ...AGE_GROUP_LABELS, under_19: "Under 19", unspecified: "Prefer not to say" };

function Section({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Panel aria-labelledby={id} className="grid gap-5">
      <div>
        <h2 id={id} className="font-semibold">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </Panel>
  );
}

function SwitchRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function ProfileForm({ initial, universities }: { initial: ProfileData; universities: UniversityOption[] }) {
  const [saved, setSaved] = useState(initial);
  const [p, setP] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(p) !== JSON.stringify(saved);

  const set = <K extends keyof ProfileData>(key: K, value: ProfileData[K]) => setP((cur) => ({ ...cur, [key]: value }));
  const setDiet = <K extends keyof ProfileData["dietary"]>(key: K, value: ProfileData["dietary"][K]) =>
    setP((cur) => ({ ...cur, dietary: { ...cur.dietary, [key]: value } }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const targetError = resolveMacroTargets(p.targets).error;
    if (targetError) return setError(targetError);
    setError(null);
    const payload: ProfileData = p;
    start(async () => {
      const res = await saveProfileAction(payload);
      if (!res.ok) return setError(res.error);
      setSaved(res.data);
      setP(res.data);
      toast.success("Settings saved");
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <Section id="profile-heading" title="Profile" description="Both fields are optional.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              value={p.displayName ?? ""}
              onChange={(e) => set("displayName", e.target.value || null)}
              maxLength={80}
              autoComplete="nickname"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="university">Your university</Label>
            <Select value={p.universityId ?? "none"} onValueChange={(v) => set("universityId", v === "none" ? null : v)}>
              <SelectTrigger id="university" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {universities.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                    {u.isDemo ? " (fictional demo)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Section>

      <Section
        id="reference-heading"
        title="Nutrition references"
        description="Percentages compare foods with a published reference. Age and sex only choose which reference values apply; both are optional and never shared."
      >
        <RadioGroup
          value={p.referenceStandard}
          onValueChange={(v) => set("referenceStandard", v as ProfileData["referenceStandard"])}
          className="grid gap-2 sm:grid-cols-2"
          aria-label="Reference standard"
        >
          {(
            [
              ["fda_dv", "FDA Daily Values", "The numbers behind “% Daily Value” on food labels. One set for everyone 4 and older."],
              ["dri", "Dietary Reference Intakes", "RDAs and AIs from the National Academies, by age group and sex."],
            ] as const
          ).map(([value, title, hint]) => (
            <Label
              key={value}
              htmlFor={`ref-${value}`}
              className="flex cursor-pointer items-start gap-2 rounded-xl p-3 ring-1 ring-border has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-primary/50"
            >
              <RadioGroupItem id={`ref-${value}`} value={value} className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs font-normal text-muted-foreground">{hint}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="age-group">Age group</Label>
            <Select value={p.ageGroup} onValueChange={(v) => set("ageGroup", v as AgeGroup)}>
              <SelectTrigger id="age-group" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGE_ORDER.map((a) => (
                  <SelectItem key={a} value={a}>
                    {AGE_TEXT[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sex">Sex for reference values</Label>
            <Select value={p.sex} onValueChange={(v) => set("sex", v as ReferenceSex)}>
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
        {p.ageGroup === "under_19" && (
          <p className="rounded-xl bg-muted/70 p-3 text-sm text-muted-foreground">
            For people under 19 the app uses reference values for ages 14–18.
          </p>
        )}
      </Section>

      <Section
        id="diet-heading"
        title="Food preferences"
        description="Used by the meal optimizer and to pre-fill menu filters. Allergen filtering relies on dining-hall labels and ingredient lists, which can be incomplete, so it is not a guarantee of safety."
      >
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="pattern">Eating pattern</Label>
          <Select value={p.dietary.pattern} onValueChange={(v) => setDiet("pattern", v as ProfileData["dietary"]["pattern"])}>
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
        <div className="grid gap-3 sm:grid-cols-3">
          <SwitchRow id="avoid-gluten" label="Avoid gluten" checked={p.dietary.avoidGluten} onChange={(v) => setDiet("avoidGluten", v)} />
          <SwitchRow id="avoid-dairy" label="Avoid dairy" checked={p.dietary.avoidDairy} onChange={(v) => setDiet("avoidDairy", v)} />
          <SwitchRow id="avoid-nuts" label="Avoid nuts" checked={p.dietary.avoidNuts} onChange={(v) => setDiet("avoidNuts", v)} />
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Allergens to avoid</legend>
          <div className="flex flex-wrap gap-2">
            {[...MAJOR_ALLERGENS, "gluten" as const].map((a) => {
              const on = p.dietary.avoidAllergens.includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setDiet("avoidAllergens", on ? p.dietary.avoidAllergens.filter((x) => x !== a) : [...p.dietary.avoidAllergens, a])
                  }
                  className={cn(
                    "rounded-full px-3 py-1.5 text-sm ring-1 ring-border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    on ? "bg-primary text-primary-foreground ring-primary" : "bg-background/60 hover:bg-muted",
                  )}
                >
                  {ALLERGEN_LABELS[a]}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-4 md:grid-cols-3">
          <TagInput
            id="excluded"
            label="Never include"
            hint="Ingredients to exclude, e.g. mushrooms."
            values={p.dietary.excludedIngredients}
            onChange={(v) => setDiet("excludedIngredients", v)}
            placeholder="Type and press Enter"
          />
          <TagInput
            id="dislikes"
            label="Rather not"
            hint="Left out of generated plans; you can still add them yourself."
            values={p.dietary.dislikes}
            onChange={(v) => setDiet("dislikes", v)}
            placeholder="Type and press Enter"
          />
          <TagInput
            id="preferred"
            label="Favorites"
            hint="Foods the optimizer should lean toward."
            values={p.dietary.preferred}
            onChange={(v) => setDiet("preferred", v)}
            placeholder="Type and press Enter"
          />
        </div>
      </Section>

      <Section
        id="goals-heading"
        title="Daily targets (optional)"
        description="Used as the starting targets in the meal optimizer and shown in the diary. You never need targets to use either."
      >
        <TargetsFields value={p.targets} onChange={(v) => set("targets", v)} />
        <p className="text-xs text-muted-foreground">
          The app never sets a calorie deficit for you. If you are working toward a medical, weight or sports goal, a registered
          dietitian can help choose numbers that fit you.
          {p.ageGroup === "under_19" && " Teens are still growing and need enough energy every day."}
        </p>
      </Section>

      <Section id="display-heading" title="Display">
        <div className="grid gap-4">
          <SwitchRow
            id="show-calories"
            label="Show calories"
            hint="Turn off to hide calorie numbers across menus, the diary and plans."
            checked={p.showCalories}
            onChange={(v) => set("showCalories", v)}
          />
          <SwitchRow
            id="show-percent"
            label="Show percentages of reference values"
            checked={p.showPercentages}
            onChange={(v) => set("showPercentages", v)}
          />
        </div>
      </Section>

      <div className={cn("glass-strong z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3", (dirty || error) && "sticky bottom-24 md:bottom-4")}>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {error ? <span className="text-destructive">{error}</span> : dirty ? "You have unsaved changes." : "All changes saved."}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => setP(saved)} disabled={!dirty || pending}>
            Reset
          </Button>
          <Button type="submit" disabled={!dirty || pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            Save settings
          </Button>
        </div>
      </div>
    </form>
  );
}
