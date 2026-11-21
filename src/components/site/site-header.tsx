"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/menus", label: "Menus" },
  { href: "/optimizer", label: "Optimizer" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#transparency", label: "Our data" },
  { href: "/universities", label: "Universities" },
];

/** Floating glass navigation for the marketing page; turns opaque after scrolling past the hero. */
export function SiteHeader({ account }: { account: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 md:px-6 md:pt-4">
      <div
        data-scrolled={scrolled}
        className={cn(
          "group/nav mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 rounded-2xl px-3 transition-all duration-300 md:h-16 md:px-5",
          scrolled ? "glass-strong text-foreground" : "glass-dark text-white",
        )}
      >
        <Logo tone={scrolled ? "default" : "light"} />
        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className={cn(
                    "rounded-full px-3.5 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                    scrolled ? "text-foreground/75 hover:bg-foreground/5 hover:text-foreground" : "text-white/85 hover:bg-white/10 hover:text-white",
                  )}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-1.5">
          <div className="hidden items-center gap-1.5 sm:flex">{account}</div>
          <ThemeToggle className={cn("hidden sm:inline-flex", !scrolled && "text-white hover:bg-white/10 hover:text-white")} />
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("lg:hidden", !scrolled && "text-white hover:bg-white/10 hover:text-white")}
                aria-label="Open menu"
              >
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[min(20rem,90vw)]">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
                <SheetDescription className="sr-only">Site navigation</SheetDescription>
              </SheetHeader>
              <nav aria-label="Mobile" className="px-4">
                <ul className="grid gap-1">
                  {LINKS.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="flex h-11 items-center rounded-xl px-3 text-sm font-medium hover:bg-muted">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                  <li>
                    <Link href="/request-university" className="flex h-11 items-center rounded-xl px-3 text-sm font-medium hover:bg-muted">
                      Request a university
                    </Link>
                  </li>
                </ul>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
                  {account}
                  <ThemeToggle withLabel />
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
