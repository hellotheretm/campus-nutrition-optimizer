import { ZodError } from "zod";

export type ActionResult<T = null> = { ok: true; data: T; message?: string } | { ok: false; error: string };

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Turns thrown errors into short, user-facing messages without leaking internals. */
export function errorMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  if (e instanceof ZodError) {
    const first = e.issues[0];
    return first ? `Please check ${first.path.join(".") || "your input"}: ${first.message}` : fallback;
  }
  if (
    e instanceof Error &&
    e.message &&
    e.message.length < 200 &&
    !/sql|relation|column|syntax|constraint|ECONN|password|token|secret/i.test(e.message)
  ) {
    return e.message;
  }
  console.error(e);
  return fallback;
}
