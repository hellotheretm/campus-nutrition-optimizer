"use client";

import { CircleCheck, CircleQuestionMark, Database, FlaskConical, Scale } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CONFIDENCE_DESCRIPTIONS,
  CONFIDENCE_LABELS,
  METHOD_DESCRIPTIONS,
  METHOD_LABELS,
  PROVENANCE_DESCRIPTIONS,
  PROVENANCE_LABELS,
  type Confidence,
  type EstimationMethod,
  type Provenance,
} from "@/lib/nutrition/provenance";
import type { Freshness } from "@/lib/menus/freshness";
import { cn } from "@/lib/utils";

const CONF_CLASS: Record<Confidence, string> = {
  high: "text-conf-high bg-conf-high/10 ring-conf-high/30",
  medium: "text-conf-medium bg-conf-medium/10 ring-conf-medium/30",
  low: "text-conf-low bg-conf-low/10 ring-conf-low/30",
  none: "text-muted-foreground bg-muted ring-border",
};

const CONF_SHORT: Record<Confidence, string> = { high: "High", medium: "Medium", low: "Low", none: "No data" };
const CONF_LEVEL: Record<Confidence, number> = { high: 3, medium: 2, low: 1, none: 0 };

function SignalBars({ level }: { level: number }) {
  return (
    <span className="inline-flex items-end gap-[2px]" aria-hidden="true">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn("w-[3px] rounded-[1px] bg-current", i <= level ? "opacity-100" : "opacity-25")}
          style={{ height: 3 + i * 2.5 }}
        />
      ))}
    </span>
  );
}

function Hint({ children, content, label }: { children: ReactNode; content: ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={label}
          className="inline-flex rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-pretty">{content}</TooltipContent>
    </Tooltip>
  );
}

export function ConfidenceBadge({
  confidence,
  className,
  prefix,
  long = false,
}: {
  confidence: Confidence;
  className?: string;
  /** Visible prefix such as "Micros". */
  prefix?: string;
  long?: boolean;
}) {
  const text = long ? CONFIDENCE_LABELS[confidence] : CONF_SHORT[confidence];
  return (
    <Hint content={CONFIDENCE_DESCRIPTIONS[confidence]}>
      <span
        className={cn(
          "inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset",
          CONF_CLASS[confidence],
          className,
        )}
      >
        <SignalBars level={CONF_LEVEL[confidence]} />
        {prefix && <span className="text-foreground/70">{prefix}:</span>}
        {text}
        {!long && confidence !== "none" && <span className="sr-only"> confidence</span>}
      </span>
    </Hint>
  );
}

const PROV_ICON: Record<Provenance, ComponentType<{ className?: string }>> = {
  official: CircleCheck,
  usda_match: Database,
  usda_recipe: FlaskConical,
  approximate: Scale,
  unknown: CircleQuestionMark,
};

const PROV_CLASS: Record<Provenance, string> = {
  official: "text-prov-official",
  usda_match: "text-prov-match",
  usda_recipe: "text-prov-recipe",
  approximate: "text-prov-approx",
  unknown: "text-prov-unknown",
};

export function ProvenanceBadge({ provenance, className, iconOnly = false }: { provenance: Provenance; className?: string; iconOnly?: boolean }) {
  const Icon = PROV_ICON[provenance];
  return (
    <Hint content={<><strong className="font-semibold">{PROVENANCE_LABELS[provenance]}.</strong> {PROVENANCE_DESCRIPTIONS[provenance]}</>} label={iconOnly ? PROVENANCE_LABELS[provenance] : undefined}>
      <span
        className={cn(
          "inline-flex h-5 items-center gap-1 rounded-full bg-muted/70 px-2 text-[11px] font-medium whitespace-nowrap",
          iconOnly && "px-1",
          PROV_CLASS[provenance],
          className,
        )}
      >
        <Icon className="size-3" aria-hidden="true" />
        {!iconOnly && PROVENANCE_LABELS[provenance]}
      </span>
    </Hint>
  );
}

export function MethodBadge({ method, className }: { method: EstimationMethod | null; className?: string }) {
  const m = method ?? "none";
  return (
    <Hint content={METHOD_DESCRIPTIONS[m]}>
      <span className={cn("inline-flex h-5 items-center rounded-full bg-muted/70 px-2 text-[11px] font-medium text-muted-foreground", className)}>
        {METHOD_LABELS[m]}
      </span>
    </Hint>
  );
}

const FRESH_CLASS: Record<Freshness, string> = {
  current: "bg-conf-high",
  cached: "bg-conf-medium",
  unavailable: "bg-muted-foreground/50",
};

export function FreshnessBadge({ state, label, detail, className }: { state: Freshness; label: string; detail: string; className?: string }) {
  return (
    <Hint content={detail}>
      <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full bg-background/70 px-2.5 text-xs font-medium ring-1 ring-border", className)}>
        <span className={cn("size-2 rounded-full", FRESH_CLASS[state])} aria-hidden="true" />
        <span className="sr-only">{state === "current" ? "Current menu:" : state === "cached" ? "Cached menu:" : "Menu unavailable:"}</span>
        {label}
      </span>
    </Hint>
  );
}
