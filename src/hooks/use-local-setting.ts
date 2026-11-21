"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A small per-browser preference stored in localStorage (sidebar state,
 * last-used filters). Storage can be unavailable (private windows, blocked
 * site data), so every access is guarded and the default is used instead.
 */
const EVENT = "cno:local-setting";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocalSetting(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Ignore: the preference just won't persist.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

export function useLocalSetting(key: string, fallback: string): [string, (value: string) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const handler = (e: Event) => {
        if (e instanceof StorageEvent ? e.key === key : (e as CustomEvent).detail === key) onChange();
      };
      window.addEventListener("storage", handler);
      window.addEventListener(EVENT, handler);
      return () => {
        window.removeEventListener("storage", handler);
        window.removeEventListener(EVENT, handler);
      };
    },
    [key],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => read(key) ?? fallback,
    () => fallback,
  );
  const set = useCallback((v: string) => writeLocalSetting(key, v), [key]);
  return [value, set];
}
