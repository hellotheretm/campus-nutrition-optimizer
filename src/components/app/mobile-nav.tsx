"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { APP_NAV, MOBILE_PRIMARY, isActive } from "./nav-config";

export function MobileTopBar({ account }: { account: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 px-3 pt-3 md:hidden">
      <div className="glass flex h-14 items-center justify-between rounded-2xl px-3">
        <Logo href="/dashboard" />
        {account}
      </div>
    </header>
  );
}

/**
 * Bottom navigation on phones with a "More" sheet for the remaining pages.
 * The current path is runtime data, so it is read behind a Suspense
 * boundary; the fallback is the same bar without an active item.
 */
export function MobileBottomNav({ more }: { more: ReactNode }) {
  return (
    <Suspense fallback={<BottomNav more={more} pathname="" />}>
      <ActiveBottomNav more={more} />
    </Suspense>
  );
}

function ActiveBottomNav({ more }: { more: ReactNode }) {
  return <BottomNav more={more} pathname={usePathname()} />;
}

function BottomNav({ more, pathname }: { more: ReactNode; pathname: string }) {
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  // Closes automatically after navigating to another page.
  const open = openedAt === pathname;
  const setOpen = (o: boolean) => setOpenedAt(o ? pathname : null);
  const primary = APP_NAV.filter((i) => MOBILE_PRIMARY.includes(i.href));
  const secondary = APP_NAV.filter((i) => !MOBILE_PRIMARY.includes(i.href));
  const moreActive = secondary.some((i) => isActive(pathname, i));

  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
      <ul className="glass-strong grid h-16 grid-cols-5 items-stretch rounded-2xl px-1">
        {primary.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "m-1 flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium text-foreground/70 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active && "bg-primary/10 text-primary",
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                {item.label.replace("Meal optimizer", "Optimizer").replace("Food diary", "Diary")}
              </Link>
            </li>
          );
        })}
        <li className="flex">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              className={cn(
                "m-1 flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium text-foreground/70 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                moreActive && "bg-primary/10 text-primary",
              )}
            >
              <Ellipsis className="size-5" aria-hidden="true" />
              More
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              <SheetHeader>
                <SheetTitle>More</SheetTitle>
                <SheetDescription className="sr-only">Other pages and account options</SheetDescription>
              </SheetHeader>
              <ul className="grid gap-1 px-4">
                {secondary.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(pathname, item);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium hover:bg-muted",
                          active && "bg-primary/10 text-primary",
                        )}
                      >
                        <Icon className="size-5" aria-hidden="true" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
                <li>
                  <Link
                    href="/request-university"
                    onClick={() => setOpen(false)}
                    className="flex h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium hover:bg-muted"
                  >
                    <span className="grid size-5 place-items-center text-base" aria-hidden="true">
                      +
                    </span>
                    Request a university
                  </Link>
                </li>
              </ul>
              <div className="mt-2 flex items-center justify-between gap-2 border-t px-4 pt-4">
                {more}
                <ThemeToggle withLabel />
              </div>
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  );
}
