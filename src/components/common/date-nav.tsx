"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addDays, formatDate, relativeDayLabel } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function isoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function localDateToIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Previous / next day, a calendar picker and "Today", kept in the URL. */
export function DateNav({
  date,
  today,
  param = "date",
  className,
  minDate,
  maxDate,
}: {
  date: string;
  today: string;
  param?: string;
  className?: string;
  minDate?: string;
  maxDate?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);

  const href = (d: string) => {
    const p = new URLSearchParams(search.toString());
    if (d === today) p.delete(param);
    else p.set(param, d);
    const qs = p.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const prevDisabled = Boolean(minDate && prev < minDate);
  const nextDisabled = Boolean(maxDate && next > maxDate);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button asChild={!prevDisabled} variant="ghost" size="icon" className="rounded-full" disabled={prevDisabled} aria-label="Previous day">
        {prevDisabled ? <ChevronLeft aria-hidden="true" /> : <Link href={href(prev)} aria-label="Previous day" scroll={false}><ChevronLeft aria-hidden="true" /></Link>}
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-9 min-w-0 rounded-full px-3.5 sm:min-w-48" aria-label={`Choose date, currently ${formatDate(date, "long")}`}>
            <CalendarDays aria-hidden="true" />
            <span className="font-medium">{relativeDayLabel(date, today)}</span>
            {relativeDayLabel(date, today) !== formatDate(date, "medium") && (
              <span className="hidden text-muted-foreground sm:inline">· {formatDate(date, "medium")}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={isoToLocalDate(date)}
            defaultMonth={isoToLocalDate(date)}
            disabled={[
              ...(minDate ? [{ before: isoToLocalDate(minDate) }] : []),
              ...(maxDate ? [{ after: isoToLocalDate(maxDate) }] : []),
            ]}
            onSelect={(d) => {
              if (!d) return;
              setOpen(false);
              router.push(href(localDateToIso(d)), { scroll: false });
            }}
          />
        </PopoverContent>
      </Popover>
      <Button asChild={!nextDisabled} variant="ghost" size="icon" className="rounded-full" disabled={nextDisabled} aria-label="Next day">
        {nextDisabled ? <ChevronRight aria-hidden="true" /> : <Link href={href(next)} aria-label="Next day" scroll={false}><ChevronRight aria-hidden="true" /></Link>}
      </Button>
      {date !== today && (
        <Button asChild variant="ghost" size="sm" className="rounded-full">
          <Link href={href(today)} scroll={false}>
            Today
          </Link>
        </Button>
      )}
    </div>
  );
}
