"use client";

import { LogIn, LogOut, Settings, ShieldCheck, UserPlus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export interface MenuUser {
  name: string;
  email: string;
  image?: string | null;
}

function initials(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function useSignOut() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const signOut = () =>
    start(async () => {
      const { error } = await authClient.signOut();
      if (error) {
        toast.error("Couldn't sign out. Please try again.");
        return;
      }
      router.push("/");
      router.refresh();
    });
  return { signOut, pending };
}

export function UserMenu({
  user,
  admin,
  variant,
}: {
  user: MenuUser;
  admin: boolean;
  variant: "sidebar" | "compact" | "sheet";
}) {
  const { signOut, pending } = useSignOut();
  const avatar = (
    <Avatar className="size-8">
      {user.image ? <AvatarImage src={user.image} alt="" /> : null}
      <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials(user.name, user.email)}</AvatarFallback>
    </Avatar>
  );

  if (variant === "sheet") {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2 px-1">
          {avatar}
          <span className="min-w-0 truncate text-sm font-medium">{user.name || user.email}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {admin && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin">
                <ShieldCheck aria-hidden="true" /> Admin
              </Link>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={signOut} disabled={pending}>
            <LogOut aria-hidden="true" /> Sign out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-2.5 rounded-xl text-left outline-none hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50",
          variant === "sidebar" ? "w-full p-1.5 group-data-[collapsed=true]/sidebar:justify-center" : "p-1",
        )}
        aria-label="Account menu"
      >
        {avatar}
        {variant === "sidebar" && (
          <span className="min-w-0 flex-1 group-data-[collapsed=true]/sidebar:hidden">
            <span className="block truncate text-sm font-medium">{user.name || "Your account"}</span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={variant === "sidebar" ? "start" : "end"} side={variant === "sidebar" ? "top" : "bottom"} className="w-56">
        <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden="true" /> Settings
          </Link>
        </DropdownMenuItem>
        {admin && (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <ShieldCheck aria-hidden="true" /> Admin
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} disabled={pending}>
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SignedOutActions({ variant }: { variant: "sidebar" | "compact" | "sheet" }) {
  const pathname = usePathname();
  const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
  if (variant === "compact") {
    return (
      <Button asChild size="sm">
        <Link href={`/login${next}`}>Sign in</Link>
      </Button>
    );
  }
  return (
    <div className={cn("flex gap-1.5", variant === "sidebar" ? "flex-col group-data-[collapsed=true]/sidebar:items-center" : "flex-1")}>
      <Button asChild size={variant === "sidebar" ? "lg" : "default"} className="group-data-[collapsed=true]/sidebar:size-9 group-data-[collapsed=true]/sidebar:p-0">
        <Link href={`/login${next}`} aria-label="Sign in">
          <LogIn aria-hidden="true" />
          <span className="group-data-[collapsed=true]/sidebar:sr-only">Sign in</span>
        </Link>
      </Button>
      <Button asChild variant="ghost" size={variant === "sidebar" ? "lg" : "default"} className="group-data-[collapsed=true]/sidebar:size-9 group-data-[collapsed=true]/sidebar:p-0">
        <Link href="/signup" aria-label="Create an account">
          <UserPlus aria-hidden="true" />
          <span className="group-data-[collapsed=true]/sidebar:sr-only">Create account</span>
        </Link>
      </Button>
    </div>
  );
}
