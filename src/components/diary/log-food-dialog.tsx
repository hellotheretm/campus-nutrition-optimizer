"use client";

import { LoaderCircle, NotebookPen } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { logFoodAction } from "@/app/actions/diary";
import { Stepper } from "@/components/common/stepper";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export type DiaryMealKey = "breakfast" | "lunch" | "dinner" | "snack";

export const DIARY_MEALS: { key: DiaryMealKey; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
  { key: "snack", label: "Snack" },
];

export function mealForPeriod(period: string | null | undefined): DiaryMealKey {
  switch (period) {
    case "breakfast":
      return "breakfast";
    case "brunch":
    case "lunch":
      return "lunch";
    case "dinner":
      return "dinner";
    default:
      return "snack";
  }
}

export function LogFoodButton({
  food,
  date,
  period,
  locationName,
  signedIn,
  today,
  className,
  size = "sm",
  label = "Log",
}: {
  food: { id: string; name: string; servingLabel: string };
  date: string;
  period?: string | null;
  locationName?: string | null;
  signedIn: boolean;
  today: string;
  className?: string;
  size?: "sm" | "default" | "lg";
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const [servings, setServings] = useState(1);
  const [meal, setMeal] = useState<DiaryMealKey>(mealForPeriod(period));
  const [status, setStatus] = useState<"logged" | "planned">(date > today ? "planned" : "logged");
  const [pending, start] = useTransition();
  const here = `${pathname}${search.size ? `?${search.toString()}` : ""}`;

  function submit() {
    start(async () => {
      const res = await logFoodAction({
        kind: "menu",
        foodId: food.id,
        servings,
        date,
        meal,
        status,
        locationName: locationName ?? null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success(status === "planned" ? "Added to your plan" : "Logged", {
        description: `${food.name} · ${formatDate(date, "medium")}`,
        action: { label: "Open diary", onClick: () => router.push(`/diary?date=${date}`) },
      });
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size={size} className={cn("rounded-full", className)}>
          <NotebookPen aria-hidden="true" />
          {label}
          <span className="sr-only"> {food.name}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {!signedIn ? (
          <>
            <DialogHeader>
              <DialogTitle>Sign in to use the food diary</DialogTitle>
              <DialogDescription>
                Your diary is private to your account. Browsing menus and the optimizer work without one.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:justify-start">
              <Button asChild>
                <Link href={`/login?next=${encodeURIComponent(here)}`}>Sign in</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/signup?next=${encodeURIComponent(here)}`}>Create an account</Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{food.name}</DialogTitle>
              <DialogDescription>
                {formatDate(date, "long")}
                {locationName ? ` · ${locationName}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Servings</p>
                  <p className="text-xs text-muted-foreground">1 serving = {food.servingLabel}</p>
                </div>
                <Stepper value={servings} onChange={setServings} label={`Servings of ${food.name}`} />
              </div>
              <div className="grid gap-2">
                <p className="text-sm font-medium" id="log-meal-label">
                  Meal
                </p>
                <ToggleGroup
                  type="single"
                  value={meal}
                  onValueChange={(v) => v && setMeal(v as DiaryMealKey)}
                  aria-labelledby="log-meal-label"
                  className="grid w-full grid-cols-4"
                  variant="outline"
                >
                  {DIARY_MEALS.map((m) => (
                    <ToggleGroupItem key={m.key} value={m.key} className="text-xs">
                      {m.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <RadioGroup value={status} onValueChange={(v) => setStatus(v as "logged" | "planned")} className="grid grid-cols-2 gap-2" aria-label="Status">
                {(
                  [
                    ["logged", "I ate this", "Counts toward the day's totals"],
                    ["planned", "Planning to eat", "Shown separately until you mark it eaten"],
                  ] as const
                ).map(([v, title, hint]) => (
                  <Label
                    key={v}
                    htmlFor={`status-${v}`}
                    className="flex cursor-pointer items-start gap-2 rounded-xl p-3 ring-1 ring-border has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-primary/50"
                  >
                    <RadioGroupItem id={`status-${v}`} value={v} className="mt-0.5" />
                    <span className="grid gap-0.5">
                      <span className="text-sm font-medium">{title}</span>
                      <span className="text-xs font-normal text-muted-foreground">{hint}</span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </div>
            <DialogFooter>
              <Button type="button" onClick={submit} disabled={pending} className="w-full sm:w-auto">
                {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                {status === "planned" ? "Add to plan" : "Add to diary"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
