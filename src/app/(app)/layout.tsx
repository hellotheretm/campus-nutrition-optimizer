import { Suspense, type ReactNode } from "react";
import { AccountSlot, AccountSlotSkeleton } from "@/components/app/account-slot";
import { AppSidebar } from "@/components/app/app-sidebar";
import { MobileBottomNav, MobileTopBar } from "@/components/app/mobile-nav";

/**
 * Shell for the app pages: glass sidebar on desktop, top bar plus bottom
 * navigation on phones. The session is only read inside the Suspense'd
 * account slots, so the shell itself renders instantly.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-canvas min-h-dvh md:flex">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <AppSidebar
        account={
          <Suspense fallback={<AccountSlotSkeleton variant="sidebar" />}>
            <AccountSlot variant="sidebar" />
          </Suspense>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar
          account={
            <Suspense fallback={<AccountSlotSkeleton variant="compact" />}>
              <AccountSlot variant="compact" />
            </Suspense>
          }
        />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-28 outline-none md:px-8 md:pt-8 md:pb-12">
          {children}
        </main>
      </div>
      <MobileBottomNav
        more={
          <Suspense fallback={<AccountSlotSkeleton variant="sheet" />}>
            <AccountSlot variant="sheet" />
          </Suspense>
        }
      />
    </div>
  );
}
