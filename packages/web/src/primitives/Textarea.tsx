import {
  splitProps,
  Show,
  createEffect,
  type JSX,
} from "solid-js";

export interface TextareaProps
  extends Omit<
    JSX.TextareaHTMLAttributes<HTMLTextAreaElement>,
    "onInput" | "onKeyDown" | "value" | "rows"
  > {
  label?: string;
  hint?: string;
  error?: string;
  value: string;
  onInput: (v: string) => void;
  /** Minimum visible rows (default 1). */
  rows?: number;
  /** Maximum rows before the textarea scrolls (default 8). */
  maxRows?: number;
  /** Fires on bare Enter (no Shift). Shift+Enter still inserts a newline. */
  onEnter?: () => void;
  /** Passes through for all keys; does not override Enter behavior. */
  onKeyDown?: JSX.EventHandlerUnion<HTMLTextAreaElement, KeyboardEvent>;
}

/**
 * Auto-growing multi-line text input.
 *
 * Grow strategy: we reset `height: auto` then read `scrollHeight` on every
 * input, clamped to `maxRows * line-height`. This avoids a hidden clone DOM
 * node (which would need to mirror font/padding and duplicate reflow cost)
 * and plays nicely with Solid's fine-grained reactivity — we just run an
 * effect on `props.value`.
 */
export function Textarea(props: TextareaProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "label",
    "hint",
    "error",
    "value",
    "onInput",
    "onEnter",
    "onKeyDown",
    "rows",
    "maxRows",
    "class",
    "id",
  ]);

  const inputId =
    local.id ?? `ta-${Math.random().toString(36).slice(2, 9)}`;

  let ref: HTMLTextAreaElement | undefined;

  const resize = () => {
    const el = ref;
    if (!el) return;
    // Read computed line-height once per resize; fall back to 1.5× font-size.
    const cs = window.getComputedStyle(el);
    let lineHeight = parseFloat(cs.lineHeight);
    if (!Number.isFinite(lineHeight)) {
      const fs = parseFloat(cs.fontSize) || 14;
      lineHeight = fs * 1.5;
    }
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBot = parseFloat(cs.paddingBottom) || 0;
    const maxRows = local.maxRows ?? 8;
    const maxPx = Math.ceil(lineHeight * maxRows + padTop + padBot);
    // Reset then measure.
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, maxPx);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxPx ? "auto" : "hidden";
  };

  // Re-run whenever value changes (covers programmatic resets too).
  createEffect(() => {
    // touch value so Solid tracks it
    void local.value;
    queueMicrotask(resize);
  });

  const handleKeyDown: JSX.EventHandler<HTMLTextAreaElement, KeyboardEvent> = (
    e,
  ) => {
    // Forward to caller first so they can inspect / cancel.
    const handler = local.onKeyDown;
    if (typeof handler === "function") {
      handler(e);
    } else if (Array.isArray(handler)) {
      // Solid bound-handler tuple: [fn, data]
      (handler[0] as (d: unknown, ev: KeyboardEvent) => void)(handler[1], e);
    }
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && local.onEnter) {
      e.preventDefault();
      local.onEnter();
    }
  };

  const baseCls =
    "w-full px-3 py-2 bg-bg-surface border rounded-md text-sm text-text-primary " +
    "placeholder-text-muted outline-none font-sans resize-none leading-[1.5] " +
    "transition duration-[var(--duration-fast,150ms)] ease-rcc " +
    "disabled:opacity-50 disabled:cursor-not-allowed";

  const borderCls = () =>
    local.error
      ? "border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgb(var(--danger)/0.15)]"
      : "border-border-subtle focus:border-accent focus:shadow-[0_0_0_3px_rgb(var(--accent)/0.12)]";

  return (
    <div class={`flex flex-col ${local.class ?? ""}`}>
      <Show when={local.label}>
        {(label) => (
          <label
            for={inputId}
            class="text-[11px] uppercase tracking-widest text-text-muted mb-1.5 font-sans"
          >
            {label()}
          </label>
        )}
      </Show>
      <textarea
        id={inputId}
        {...rest}
        ref={(el) => {
          ref = el;
          // Initial sizing once mounted.
          queueMicrotask(resize);
        }}
        rows={local.rows ?? 1}
        value={local.value}
        onInput={(e) => {
          local.onInput(e.currentTarget.value);
          // resize also runs via createEffect, but call inline for snappiness.
          resize();
        }}
        onKeyDown={handleKeyDown}
        aria-invalid={local.error ? true : undefined}
        aria-describedby={
          local.error || local.hint ? `${inputId}-msg` : undefined
        }
        class={`${baseCls} ${borderCls()}`}
      />
      <Show when={local.error || local.hint}>
        <p
          id={`${inputId}-msg`}
          class={`mt-1.5 text-[11px] font-sans ${
            local.error ? "text-danger" : "text-text-muted"
          }`}
        >
          {local.error ?? local.hint}
        </p>
      </Show>
    </div>
  );
}

export default Textarea;
