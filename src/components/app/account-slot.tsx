import { getSessionUser, isAdmin } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { SignedOutActions, UserMenu } from "./user-menu";

type Variant = "sidebar" | "compact" | "sheet";

/** Reads the session at request time; always render inside <Suspense>. */
export async function AccountSlot({ variant }: { variant: Variant }) {
  const user = await getSessionUser();
  if (!user) return <SignedOutActions variant={variant} />;
  return (
    <UserMenu
      user={{ name: user.name, email: user.email, image: user.image }}
      admin={isAdmin(user)}
      variant={variant}
    />
  );
}

export function AccountSlotSkeleton({ variant }: { variant: Variant }) {
  if (variant === "compact") return <Skeleton className="size-8 rounded-full" />;
  return (
    <div className="flex items-center gap-2.5 p-1.5">
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="flex-1 space-y-1.5 group-data-[collapsed=true]/sidebar:hidden">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-2.5 w-32" />
      </div>
    </div>
  );
}
