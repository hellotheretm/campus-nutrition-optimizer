import { Skeleton } from "@/components/ui/skeleton";

export function MenusSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading menus" className="grid gap-5">
      <div className="glass grid gap-4 rounded-3xl p-4 md:p-5">
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 w-48 rounded-full" />
          <Skeleton className="h-9 w-56 rounded-full" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-full" />
          ))}
        </div>
      </div>
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="glass rounded-3xl p-4 md:p-6">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-2 h-4 w-64" />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, j) => (
              <Skeleton key={j} className="h-36 rounded-2xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
