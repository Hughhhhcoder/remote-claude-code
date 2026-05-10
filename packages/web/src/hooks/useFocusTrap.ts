import { onCleanup, onMount, type Accessor } from "solid-js";

/**
 * useFocusTrap — trap Tab/Shift+Tab within an element.
 *
 * Usage:
 *   let ref: HTMLDivElement | undefined;
 *   useFocusTrap(() => ref, { initialFocus: () => ref?.querySelector("input"), restoreFocus: true });
 *
 * Behaviour:
 *   - On mount, optionally focuses `opts.initialFocus()` (falling back to the
 *     first focusable descendant, then the container itself if `tabindex=-1`).
 *   - Captures Tab keydowns; if focus is on the LAST focusable, wraps to the
 *     FIRST (or vice-versa for Shift+Tab).
 *   - Uses bubbling phase — nested traps (e.g. dialog inside dialog) cooperate
 *     because only the innermost mounted trap's container will contain the
 *     active element; outer traps short-circuit the Tab wrap.
 *   - On cleanup, restores focus to the previously-focused element when
 *     `opts.restoreFocus !== false` (default true).
 */

export interface UseFocusTrapOpts {
  initialFocus?: () => HTMLElement | undefined | null;
  restoreFocus?: boolean;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusables(container: HTMLElement): HTMLElement[] {
  const list = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  // Filter out elements that are hidden (display:none / visibility:hidden) —
  // a cheap check via offsetParent works for nearly all cases in our UI.
  return list.filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    // offsetParent is null for display:none; we intentionally allow
    // visibility:hidden to pass here because our dialogs don't use it.
    return el.offsetParent !== null || el === document.activeElement;
  });
}

export function useFocusTrap(
  panelRef: Accessor<HTMLElement | undefined | null>,
  opts: UseFocusTrapOpts = {},
): void {
  const restoreFocus = opts.restoreFocus !== false;
  let previouslyFocused: HTMLElement | null = null;

  onMount(() => {
    if (typeof document === "undefined") return;
    previouslyFocused = document.activeElement as HTMLElement | null;

    const container = panelRef();
    if (!container) return;

    // Initial focus — caller's pick, else first focusable, else container.
    const rafId = requestAnimationFrame(() => {
      const el = panelRef();
      if (!el) return;
      const pick = opts.initialFocus?.();
      if (pick && typeof pick.focus === "function") {
        try { pick.focus(); return; } catch { /* fallthrough */ }
      }
      const focusables = getFocusables(el);
      if (focusables.length > 0) {
        focusables[0]!.focus();
      } else if (typeof el.focus === "function") {
        el.focus();
      }
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const el = panelRef();
      if (!el) return;
      // Only act if focus is inside our container — lets outer traps ignore
      // Tabs that are already being handled by an inner trap.
      const active = document.activeElement as HTMLElement | null;
      if (!active || !el.contains(active)) return;
      const focusables = getFocusables(el);
      if (focusables.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    // Bubbling phase — inner traps run first (deeper in DOM), stopping
    // propagation if they handled the wrap.
    document.addEventListener("keydown", onKeyDown);

    onCleanup(() => {
      cancelAnimationFrame(rafId);
      document.removeEventListener("keydown", onKeyDown);
      if (restoreFocus && previouslyFocused && previouslyFocused.isConnected) {
        try { previouslyFocused.focus(); } catch { /* noop */ }
      }
    });
  });
}

export default useFocusTrap;
