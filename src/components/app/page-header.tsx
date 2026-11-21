import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-1.5 text-xs font-semibold tracking-[0.14em] text-primary uppercase">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-pretty text-muted-foreground md:text-base">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Frosted panel used for the main content blocks of app pages. */
export function Panel({ className, children, as: As = "section", ...rest }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={cn("glass rounded-3xl p-4 md:p-6", className)} {...rest}>
      {children}
    </As>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-foreground/15 px-6 py-10 text-center">
      {icon && <div className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">{icon}</div>}
      <div>
        <p className="font-medium">{title}</p>
        {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
      </div>
      {action}
    </div>
  );
}
