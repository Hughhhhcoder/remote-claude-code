import {
  Show,
  createEffect,
  createSignal,
  onCleanup,
  splitProps,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";

/**
 * Popover — anchored floating panel.
 *
 * Desktop: position: fixed relative to the anchor element's viewport rect.
 *          No collision handling in v1 — `placement` is honored as-is.
 * Mobile (< 640px): anchoring is abandoned and the panel promotes to a
 *          bottom sheet, matching the Dialog pattern for usability.
 *
 * Closes on:
 *   - ESC key
 *   - outside click (pointerdown on anything outside the panel)
 */

export type PopoverPlacement =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end";

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** Anchor element or a getter returning one. */
  anchor: HTMLElement | (() => HTMLElement | undefined);
  placement?: PopoverPlacement;
  children: JSX.Element;
  /** Optional extra class on the panel. */
  class?: string;
}

interface Position {
  top: number;
  left: number;
  /** Width the panel should target — used only when we want to match anchor. */
  minWidth?: number;
}

const GAP = 6; // px between anchor and panel

function resolveAnchor(
  a: HTMLElement | (() => HTMLElement | undefined),
): HTMLElement | undefined {
  return typeof a === "function" ? a() : a;
}

function computePosition(
  anchor: HTMLElement,
  placement: PopoverPlacement,
  panel: HTMLElement,
): Position {
  const a = anchor.getBoundingClientRect();
  const pw = panel.offsetWidth || 0;
  const ph = panel.offsetHeight || 0;

  let top = 0;
  let left = 0;

  switch (placement) {
    case "bottom-start":
      top = a.bottom + GAP;
      left = a.left;
      break;
    case "bottom-end":
      top = a.bottom + GAP;
      left = a.right - pw;
      break;
    case "top-start":
      top = a.top - ph - GAP;
      left = a.left;
      break;
    case "top-end":
      top = a.top - ph - GAP;
      left = a.right - pw;
      break;
  }

  // Clamp to viewport so nothing renders off-screen on desktop.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  left = Math.max(8, Math.min(left, vw - pw - 8));
  top = Math.max(8, Math.min(top, vh - ph - 8));

  return { top, left, minWidth: a.width };
}

export function Popover(props: PopoverProps): JSX.Element {
  const [local] = splitProps(props, [
    "open",
    "onClose",
    "anchor",
    "placement",
    "children",
    "class",
  ]);

  const placement = () => local.placement ?? "bottom-start";

  let panelRef: HTMLDivElement | undefined;
  const [pos, setPos] = createSignal<Position | null>(null);
  const [mobile, setMobile] = createSignal(false);

  createEffect(() => {
    if (!local.open) {
      setPos(null);
      return;
    }
    if (typeof window === "undefined") return;

    const mq = window.matchMedia("(max-width: 639.98px)");
    const syncMobile = () => setMobile(mq.matches);
    syncMobile();
    mq.addEventListener("change", syncMobile);

    // Compute position on next frame so panelRef has measurable size.
    const reposition = () => {
      if (mq.matches) return; // mobile: no anchoring
      const a = resolveAnchor(local.anchor);
      if (!a || !panelRef) return;
      setPos(computePosition(a, placement(), panelRef));
    };
    const rafId = requestAnimationFrame(reposition);

    // Reposition on scroll / resize (desktop only).
    const onWinChange = () => reposition();
    window.addEventListener("scroll", onWinChange, true);
    window.addEventListener("resize", onWinChange);

    // Outside click closes.
    const onPointerDown = (e: PointerEvent) => {
      if (!panelRef) return;
      const target = e.target as Node | null;
      if (target && panelRef.contains(target)) return;
      // Ignore clicks on the anchor itself — caller typically toggles via it.
      const a = resolveAnchor(local.anchor);
      if (a && target && a.contains(target)) return;
      local.onClose();
    };
    // Capture phase so we catch before the click opens another popover, etc.
    document.addEventListener("pointerdown", onPointerDown, true);

    // ESC closes.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        local.onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    // Body scroll lock while in mobile sheet mode.
    const prevOverflow = document.body.style.overflow;
    if (mq.matches) document.body.style.overflow = "hidden";

    onCleanup(() => {
      cancelAnimationFrame(rafId);
      mq.removeEventListener("change", syncMobile);
      window.removeEventListener("scroll", onWinChange, true);
      window.removeEventListener("resize", onWinChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
    });
  });

  return (
    <Show when={local.open}>
      <Portal>
        <Show
          when={mobile()}
          fallback={
            <div
              ref={panelRef}
              role="dialog"
              class={[
                "fixed z-50 pointer-events-auto",
                "bg-bg-surface text-text-primary",
                "border border-border-subtle rounded-md shadow-xl",
                "animate-fade-in",
                local.class ?? "",
              ].join(" ")}
              style={
                pos()
                  ? {
                      top: `${pos()!.top}px`,
                      left: `${pos()!.left}px`,
                    }
                  : { visibility: "hidden", top: "0", left: "0" }
              }
            >
              {local.children}
            </div>
          }
        >
          {/* Mobile: promote to Dialog-style bottom sheet */}
          <div
            class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm animate-fade-in"
            onClick={() => local.onClose()}
            aria-hidden="true"
          />
          <div
            class="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none"
            onClick={(e) => {
              if (e.target === e.currentTarget) local.onClose();
            }}
          >
            <div
              ref={panelRef}
              role="dialog"
              class={[
                "pointer-events-auto w-full",
                "bg-bg-surface text-text-primary",
                "rounded-t-2xl border border-border-subtle shadow-2xl",
                "max-h-[85vh] flex flex-col animate-slide-up",
                local.class ?? "",
              ].join(" ")}
              style={{ "padding-bottom": "env(safe-area-inset-bottom)" }}
            >
              <div class="flex items-center justify-center pt-2 pb-1 shrink-0">
                <div
                  class="w-12 h-[5px] rounded-full bg-border-strong/60"
                  aria-hidden="true"
                />
              </div>
              <div class="flex-1 overflow-y-auto">{local.children}</div>
            </div>
          </div>
        </Show>
      </Portal>
    </Show>
  );
}

export default Popover;
