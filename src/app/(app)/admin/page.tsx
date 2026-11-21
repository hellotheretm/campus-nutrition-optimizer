import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ReestimateButton, RequestStatusSelect, SyncButton } from "@/components/admin/admin-controls";
import { ImportPanel } from "@/components/admin/import-panel";
import { EmptyState, PageHeader, Panel } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IntegrationBadge } from "@/components/universities/status-badge";
import { isAdmin, requireUser } from "@/lib/auth";
import { countOutdatedEstimates, listSyncRuns } from "@/lib/data/admin";
import { listLocations, listUniversities } from "@/lib/data/catalog";
import { listUniversityRequests } from "@/lib/data/requests";
import { formatDate, timeAgo } from "@/lib/dates";
import { ESTIMATOR_VERSION } from "@/lib/nutrition/estimator";

export const metadata: Metadata = {
  title: "Administration",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Menu data and requests"
        description="Run syncs where retrieval is permitted, load approved menu files, refresh nutrition estimates and review university requests."
      />
      <Suspense
        fallback={
          <div className="grid gap-4" aria-busy="true" aria-label="Loading administration tools">
            <Skeleton className="h-64 rounded-3xl" />
            <Skeleton className="h-80 rounded-3xl" />
          </div>
        }
      >
        <AdminContent />
      </Suspense>
    </>
  );
}

const RUN_STATUS: Record<string, string> = {
  success: "Succeeded",
  partial: "Partly succeeded",
  failed: "Failed",
  running: "Running",
};

async function AdminContent() {
  const user = await requireUser("/admin");
  if (!isAdmin(user)) notFound();

  const universities = await listUniversities();
  const importUnis = [];
  for (const u of universities) {
    const locations = await listLocations(u.id);
    importUnis.push({ id: u.id, name: u.name, locations: locations.map((l) => ({ slug: l.slug, name: l.name })) });
  }
  const runs = await listSyncRuns(25);
  const requests = await listUniversityRequests(200);
  const outdated = await countOutdatedEstimates();

  return (
    // grid-cols-1 (minmax(0, 1fr)) lets wide tables scroll inside their panels on phones.
    <div className="grid grid-cols-1 gap-6">
      <Panel aria-labelledby="sources-h">
        <h2 id="sources-h" className="text-lg font-semibold">
          Menu sources
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sync retrieves yesterday through the next 7 days. It only runs where the provider allows automatic retrieval;
          otherwise load an approved file below.
        </p>
        <ul className="mt-4 divide-y divide-border/60">
          {universities.map((u) => (
            <li key={u.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{u.name}</h3>
                  <IntegrationBadge status={u.integrationStatus} />
                </div>
                <p className="text-sm text-muted-foreground">
                  Provider: {u.provider} · {u.locationCount} locations · Last update:{" "}
                  {u.lastSync ? timeAgo(u.lastSync.at) : "never"} · Menus through:{" "}
                  {u.menuDataThrough ? formatDate(u.menuDataThrough, "short") : "none"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Automatic retrieval: {u.autoSync.label}. {u.autoSync.reason}
                </p>
              </div>
              <SyncButton universityId={u.id} universityName={u.name} disabledReason={u.autoSync.allowed ? null : "Automatic retrieval is off for this university."} />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel aria-labelledby="import-h">
        <h2 id="import-h" className="text-lg font-semibold">
          Approved menu import
        </h2>
        <p className="mt-1 mb-4 max-w-3xl text-sm text-muted-foreground">
          Use this only for menu data the dining operator provided or approved. Every import records its source and
          permission, is checked before anything is saved, and replaces the stored menus for the dates and meals it
          contains. The file format is described in <code className="rounded bg-muted px-1">docs/MENU_DATA_INTEGRATION.md</code>.
        </p>
        <ImportPanel universities={importUnis} />
      </Panel>

      <Panel aria-labelledby="est-h" className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 id="est-h" className="text-lg font-semibold">
            Nutrition estimates
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {outdated
              ? `${outdated} foods have estimates from an older estimator version (current: ${ESTIMATOR_VERSION}).`
              : `Every food uses the current estimator (${ESTIMATOR_VERSION}).`}
          </p>
        </div>
        <ReestimateButton outdated={outdated} />
      </Panel>

      <Panel aria-labelledby="runs-h">
        <h2 id="runs-h" className="mb-3 text-lg font-semibold">
          Recent syncs and imports
        </h2>
        {runs.length ? (
          <Table>
            <caption className="sr-only">The 25 most recent sync and import runs</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>University</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="text-right">Menus</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">New / changed</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id} className="align-top">
                  <TableCell className="whitespace-nowrap">{timeAgo(r.startedAt)}</TableCell>
                  <TableCell>{r.universityName}</TableCell>
                  <TableCell>{r.trigger}</TableCell>
                  <TableCell>{RUN_STATUS[r.status] ?? r.status}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.dateFrom ? `${r.dateFrom} – ${r.dateTo}` : "–"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.days ?? "–"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.items ?? "–"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.newFoods ?? "–"} / {r.changedFoods ?? "–"}
                  </TableCell>
                  <TableCell className="max-w-sm text-xs whitespace-normal text-muted-foreground">
                    {r.error && <p className="text-destructive">{r.error}</p>}
                    {r.importSource && (
                      <p>
                        {r.importSource.fileName ? `${r.importSource.fileName}: ` : ""}
                        {r.importSource.name}; permission: {r.importSource.permission}
                      </p>
                    )}
                    {r.warnings.slice(0, 2).map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState title="No syncs yet">Runs appear here after a sync or import.</EmptyState>
        )}
      </Panel>

      <Panel aria-labelledby="req-h">
        <h2 id="req-h" className="mb-1 text-lg font-semibold">
          University requests
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Contact emails are optional and only for telling requesters when a campus is added. Don&apos;t use them for anything
          else.
        </p>
        {requests.length ? (
          <Table>
            <caption className="sr-only">University requests, most supported first</caption>
            <TableHeader>
              <TableRow>
                <TableHead>University</TableHead>
                <TableHead className="text-right">Supporters</TableHead>
                <TableHead>Links</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id} className="align-top">
                  <TableCell>
                    <p className="font-medium">{r.universityName}</p>
                    <p className="text-xs text-muted-foreground">{[r.city, r.state, r.country].filter(Boolean).join(", ")}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.supporters}</TableCell>
                  <TableCell className="text-xs">
                    {r.websiteUrl && <SafeLink href={r.websiteUrl} label="Website" />}
                    {r.menuUrl && <SafeLink href={r.menuUrl} label="Menus" />}
                  </TableCell>
                  <TableCell className="text-xs">{r.contactEmail ?? "–"}</TableCell>
                  <TableCell className="max-w-xs text-xs whitespace-normal text-muted-foreground">{r.message ?? ""}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{timeAgo(r.updatedAt)}</TableCell>
                  <TableCell>
                    <RequestStatusSelect id={r.id} status={r.status} name={r.universityName} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState title="No requests yet">Requests from the &quot;Don&apos;t see your university?&quot; form appear here.</EmptyState>
        )}
      </Panel>
    </div>
  );
}

/** Links typed by the public: only http(s), opened without referrer or opener. */
function SafeLink({ href, label }: { href: string; label: string }) {
  if (!/^https?:\/\//i.test(href)) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="mr-2 text-primary underline-offset-4 hover:underline">
      {label}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
