import { onCleanup, onMount } from "solid-js";

/**
 * useLandmarkCycle — F6 / Shift+F6 cycles focus through the main landmarks.
 *
 * Install once at the App root. Landmarks (in forward order):
 *   1. <header>                          (TopBar)
 *   2. <nav aria-label="会话导航">        (Sidebar)
 *   3. <main id="main">                  (main content)
 *   4. <nav aria-label="主导航">          (TabNav, compact only)
 *
 * Hidden landmarks (e.g. sidebar on mobile where it lives inside a closed
 * Dialog) are skipped automatically because their live DOM node is absent or
 * their offsetParent is null. Each landmark is given tabIndex=-1 on the fly
 * so it can receive programmatic focus without polluting the tab order.
 */

const SELECTORS: readonly string[] = [
  "header",
  'nav[aria-label="会话导航"]',
  'main#main',
  'nav[aria-label="主导航"]',
];

function findLandmarks(): HTMLElement[] {
  if (typeof document === "undefined") return [];
  const out: HTMLElement[] = [];
  for (const sel of SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) continue;
    // Skip detached or hidden nodes (display:none → offsetParent === null).
    if (el.offsetParent === null && el.tagName !== "BODY") continue;
    out.push(el);
  }
  return out;
}

export function useLandmarkCycle(): void {
  onMount(() => {
    if (typeof document === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "F6") return;
      // Don't hijack when a modifier combo we don't own is pressed (Ctrl/Alt/Meta).
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const landmarks = findLandmarks();
      if (landmarks.length === 0) return;
      e.preventDefault();

      const active = document.activeElement as HTMLElement | null;
      // Find current landmark (the one containing focus), else -1.
      let currentIdx = -1;
      if (active) {
        for (let i = 0; i < landmarks.length; i++) {
          if (landmarks[i]!.contains(active)) { currentIdx = i; break; }
        }
      }
      const dir = e.shiftKey ? -1 : 1;
      const nextIdx = currentIdx === -1
        ? (dir === 1 ? 0 : landmarks.length - 1)
        : (currentIdx + dir + landmarks.length) % landmarks.length;
      const target = landmarks[nextIdx]!;
      // Ensure focusable — tabindex=-1 is enough for programmatic focus.
      if (!target.hasAttribute("tabindex")) {
        target.setAttribute("tabindex", "-1");
      }
      try { target.focus({ preventScroll: false }); } catch { /* noop */ }
    };
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  });
}

export default useLandmarkCycle;
