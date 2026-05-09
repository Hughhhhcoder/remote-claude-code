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
 * Dialog — modal with focus management and responsive presentation.
 *
 * Desktop (>= 640px): centered card, capped width per `size`, rounded-lg.
 * Mobile  (<  640px): bottom sheet with drag handle + safe-area padding.
 *
 * Manages:
 *   - focus trap-lite (initial focus on first focusable; restore on close)
 *   - ESC key to close (when dismissible)
 *   - body scroll lock while open
 *   - backdrop click to close (when dismissible)
 */

export type DialogSize = "sm" | "md" | "lg";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: JSX.Element;
  size?: DialogSize;
  /** Esc + backdrop click close the dialog. Default true. */
  dismissible?: boolean;
  /** Optional extra class on the panel. */
  class?: string;
}

const SIZE_MAX_WIDTH: Record<DialogSize, string> = {
  sm: "sm:max-w-[400px]",
  md: "sm:max-w-[560px]",
  lg: "sm:max-w-[720px]",
};

export function Dialog(props: DialogProps): JSX.Element {
  const [local] = splitProps(props, [
    "open",
    "onClose",
    "title",
    "children",
    "size",
    "dismissible",
    "class",
  ]);

  const size = () => local.size ?? "md";
  const dismissible = () => local.dismissible ?? true;

  let panelRef: HTMLDivElement | undefined;
  const [previouslyFocused, setPreviouslyFocused] =
    createSignal<HTMLElement | null>(null);

  // Body scroll lock + focus management + keybindings, bound to `open`.
  createEffect(() => {
    if (!local.open) return;
    if (typeof document === "undefined") return;

    // Remember what was focused; we'll restore on close.
    const active = document.activeElement as HTMLElement | null;
    setPreviouslyFocused(active);

    // Lock body scroll.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus first focusable inside panel after render.
    const focusFirst = () => {
      if (!panelRef) return;
      const focusables = panelRef.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        panelRef.focus();
      }
    };
    const rafId = requestAnimationFrame(focusFirst);

    // Global ESC listener.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible()) {
        e.stopPropagation();
        local.onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    onCleanup(() => {
      cancelAnimationFrame(rafId);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      // Restore focus to opener if still connected.
      const prev = previouslyFocused();
      if (prev && typeof prev.focus === "function" && prev.isConnected) {
        try {
          prev.focus();
        } catch {
          /* noop */
        }
      }
    });
  });

  const onBackdropClick = (e: MouseEvent) => {
    if (!dismissible()) return;
    if (e.target === e.currentTarget) local.onClose();
  };

  return (
    <Show when={local.open}>
      <Portal>
        <div
          class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-fade-in"
          onClick={onBackdropClick}
          aria-hidden="true"
        />
        {/* Outer positioning wrapper — z-50, full viewport.
            Desktop: flex-center; mobile: bottom-anchored. */}
        <div
          class={[
            "fixed inset-0 z-50 flex pointer-events-none",
            "items-end justify-center",
            "sm:items-center sm:justify-center sm:p-4",
          ].join(" ")}
          onClick={onBackdropClick}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={local.title}
            tabIndex={-1}
            class={[
              "pointer-events-auto relative",
              "bg-bg-surface text-text-primary",
              "w-full flex flex-col",
              // Mobile: bottom sheet
              "rounded-t-2xl max-h-[85vh] animate-slide-up",
              // Desktop: centered card, capped width
              "sm:rounded-lg sm:max-h-[calc(100vh-64px)] sm:animate-fade-in",
              SIZE_MAX_WIDTH[size()],
              "shadow-2xl border border-border-subtle",
              "focus:outline-none",
              local.class ?? "",
            ].join(" ")}
            style={{
              // Safe-area for iOS home indicator; only meaningful on mobile
              // but harmless on desktop (env() resolves to 0 there).
              "padding-bottom": "env(safe-area-inset-bottom)",
            }}
          >
            {/* Drag handle — visible on mobile only (bottom sheet affordance) */}
            <div class="sm:hidden flex items-center justify-center pt-2 pb-1 shrink-0">
              <div
                class="w-12 h-[5px] rounded-full bg-border-strong/60"
                aria-hidden="true"
              />
            </div>

            <Show when={local.title}>
              <div class="px-5 pt-4 pb-3 sm:px-6 sm:pt-5 shrink-0">
                <h2 class="font-serif text-lg sm:text-xl font-medium text-text-primary m-0">
                  {local.title}
                </h2>
              </div>
            </Show>

            <div class="flex-1 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">
              {local.children}
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

export default Dialog;
