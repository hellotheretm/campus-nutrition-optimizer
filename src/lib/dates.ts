/**
 * Calendar-date helpers. Menu dates are plain "YYYY-MM-DD" strings that mean
 * a day on the campus's own calendar, so they never shift with the viewer's
 * time zone.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today's date in the given IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function formatDate(date: string, style: "long" | "medium" | "short" = "medium"): string {
  const d = new Date(`${date}T12:00:00Z`);
  const opts: Intl.DateTimeFormatOptions =
    style === "long"
      ? { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }
      : style === "medium"
        ? { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }
        : { month: "numeric", day: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat("en-US", opts).format(d);
}

/** "Today", "Tomorrow", "Yesterday" or the medium date. */
export function relativeDayLabel(date: string, today: string): string {
  const diff = diffDays(today, date);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return formatDate(date, "medium");
}

/** "3 minutes ago" style text for timestamps. */
export function timeAgo(when: Date | string | null | undefined, now: Date = new Date()): string {
  if (!when) return "never";
  const t = typeof when === "string" ? new Date(when) : when;
  const seconds = Math.round((now.getTime() - t.getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, "0")}${suffix}`;
}
