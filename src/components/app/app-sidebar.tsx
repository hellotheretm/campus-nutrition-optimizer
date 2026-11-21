"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocalSetting } from "@/hooks/use-local-setting";
import { cn } from "@/lib/utils";
import { APP_NAV, isActive } from "./nav-config";

/** Desktop navigation: a floating glass sidebar that collapses to icons. */
export function AppSidebar({ account }: { account: ReactNode }) {
  const [state, setState] = useLocalSetting("cno.sidebar", "expanded");
  const collapsed = state === "collapsed";

  return (
    <aside
      data-collapsed={collapsed}
      className="group/sidebar sticky top-0 z-30 hidden h-dvh w-[17rem] shrink-0 p-3 transition-[width] duration-200 ease-out data-[collapsed=true]:w-[5.25rem] md:block"
    >
      <div className="glass flex h-full flex-col rounded-3xl px-2.5 py-3">
        <div className="flex h-12 items-center px-1.5">
          <Logo href="/dashboard" compact={collapsed} />
        </div>

        <nav aria-label="Main" className="mt-4 flex-1 overflow-y-auto">
          <Suspense fallback={<SidebarLinks pathname="" collapsed={collapsed} />}>
            <ActiveSidebarLinks collapsed={collapsed} />
          </Suspense>
        </nav>

        <div className="mt-3 flex flex-col gap-2 border-t border-foreground/10 pt-3">
          {account}
          <div className={cn("flex items-center", collapsed ? "flex-col gap-1" : "justify-between")}>
            <ThemeToggle />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setState(collapsed ? "expanded" : "collapsed")}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
            >
              {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function ActiveSidebarLinks({ collapsed }: { collapsed: boolean }) {
  return <SidebarLinks pathname={usePathname()} collapsed={collapsed} />;
}

function SidebarLinks({ pathname, collapsed }: { pathname: string; collapsed: boolean }) {
  return (
    <ul className="flex flex-col gap-1">
      {APP_NAV.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        const link = (
          <Link
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-foreground/75 transition-colors outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
              active && "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            <Icon className="size-[18px] shrink-0" aria-hidden="true" />
            <span className={cn(collapsed && "sr-only")}>{item.label}</span>
          </Link>
        );
        return (
          <li key={item.href}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ) : (
              link
            )}
          </li>
        );
      })}
    </ul>
  );
}
