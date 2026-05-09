import { splitProps, type JSX } from "solid-js";

/**
 * IconButton — square icon-only button. Requires `aria-label` for
 * accessibility since there is no text content.
 */

export type IconButtonSize = "sm" | "md" | "lg";
export type IconButtonTone = "default" | "accent" | "danger";

export interface IconButtonProps
  extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  tone?: IconButtonTone;
  /** Required for screen readers. */
  "aria-label": string;
}

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: "w-7 h-7 text-[13px]",
  md: "w-9 h-9 text-sm",
  lg: "w-10 h-10 text-base",
};

const TONE_CLASSES: Record<IconButtonTone, string> = {
  default: "text-text-secondary hover:text-text-primary hover:bg-bg-surfaceStrong",
  accent: "text-accent hover:bg-accent-bg",
  danger: "text-danger hover:bg-danger/10",
};

const BASE =
  "inline-flex items-center justify-center rounded-md bg-transparent " +
  "transition duration-fast ease-rcc " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

export function IconButton(props: IconButtonProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "size",
    "tone",
    "class",
    "children",
    "type",
  ]);

  const size = () => local.size ?? "md";
  const tone = () => local.tone ?? "default";

  return (
    <button
      {...rest}
      type={local.type ?? "button"}
      class={[
        BASE,
        SIZE_CLASSES[size()],
        TONE_CLASSES[tone()],
        local.class ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {local.children}
    </button>
  );
}

export default IconButton;
