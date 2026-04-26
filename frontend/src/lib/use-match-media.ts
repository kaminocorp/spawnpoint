"use client";

import { useSyncExternalStore } from "react";

/**
 * SSR-safe `matchMedia` subscription. Mirrors the `useSyncExternalStore`
 * pattern used elsewhere in the chrome (e.g. `fleet-view-pref.ts`):
 * server snapshot returns a stable default so SSR HTML and the first
 * client render agree byte-for-byte; the live snapshot then updates if
 * the user toggles the underlying preference (system-level for
 * `prefers-reduced-motion`, viewport-level for `max-width`).
 *
 * Defaults to `false` when called outside the browser. Callers branch
 * on `true` for the responsive path.
 */
export function useMatchMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined") return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => {
      if (typeof window === "undefined") return false;
      return window.matchMedia(query).matches;
    },
    () => false,
  );
}
