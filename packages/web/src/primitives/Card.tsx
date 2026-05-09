import { splitProps, type JSX } from "solid-js";

/**
 * Card — general container with consistent padding and border.
 * Use `interactive` for cards that act as clickable targets (adds
 * hover affordance and pointer cursor).
 */

export type CardPadding = "sm" | "md" | "lg";

export interface CardProps extends JSX.HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  interactive?: boolean;
}

const PADDING_CLASSES: Record<CardPadding, string> = {
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

const BASE = "bg-bg-surface border border-border-subtle rounded-lg";

const INTERACTIVE =
  "cursor-pointer transition duration-fast ease-rcc " +
  "hover:bg-bg-surfaceStrong hover:border-border-strong";

export function Card(props: CardProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "padding",
    "interactive",
    "class",
    "children",
  ]);

  const padding = () => local.padding ?? "md";

  return (
    <div
      {...rest}
      class={[
        BASE,
        PADDING_CLASSES[padding()],
        local.interactive ? INTERACTIVE : "",
        local.class ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {local.children}
    </div>
  );
}

export default Card;
