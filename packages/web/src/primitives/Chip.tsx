import { splitProps, Show, type JSX } from "solid-js";

/**
 * Chip — small inline status pill. Uses tinted surfaces so it stays
 * quiet against page chrome.
 */

export type ChipTone =
  | "neutral"
  | "accent"
  | "success"
  | "warn"
  | "danger"
  | "info";
export type ChipSize = "xs" | "sm";

export interface ChipProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  size?: ChipSize;
  dot?: boolean;
}

/**
 * Tone color tokens. `info` has no dedicated token in the locked design
 * spec — we borrow accent with a cooler tint via opacity. See final
 * report: INVENTED token `--info` recommendation for later.
 */
const TONE_CLASSES: Record<ChipTone, string> = {
  neutral:
    "bg-bg-surfaceStrong text-text-secondary border border-border-subtle",
  accent: "bg-accent/10 text-accent border border-accent/20",
  success: "bg-success/10 text-success border border-success/20",
  warn: "bg-warn/10 text-warn border border-warn/20",
  danger: "bg-danger/10 text-danger border border-danger/20",
  info: "bg-accent/5 text-text-secondary border border-border-subtle",
};

const DOT_COLORS: Record<ChipTone, string> = {
  neutral: "bg-text-muted",
  accent: "bg-accent",
  success: "bg-success",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-text-secondary",
};

const SIZE_CLASSES: Record<ChipSize, string> = {
  xs: "h-5 px-1.5 text-[10px] gap-1",
  sm: "h-6 px-2 text-[11px] gap-1.5",
};

const BASE =
  "inline-flex items-center rounded-sm font-sans font-medium whitespace-nowrap leading-none";

export function Chip(props: ChipProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "tone",
    "size",
    "dot",
    "class",
    "children",
  ]);

  const tone = () => local.tone ?? "neutral";
  const size = () => local.size ?? "sm";

  return (
    <span
      {...rest}
      class={[
        BASE,
        TONE_CLASSES[tone()],
        SIZE_CLASSES[size()],
        local.class ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Show when={local.dot}>
        <span
          class={[
            "inline-block rounded-full",
            size() === "xs" ? "w-1.5 h-1.5" : "w-2 h-2",
            DOT_COLORS[tone()],
          ].join(" ")}
          aria-hidden="true"
        />
      </Show>
      {local.children}
    </span>
  );
}

export default Chip;
