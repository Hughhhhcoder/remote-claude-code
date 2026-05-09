import { createSignal, onCleanup } from "solid-js";

const QUERY = "(max-width: 767px)";

export function useIsMobile(): () => boolean {
  const initial =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(QUERY).matches
      : false;
  const [isMobile, setIsMobile] = createSignal(initial);

  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return isMobile;
  }

  const mql = window.matchMedia(QUERY);
  const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);

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

  return isMobile;
}
