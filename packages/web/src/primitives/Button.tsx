import { splitProps, Show, type JSX } from "solid-js";

/**
 * Button — primary chrome button following the Claude.ai design language.
 *
 * Uses font-sans (UI chrome, not content). Label content is dimmed to
 * transparent while `loading` so the button keeps its width; a small
 * spinner takes its place.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  secondary:
    "bg-bg-surface border border-border-subtle text-text-primary hover:border-border-strong",
  ghost:
    "bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-surfaceStrong",
  danger: "bg-danger text-white hover:opacity-90",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-[15px]",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-sans font-medium select-none " +
  "transition duration-fast ease-rcc " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

export function Button(props: ButtonProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "variant",
    "size",
    "loading",
    "disabled",
    "class",
    "children",
    "type",
  ]);

  const variant = () => local.variant ?? "primary";
  const size = () => local.size ?? "md";
  const isDisabled = () => !!(local.disabled || local.loading);

  return (
    <button
      {...rest}
      type={local.type ?? "button"}
      disabled={isDisabled()}
      aria-busy={local.loading ? "true" : undefined}
      class={[
        BASE,
        VARIANT_CLASSES[variant()],
        SIZE_CLASSES[size()],
        "relative",
        local.class ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        class="inline-flex items-center gap-2"
        style={{ visibility: local.loading ? "hidden" : "visible" }}
      >
        {local.children}
      </span>
      <Show when={local.loading}>
        <span
          class="absolute inset-0 flex items-center justify-center"
          aria-hidden="true"
        >
          <svg
            class="animate-spin"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        </span>
      </Show>
    </button>
  );
}

export default Button;
