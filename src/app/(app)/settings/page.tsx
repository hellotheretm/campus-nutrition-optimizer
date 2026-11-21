import { PartyPopper } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader, Panel } from "@/components/app/page-header";
import { AccountPanel } from "@/components/settings/account-panel";
import { ProfileForm } from "@/components/settings/profile-form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth";
import { listUniversities } from "@/lib/data/catalog";
import { getProfile } from "@/lib/data/user";

export const metadata: Metadata = {
  title: "Settings",
  description: "Profile, nutrition references, food preferences and account settings.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        description="Your profile, nutrition references, food preferences and account. Everything here is optional, and only you can see it."
      />
      <Suspense
        fallback={
          <div className="grid gap-6" aria-busy="true" aria-label="Loading settings">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-48 rounded-3xl" />
            ))}
          </div>
        }
      >
        <SettingsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function SettingsContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const user = await requireUser("/settings");
  const profile = await getProfile(user.id);
  const universities = await listUniversities();
  const welcome = (Array.isArray(sp.welcome) ? sp.welcome[0] : sp.welcome) === "1";
  const devOutbox = !process.env.SMTP_URL && process.env.NODE_ENV !== "production";

  return (
    <div className="grid gap-6">
      {welcome && (
        <Panel aria-labelledby="welcome-heading" className="glass-strong flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <PartyPopper className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="welcome-heading" className="font-semibold">
              Welcome! Your account is ready.
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick your university and any food preferences below, or skip this and start right away. The diary and the optimizer work
              independently, so use whichever helps.
              {!user.emailVerified && " We also sent a link to verify your email."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" className="rounded-full">
              <Link href="/diary">Open the diary</Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="rounded-full">
              <Link href="/optimizer">Plan meals</Link>
            </Button>
          </div>
        </Panel>
      )}
      <ProfileForm
        initial={profile}
        universities={universities.map((u) => ({ id: u.id, name: u.name, isDemo: u.isDemo }))}
      />
      <AccountPanel email={user.email} emailVerified={user.emailVerified} devOutbox={devOutbox} />
    </div>
  );
}
