import { splitProps, Show, type JSX } from "solid-js";

export interface TextInputProps
  extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onInput" | "value"> {
  label?: string;
  hint?: string;
  error?: string;
  value: string;
  onInput: (v: string) => void;
}

/**
 * Single-line text input, Phase 1-C primitive.
 *
 * Visual:
 *   - semantic Tailwind tokens (bg-bg-surface / border-border-subtle / text-text-*).
 *   - focus ring via box-shadow (no native outline hack).
 *   - error state tints border + hint in --danger.
 */
export function TextInput(props: TextInputProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "label",
    "hint",
    "error",
    "value",
    "onInput",
    "class",
    "id",
  ]);

  // Stable id for label/input association. Falls back to a generated one.
  const inputId =
    local.id ?? `ti-${Math.random().toString(36).slice(2, 9)}`;

  const baseInput =
    "h-10 w-full px-3 bg-bg-surface border rounded-md text-sm text-text-primary " +
    "placeholder-text-muted outline-none font-sans " +
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
      <input
        id={inputId}
        {...rest}
        value={local.value}
        onInput={(e) => local.onInput(e.currentTarget.value)}
        aria-invalid={local.error ? true : undefined}
        aria-describedby={
          local.error || local.hint ? `${inputId}-msg` : undefined
        }
        class={`${baseInput} ${borderCls()}`}
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

export default TextInput;
