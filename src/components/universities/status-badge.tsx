import type { DisplayIntegrationStatus } from "@/db/schema";
import { cn } from "@/lib/utils";

export const INTEGRATION_LABELS: Record<DisplayIntegrationStatus, { label: string; dot: string; detail: string }> = {
  live: {
    label: "Menus sync automatically",
    dot: "bg-conf-high",
    detail: "Menus are retrieved on a schedule with the menu provider's permission.",
  },
  unofficial_sync: {
    label: "Synced from public menus",
    dot: "bg-conf-medium",
    detail:
      "Menus are copied daily from the dining operator's public Nutrislice menus. This is not an official integration and isn't endorsed by the university or Nutrislice.",
  },
  import_only: {
    label: "Approved imports",
    dot: "bg-conf-medium",
    detail: "Menus are loaded by an administrator from data files the dining operator approved.",
  },
  pending_authorization: {
    label: "Menu sync off",
    dot: "bg-conf-low",
    detail: "Automatic retrieval is off. Menus can be loaded from imported menu files.",
  },
  demo: {
    label: "Demo campus",
    dot: "bg-primary",
    detail: "Fictional dining halls with menus generated from USDA-based recipes, for trying the app.",
  },
  inactive: {
    label: "Not active",
    dot: "bg-muted-foreground/50",
    detail: "This university isn't currently offered.",
  },
};

export function IntegrationBadge({ status, className }: { status: DisplayIntegrationStatus; className?: string }) {
  const s = INTEGRATION_LABELS[status];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full bg-background/70 px-2.5 text-xs font-medium ring-1 ring-border", className)}>
      <span className={cn("size-2 rounded-full", s.dot)} aria-hidden="true" />
      {s.label}
    </span>
  );
}
