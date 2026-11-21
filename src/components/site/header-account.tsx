import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth";

/** Session-aware buttons for the marketing header. Render inside <Suspense>. */
export async function HeaderAccount() {
  const user = await getSessionUser();
  if (user) {
    return (
      <Button asChild className="h-9 rounded-full px-4">
        <Link href="/dashboard">Open dashboard</Link>
      </Button>
    );
  }
  return (
    <>
      <Button
        asChild
        variant="ghost"
        className="h-9 rounded-full px-4 group-data-[scrolled=false]/nav:text-white group-data-[scrolled=false]/nav:hover:bg-white/10 group-data-[scrolled=false]/nav:hover:text-white"
      >
        <Link href="/login">Sign in</Link>
      </Button>
      <Button asChild className="h-9 rounded-full px-4">
        <Link href="/signup">Get started</Link>
      </Button>
    </>
  );
}

export function HeaderAccountFallback() {
  return <span className="inline-block h-9 w-36 animate-pulse rounded-full bg-current/10" aria-hidden="true" />;
}
