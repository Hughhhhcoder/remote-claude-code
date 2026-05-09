import { splitProps, type JSX } from "solid-js";

/**
 * Spinner — small inline loading indicator. Uses SVG with stroke-dasharray
 * and `animate-spin` for a smooth rotation. Inherits `currentColor` by
 * default so it adapts inside buttons / chips.
 */

export type SpinnerSize = "sm" | "md" | "lg";
export type SpinnerColor = "current" | "accent" | "muted";

export interface SpinnerProps extends Omit<JSX.HTMLAttributes<HTMLSpanElement>, "color"> {
  size?: SpinnerSize;
  color?: SpinnerColor;
}

const SIZE_PX: Record<SpinnerSize, number> = {
  sm: 14,
  md: 20,
  lg: 28,
};

const COLOR_CLASSES: Record<SpinnerColor, string> = {
  current: "text-current",
  accent: "text-accent",
  muted: "text-text-muted",
};

export function Spinner(props: SpinnerProps): JSX.Element {
  const [local, rest] = splitProps(props, ["size", "color", "class"]);
  const size = () => SIZE_PX[local.size ?? "md"];
  const colorClass = () => COLOR_CLASSES[local.color ?? "current"];

  return (
    <span
      role="status"
      aria-label="Loading"
      {...rest}
      class={["inline-flex items-center justify-center", colorClass(), local.class ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <svg
        class="animate-spin"
        width={size()}
        height={size()}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" opacity="0.2" />
        <path d="M21 12a9 9 0 0 1-9 9" />
      </svg>
    </span>
  );
}

export default Spinner;
