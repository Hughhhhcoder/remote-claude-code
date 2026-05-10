import { createSignal, onCleanup } from "solid-js";

/**
 * useMediaQuery — reactive Solid signal bound to a CSS media query.
 *
 *   - SSR-safe: returns `() => false` when `window.matchMedia` is unavailable.
 *   - Uses `addEventListener("change", …)` when present, falls back to the
 *     legacy `addListener` for older Safari / JSDOM.
 *   - Cleans up via Solid `onCleanup`; call inside a Solid owner (component /
 *     createRoot).
 */
export function useMediaQuery(query: string): () => boolean {
  const hasMatchMedia =
    typeof window !== "undefined" && typeof window.matchMedia === "function";

  const initial = hasMatchMedia ? window.matchMedia(query).matches : false;
  const [matches, setMatches] = createSignal(initial);

  if (!hasMatchMedia) {
    return matches;
  }

  const mql = window.matchMedia(query);
  const handler = (e: MediaQueryListEvent) => setMatches(e.matches);

  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", handler);
  } else {
    (mql as unknown as { addListener: (cb: (e: MediaQueryListEvent) => void) => void })
      .addListener(handler);
  }

  onCleanup(() => {
    if (typeof mql.removeEventListener === "function") {
      mql.removeEventListener("change", handler);
    } else {
      (mql as unknown as { removeListener: (cb: (e: MediaQueryListEvent) => void) => void })
        .removeListener(handler);
    }
  });

  return matches;
}

/** Compact layout: sidebar collapses into a drawer below 1024px. */
export const useIsCompact = (): (() => boolean) =>
  useMediaQuery("(max-width: 1023px)");

/** Phone breakpoint: sticky top bar + bottom sheet drawer below 640px. */
export const useIsMobile = (): (() => boolean) =>
  useMediaQuery("(max-width: 639px)");
