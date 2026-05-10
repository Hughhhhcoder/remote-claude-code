import {
  Show,
  createEffect,
  onCleanup,
  splitProps,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { useFocusTrap } from "../hooks/useFocusTrap";

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

  // Stable id for the optional heading so we can wire aria-labelledby.
  const titleId = `dlg-${Math.random().toString(36).slice(2, 9)}-title`;

  // Body scroll lock + ESC key, bound to `open`. Focus trap (initial focus
  // + Tab wrapping + restore) lives in <DialogPanel> via useFocusTrap, which
  // only mounts while `open` is true.

  // Body scroll lock + ESC key, bound to `open`.
  createEffect(() => {
    if (!local.open) return;
    if (typeof document === "undefined") return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible()) {
        e.stopPropagation();
        local.onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
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
          <DialogPanel
            title={local.title}
            titleId={titleId}
            size={size()}
            extraClass={local.class ?? ""}
          >
            {local.children}
          </DialogPanel>
        </div>
      </Portal>
    </Show>
  );
}

/**
 * Inner panel — separated so it only mounts while `open` is true, which lets
 * useFocusTrap (onMount/onCleanup based) handle initial focus, Tab wrapping
 * and focus restoration symmetrically with dialog open/close.
 */
interface DialogPanelProps {
  title?: string;
  titleId: string;
  size: DialogSize;
  extraClass: string;
  children: JSX.Element;
}

function DialogPanel(props: DialogPanelProps): JSX.Element {
  let ref: HTMLDivElement | undefined;
  useFocusTrap(() => ref, { restoreFocus: true });
  return (
    <div
      ref={(el) => { ref = el; }}
      role="dialog"
      aria-modal="true"
      aria-label={props.title ? undefined : "对话框"}
      aria-labelledby={props.title ? props.titleId : undefined}
      tabIndex={-1}
      class={[
        "pointer-events-auto relative",
        "bg-bg-surface text-text-primary",
        "w-full flex flex-col",
        // Mobile: bottom sheet
        "rounded-t-2xl max-h-[85vh] animate-slide-up",
        // Desktop: centered card, capped width
        "sm:rounded-lg sm:max-h-[calc(100vh-64px)] sm:animate-fade-in",
        SIZE_MAX_WIDTH[props.size],
        "shadow-2xl border border-border-subtle",
        "focus:outline-none",
        props.extraClass,
      ].join(" ")}
      style={{
        "padding-bottom": "env(safe-area-inset-bottom)",
      }}
    >
      <div class="sm:hidden flex items-center justify-center pt-2 pb-1 shrink-0">
        <div
          class="w-12 h-[5px] rounded-full bg-border-strong/60"
          aria-hidden="true"
        />
      </div>

      <Show when={props.title}>
        <div class="px-5 pt-4 pb-3 sm:px-6 sm:pt-5 shrink-0">
          <h2
            id={props.titleId}
            class="font-serif text-lg sm:text-xl font-medium text-text-primary m-0"
          >
            {props.title}
          </h2>
        </div>
      </Show>

      <div class="flex-1 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">
        {props.children}
      </div>
    </div>
  );
}

export default Dialog;
