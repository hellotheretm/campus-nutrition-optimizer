"use client";

import { LoaderCircle, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import {
  deleteSavedMealAction,
  logFavoriteAction,
  logFoodAction,
  logSavedMealAction,
  myFoodsAction,
  type MyFoods,
} from "@/app/actions/diary";
import { Stepper } from "@/components/common/stepper";
import { DIARY_MEALS, type DiaryMealKey } from "@/components/diary/log-food-dialog";
import { ConfidenceBadge } from "@/components/nutrition/badges";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDate } from "@/lib/dates";
import { fmtKcal, servingsText } from "@/lib/format";
import type { Confidence } from "@/lib/nutrition/estimator";
import { cn } from "@/lib/utils";

type Status = "logged" | "planned";

interface Ctx {
  date: string;
  meal: DiaryMealKey;
  status: Status;
  onAdded: (name: string) => void;
}

interface DiningResult {
  id: string;
  name: string;
  servingLabel: string;
  energy: number | null;
  confidence: Confidence;
}

interface UsdaResult {
  fdcId: number;
  description: string;
  source: string;
  category: string | null;
  energyPer100g: number | null;
  portions: { description: string; grams: number }[];
}

type University = { id: string; name: string; isDemo: boolean } | null;

/** Debounced search against /api/foods/search. Results only show while the query is 2+ characters. */
function useFoodSearch<T>(base: string | null) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (!base || term.length < 2) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${base}&q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { results: T[] };
        setResults(json.results);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Search isn’t available right now. Try again in a moment.");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [base, q]);

  const active = Boolean(base) && q.trim().length >= 2;
  return { q, setQ, results: active ? results : [], loading: active && loading, error: active ? error : null, active };
}

export function AddFoodDialog({
  open,
  onOpenChange,
  date,
  today,
  meal,
  onMealChange,
  university,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  today: string;
  meal: DiaryMealKey;
  onMealChange: (meal: DiaryMealKey) => void;
  university: University;
}) {
  const [status, setStatus] = useState<Status>(date > today ? "planned" : "logged");
  const [tab, setTab] = useState("dining");
  const [mine, setMine] = useState<MyFoods | null>(null);
  const [mineError, setMineError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    myFoodsAction()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setMine(res.data);
          setMineError(null);
        } else setMineError(res.error);
      })
      .catch(() => {
        if (!cancelled) setMineError("Couldn’t load your saved foods.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, version]);

  const mealLabel = DIARY_MEALS.find((m) => m.key === meal)?.label ?? "Meal";
  const ctx: Ctx = {
    date,
    meal,
    status,
    onAdded: (name) =>
      toast.success(status === "planned" ? "Added to your plan" : "Logged", { description: `${name} · ${mealLabel}` }),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(46rem,calc(100dvh-2rem))] flex-col gap-4 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add food</DialogTitle>
          <DialogDescription>{formatDate(date, "long")}. Search dining-hall dishes or USDA foods, or enter your own.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="add-meal" className="text-xs">
              Meal
            </Label>
            <Select value={meal} onValueChange={(v) => onMealChange(v as DiaryMealKey)}>
              <SelectTrigger id="add-meal" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIARY_MEALS.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <span id="add-status" className="text-xs font-medium">
              Status
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              value={status}
              onValueChange={(v) => v && setStatus(v as Status)}
              aria-labelledby="add-status"
              className="grid w-full grid-cols-2"
            >
              <ToggleGroupItem value="logged">I ate this</ToggleGroupItem>
              <ToggleGroupItem value="planned">Planning to</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="dining" className="px-1 text-xs sm:text-sm">Dining</TabsTrigger>
            <TabsTrigger value="usda" className="px-1 text-xs sm:text-sm">USDA</TabsTrigger>
            <TabsTrigger value="custom" className="px-1 text-xs sm:text-sm">Custom</TabsTrigger>
            <TabsTrigger value="favorites" className="px-1 text-xs sm:text-sm">Favorites</TabsTrigger>
            <TabsTrigger value="saved" className="px-1 text-xs sm:text-sm">Meals</TabsTrigger>
          </TabsList>
          <div className="min-h-0 flex-1 overflow-y-auto px-0.5 pt-1 pb-1">
            <TabsContent value="dining">
              <DiningTab ctx={ctx} university={university} />
            </TabsContent>
            <TabsContent value="usda">
              <UsdaTab ctx={ctx} />
            </TabsContent>
            <TabsContent value="custom">
              <CustomTab ctx={ctx} />
            </TabsContent>
            <TabsContent value="favorites">
              <FavoritesTab ctx={ctx} mine={mine} error={mineError} />
            </TabsContent>
            <TabsContent value="saved">
              <SavedTab ctx={ctx} mine={mine} error={mineError} onChanged={() => setVersion((v) => v + 1)} />
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                      */
/* ------------------------------------------------------------------ */

function SearchField({
  id,
  label,
  value,
  onChange,
  placeholder,
  loading,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  loading: boolean;
}) {
  return (
    <div className="relative">
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="h-10 rounded-full pr-9 pl-9"
      />
      {loading && (
        <LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}

function Results({
  active,
  loading,
  error,
  count,
  hint,
  empty,
  children,
}: {
  active: boolean;
  loading: boolean;
  error: string | null;
  count: number;
  hint: string;
  empty: string;
  children: ReactNode;
}) {
  return (
    <>
      <p className="sr-only" aria-live="polite">
        {active && !loading ? `${count} result${count === 1 ? "" : "s"}` : ""}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : !active ? (
        <p className="text-sm text-muted-foreground">{hint}</p>
      ) : !loading && count === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid gap-1" aria-label="Search results">
          {children}
        </ul>
      )}
    </>
  );
}

function Pick({
  selected,
  onClick,
  title,
  detail,
  right,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  detail?: string;
  right?: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          selected && "bg-primary/8 ring-1 ring-primary/40",
        )}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{title}</span>
          {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
        </span>
        {right && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{right}</span>}
      </button>
    </li>
  );
}

function AddBar({
  title,
  detail,
  servings,
  onServings,
  onAdd,
  pending,
  disabled,
  children,
}: {
  title: string;
  detail?: string;
  servings: number;
  onServings: (v: number) => void;
  onAdd: () => void;
  pending: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="sticky bottom-0 z-10 grid gap-3 rounded-2xl bg-card p-3 shadow-lg ring-1 ring-border">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
      {children}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Servings</span>
          <Stepper value={servings} onChange={onServings} max={20} label={`Servings of ${title}`} />
        </div>
        <Button type="button" onClick={onAdd} disabled={pending || disabled}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
          Add
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                               */
/* ------------------------------------------------------------------ */

function DiningTab({ ctx, university }: { ctx: Ctx; university: University }) {
  const s = useFoodSearch<DiningResult>(university ? `/api/foods/search?source=dining&u=${encodeURIComponent(university.id)}` : null);
  const [sel, setSel] = useState<DiningResult | null>(null);
  const [servings, setServings] = useState(1);
  const [pending, start] = useTransition();

  function add() {
    if (!sel) return;
    start(async () => {
      const res = await logFoodAction(
        { kind: "menu", foodId: sel.id, servings, date: ctx.date, meal: ctx.meal, status: ctx.status },
        { refresh: true },
      );
      if (!res.ok) return void toast.error(res.error);
      ctx.onAdded(res.data.name);
      setSel(null);
      setServings(1);
    });
  }

  if (!university) {
    return (
      <p className="text-sm text-muted-foreground">
        Choose your university in{" "}
        <Link href="/settings" className="font-medium text-foreground underline underline-offset-4">
          Settings
        </Link>{" "}
        to search its dining-hall dishes.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <SearchField
        id="dining-search"
        label={`Search dishes served at ${university.name}`}
        value={s.q}
        onChange={s.setQ}
        placeholder="Search dishes, e.g. oatmeal or tofu"
        loading={s.loading}
      />
      <p className="text-xs text-muted-foreground">
        Dishes that have appeared on {university.name} menus{university.isDemo ? " (fictional demo data)" : ""}. The nutrition snapshot is
        saved with your entry.
      </p>
      <Results
        active={s.active}
        loading={s.loading}
        error={s.error}
        count={s.results.length}
        hint="Type at least two letters to search."
        empty="No dishes match. Try a shorter word, or use the USDA tab."
      >
        {s.results.map((r) => (
          <Pick
            key={r.id}
            selected={sel?.id === r.id}
            onClick={() => {
              setSel(r);
              setServings(1);
            }}
            title={r.name}
            detail={r.servingLabel}
            right={r.energy !== null ? fmtKcal(r.energy) : "kcal unknown"}
          />
        ))}
      </Results>
      {sel && (
        <AddBar
          title={sel.name}
          detail={`1 serving = ${sel.servingLabel}${sel.energy !== null ? ` · ${servingsText(servings)} serving${servings === 1 ? "" : "s"} ≈ ${fmtKcal(sel.energy * servings)}` : ""}`}
          servings={servings}
          onServings={setServings}
          onAdd={add}
          pending={pending}
        >
          <ConfidenceBadge confidence={sel.confidence} prefix="Micros" />
        </AddBar>
      )}
    </div>
  );
}

function UsdaTab({ ctx }: { ctx: Ctx }) {
  const s = useFoodSearch<UsdaResult>("/api/foods/search?source=usda");
  const [sel, setSel] = useState<UsdaResult | null>(null);
  const [portion, setPortion] = useState("100g");
  const [customGrams, setCustomGrams] = useState("");
  const [servings, setServings] = useState(1);
  const [pending, start] = useTransition();

  const grams = !sel
    ? null
    : portion === "100g"
      ? 100
      : portion === "custom"
        ? Number(customGrams)
        : (sel.portions[Number(portion.slice(1))]?.grams ?? null);
  const validGrams = grams !== null && Number.isFinite(grams) && grams >= 1 && grams <= 3000;
  const kcal = sel && grams !== null && validGrams && sel.energyPer100g !== null ? ((sel.energyPer100g * grams) / 100) * servings : null;

  function pick(r: UsdaResult) {
    setSel(r);
    setPortion(r.portions.length ? "p0" : "100g");
    setCustomGrams("");
    setServings(1);
  }

  function add() {
    if (!sel || grams === null || !validGrams) return;
    start(async () => {
      const res = await logFoodAction(
        {
          kind: "usda",
          fdcId: sel.fdcId,
          grams: Math.round(grams * 10) / 10,
          servings,
          date: ctx.date,
          meal: ctx.meal,
          status: ctx.status,
        },
        { refresh: true },
      );
      if (!res.ok) return void toast.error(res.error);
      ctx.onAdded(res.data.name);
      setSel(null);
    });
  }

  return (
    <div className="grid gap-3">
      <SearchField
        id="usda-search"
        label="Search USDA FoodData Central"
        value={s.q}
        onChange={s.setQ}
        placeholder="Search foods, e.g. banana or greek yogurt"
        loading={s.loading}
      />
      <p className="text-xs text-muted-foreground">
        Foods from USDA FoodData Central (Foundation Foods, SR Legacy and FNDDS). Good for snacks and anything not on a dining menu.
      </p>
      <Results
        active={s.active}
        loading={s.loading}
        error={s.error}
        count={s.results.length}
        hint="Type at least two letters to search."
        empty="No USDA foods match. Try a simpler name."
      >
        {s.results.map((r) => (
          <Pick
            key={r.fdcId}
            selected={sel?.fdcId === r.fdcId}
            onClick={() => pick(r)}
            title={r.description}
            detail={`${r.source}${r.category ? ` · ${r.category}` : ""}`}
            right={r.energyPer100g !== null ? `${Math.round(r.energyPer100g)} kcal/100 g` : undefined}
          />
        ))}
      </Results>
      {sel && (
        <AddBar
          title={sel.description}
          detail={kcal !== null ? `≈ ${fmtKcal(kcal)} for ${servingsText(servings)} serving${servings === 1 ? "" : "s"}` : undefined}
          servings={servings}
          onServings={setServings}
          onAdd={add}
          pending={pending}
          disabled={!validGrams}
        >
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <Select value={portion} onValueChange={setPortion}>
              <SelectTrigger aria-label="Serving size" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sel.portions.map((p, i) => (
                  <SelectItem key={i} value={`p${i}`}>
                    {p.description} ({Math.round(p.grams)} g)
                  </SelectItem>
                ))}
                <SelectItem value="100g">100 g</SelectItem>
                <SelectItem value="custom">Other amount (grams)</SelectItem>
              </SelectContent>
            </Select>
            {portion === "custom" && (
              <Input
                type="number"
                inputMode="decimal"
                min={1}
                max={3000}
                value={customGrams}
                onChange={(e) => setCustomGrams(e.target.value)}
                placeholder="Grams"
                aria-label="Grams per serving"
                aria-invalid={customGrams !== "" && !validGrams}
              />
            )}
          </div>
        </AddBar>
      )}
    </div>
  );
}

const CUSTOM_FIELDS = [
  { id: "energy", label: "Calories", unit: "kcal" },
  { id: "protein", label: "Protein", unit: "g" },
  { id: "carbohydrate", label: "Carbohydrate", unit: "g" },
  { id: "fat", label: "Fat", unit: "g" },
  { id: "fiber", label: "Fiber", unit: "g" },
  { id: "sugars", label: "Total sugars", unit: "g" },
  { id: "saturated_fat", label: "Saturated fat", unit: "g" },
  { id: "sodium", label: "Sodium", unit: "mg" },
  { id: "calcium", label: "Calcium", unit: "mg" },
  { id: "iron", label: "Iron", unit: "mg" },
  { id: "potassium", label: "Potassium", unit: "mg" },
  { id: "vitamin_d", label: "Vitamin D", unit: "µg" },
] as const;

function CustomTab({ ctx }: { ctx: Ctx }) {
  const [name, setName] = useState("");
  const [serving, setServing] = useState("1 serving");
  const [values, setValues] = useState<Record<string, string>>({});
  const [servings, setServings] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the food a name.");
    const nutrients: Record<string, number> = {};
    for (const f of CUSTOM_FIELDS) {
      const raw = (values[f.id] ?? "").trim();
      if (!raw) continue; // blank = unknown, never zero
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 100000) return setError(`${f.label} should be a number of zero or more.`);
      nutrients[f.id] = n;
    }
    setError(null);
    start(async () => {
      const res = await logFoodAction(
        {
          kind: "custom",
          name: name.trim(),
          servingLabel: serving.trim() || "1 serving",
          servings,
          nutrients,
          date: ctx.date,
          meal: ctx.meal,
          status: ctx.status,
        },
        { refresh: true },
      );
      if (!res.ok) return setError(res.error);
      ctx.onAdded(res.data.name);
      setName("");
      setValues({});
      setServings(1);
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="grid gap-1.5">
          <Label htmlFor="custom-name">Name</Label>
          <Input id="custom-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="custom-serving">Serving</Label>
          <Input id="custom-serving" value={serving} onChange={(e) => setServing(e.target.value)} maxLength={60} />
        </div>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Nutrition per serving</legend>
        <p className="text-xs text-muted-foreground">
          Leave a field blank if you don’t know it. Blanks are shown as unknown, never as zero. Your values are labeled “Entered by you”.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CUSTOM_FIELDS.map((f) => (
            <div key={f.id} className="grid gap-1">
              <Label htmlFor={`custom-${f.id}`} className="text-xs font-normal">
                {f.label} <span className="text-muted-foreground">({f.unit})</span>
              </Label>
              <Input
                id={`custom-${f.id}`}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={values[f.id] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                className="h-9"
              />
            </div>
          ))}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Servings</span>
          <Stepper value={servings} onChange={setServings} max={20} label="Servings of your custom food" />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
          Add
        </Button>
      </div>
    </form>
  );
}

function Loading() {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      Loading…
    </p>
  );
}

function FavoritesTab({ ctx, mine, error }: { ctx: Ctx; mine: MyFoods | null; error: string | null }) {
  const [selKey, setSelKey] = useState<string | null>(null);
  const [servings, setServings] = useState(1);
  const [pending, start] = useTransition();
  const fav = mine?.favorites.find((f) => f.foodKey === selKey) ?? null;

  function add() {
    if (!fav) return;
    start(async () => {
      const res = await logFavoriteAction(fav.foodKey, { servings, date: ctx.date, meal: ctx.meal, status: ctx.status });
      if (!res.ok) return void toast.error(res.error);
      ctx.onAdded(res.data.name);
      setSelKey(null);
      setServings(1);
    });
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!mine) return <Loading />;
  if (!mine.favorites.length) {
    return <p className="text-sm text-muted-foreground">No favorites yet. Use the heart on any food’s page to keep it here.</p>;
  }
  return (
    <div className="grid gap-3">
      <ul className="grid gap-1" aria-label="Favorites">
        {mine.favorites.map((f) => (
          <Pick
            key={f.foodKey}
            selected={selKey === f.foodKey}
            onClick={() => setSelKey(f.foodKey)}
            title={f.name}
            detail={f.foodKey.startsWith("usda:") ? "USDA FoodData Central · 100 g per serving" : "Dining hall · latest recipe version"}
          />
        ))}
      </ul>
      {fav && <AddBar title={fav.name} servings={servings} onServings={setServings} onAdd={add} pending={pending} />}
    </div>
  );
}

function SavedTab({ ctx, mine, error, onChanged }: { ctx: Ctx; mine: MyFoods | null; error: string | null; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  function add(id: string, name: string) {
    setBusy(id);
    start(async () => {
      const res = await logSavedMealAction(id, ctx.date, ctx.meal, ctx.status);
      setBusy(null);
      if (!res.ok) return void toast.error(res.error);
      ctx.onAdded(`${name} (${res.data.added} item${res.data.added === 1 ? "" : "s"})`);
      if (res.data.skipped.length) {
        toast.warning(`Skipped: ${res.data.skipped.join(", ")}`, { description: "These foods are no longer available." });
      }
    });
  }

  function remove(id: string) {
    setBusy(id);
    start(async () => {
      const res = await deleteSavedMealAction(id);
      setBusy(null);
      if (!res.ok) return void toast.error(res.error);
      onChanged();
    });
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!mine) return <Loading />;
  if (!mine.savedMeals.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No saved meals yet. Use “Save meal” on any meal in your diary to reuse it in one step.
      </p>
    );
  }
  return (
    <ul className="grid gap-2" aria-label="Saved meals">
      {mine.savedMeals.map((m) => (
        <li key={m.id} className="flex items-center justify-between gap-3 rounded-2xl p-3 ring-1 ring-border">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{m.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {m.items.map((i) => `${servingsText(i.servings)} × ${i.name}`).join(", ")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" onClick={() => add(m.id, m.name)} disabled={busy !== null}>
              {busy === m.id ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
              Add<span className="sr-only"> {m.name}</span>
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => remove(m.id)} disabled={busy !== null} aria-label={`Delete saved meal ${m.name}`}>
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
