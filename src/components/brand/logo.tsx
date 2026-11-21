import Link from "next/link";
import { cn } from "@/lib/utils";

/** App mark: a leaf on a Badger Red tile (an original mark, not a university logo). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="9" fill="#C5050C" />
      <path d="M16 6.2c-5.4 2.4-8.2 6.4-8.2 10.9a8.2 8.2 0 0 0 16.4 0c0-4.5-2.8-8.5-8.2-10.9Z" fill="#fff" />
      <path d="M16 11v13.4" stroke="#C5050C" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 16.2l-3.2-2.6M16 19.8l3.4-2.7" stroke="#C5050C" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({
  className,
  href = "/",
  tone = "default",
  compact = false,
}: {
  className?: string;
  href?: string;
  tone?: "default" | "light";
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <LogoMark />
      <span className={cn("leading-none", compact && "sr-only")}>
        <span className={cn("block text-[0.95rem] font-semibold tracking-tight", tone === "light" && "text-white")}>
          Campus Nutrition
        </span>
        <span
          className={cn(
            "mt-1 block text-[0.65rem] font-semibold tracking-[0.18em] uppercase",
            tone === "light" ? "text-white/75" : "text-muted-foreground",
          )}
        >
          Optimizer
        </span>
      </span>
    </Link>
  );
}
