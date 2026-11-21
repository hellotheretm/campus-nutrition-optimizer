import { Skeleton } from "@/components/ui/skeleton";

export function AuthCardSkeleton() {
  return (
    <div className="glass-strong w-full max-w-md rounded-3xl p-6 md:p-8" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="mt-3 h-4 w-64" />
      <div className="mt-8 grid gap-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
    </div>
  );
}
