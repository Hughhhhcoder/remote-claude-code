import { createSignal, For, Show, onCleanup, type JSX } from "solid-js";

/**
 * Toast — lightweight app-wide notification primitive.
 *
 * Used by optimistic-write rollbacks (B15-A) to tell the user a mutation
 * was reverted because the host rejected it or the request timed out.
 *
 * Usage:
 *   // one-time mount at app root
 *   <ToastContainer />
 *
 *   // anywhere in the code
 *   import { toast } from "../primitives/Toast";
 *   toast("关闭失败", { tone: "danger" });
 *
 * The queue lives in a module-level signal so any component or store can
 * dispatch without needing DI.
 */

export type ToastTone = "info" | "warn" | "danger";

export interface ToastOptions {
  tone?: ToastTone;
  /** ms before auto-dismiss; default 4000. Pass 0 for sticky. */
  duration?: number;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  duration: number;
}

const [items, setItems] = createSignal<ToastItem[]>([]);
let nextId = 1;

function dismiss(id: number) {
  setItems((prev) => prev.filter((t) => t.id !== id));
}

/**
 * Dispatch a toast. Safe to call from any context (stores, components).
 * Returns the toast id so the caller can dismiss programmatically.
 */
export function toast(message: string, opts: ToastOptions = {}): number {
  const id = nextId++;
  const tone = opts.tone ?? "info";
  const duration = opts.duration ?? 4000;
  setItems((prev) => [...prev, { id, message, tone, duration }]);
  return id;
}

const STRIPE: Record<ToastTone, string> = {
  info: "bg-accent",
  warn: "bg-warn",
  danger: "bg-danger",
};

const BORDER: Record<ToastTone, string> = {
  info: "border-border-subtle",
  warn: "border-warn/40",
  danger: "border-danger/40",
};

function ToastRow(props: { item: ToastItem }): JSX.Element {
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (props.item.duration > 0) {
    timer = setTimeout(() => dismiss(props.item.id), props.item.duration);
  }
  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  return (
    <div
      role="status"
      class={[
        "relative overflow-hidden flex items-start gap-2",
        "bg-bg-surface rounded-md px-3 py-2 shadow-md border",
        "text-[13px] text-text-primary",
        BORDER[props.item.tone],
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        class={["absolute left-0 top-0 bottom-0 w-[3px]", STRIPE[props.item.tone]].join(" ")}
      />
      <span class="pl-1 flex-1 leading-snug">{props.item.message}</span>
      <button
        type="button"
        class="shrink-0 text-text-muted hover:text-text-primary leading-none px-1"
        aria-label="Dismiss"
        onClick={() => dismiss(props.item.id)}
      >
        ✕
      </button>
    </div>
  );
}

/**
 * Mount once near the app root. Positions bottom-center on mobile,
 * bottom-right on desktop.
 */
export function ToastContainer(): JSX.Element {
  return (
    <Show when={items().length > 0}>
      <div
        class={[
          "fixed z-[70] pointer-events-none flex flex-col gap-2",
          "bottom-4 left-1/2 -translate-x-1/2 w-[min(360px,calc(100vw-2rem))]",
          "md:left-auto md:right-4 md:translate-x-0",
        ].join(" ")}
      >
        <For each={items()}>
          {(item) => (
            <div class="pointer-events-auto">
              <ToastRow item={item} />
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

export default ToastContainer;
