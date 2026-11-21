"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { servingsText } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Accessible numeric stepper for servings. */
export function Stepper({
  value,
  onChange,
  step = 0.5,
  min = 0.5,
  max = 6,
  label,
  size = "default",
  disabled,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  /** Accessible name, e.g. "Servings of Tomato soup". */
  label: string;
  size?: "default" | "sm";
  disabled?: boolean;
  className?: string;
}) {
  const round = (v: number) => Math.round(v / step) * step;
  const dec = () => onChange(Math.max(min, round(value - step)));
  const inc = () => onChange(Math.min(max, round(value + step)));
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex items-center rounded-full bg-muted/80 p-0.5 ring-1 ring-foreground/5", className)}
    >
      <Button
        type="button"
        variant="ghost"
        size={size === "sm" ? "icon-xs" : "icon-sm"}
        className="rounded-full"
        onClick={dec}
        disabled={disabled || value <= min}
        aria-label="Decrease servings"
      >
        <Minus aria-hidden="true" />
      </Button>
      <output
        aria-live="polite"
        className={cn("min-w-9 text-center font-semibold tabular-nums", size === "sm" ? "text-xs" : "text-sm")}
      >
        {servingsText(value)}
      </output>
      <Button
        type="button"
        variant="ghost"
        size={size === "sm" ? "icon-xs" : "icon-sm"}
        className="rounded-full"
        onClick={inc}
        disabled={disabled || value >= max}
        aria-label="Increase servings"
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}
