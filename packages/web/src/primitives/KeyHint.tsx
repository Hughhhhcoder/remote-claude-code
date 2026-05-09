import { splitProps, For, type JSX } from "solid-js";

export interface KeyHintProps
  extends Omit<JSX.HTMLAttributes<HTMLSpanElement>, "children"> {
  keys: string[];
  size?: "sm" | "md";
}

/**
 * Renders a keyboard shortcut as a sequence of <kbd> pills, e.g.
 *   <KeyHint keys={["⌘", "K"]} />  →  ⌘ K
 *
 * Pills are separated by a small gap; no "+" glyph (matches Claude.ai).
 */
export function KeyHint(props: KeyHintProps): JSX.Element {
  const [local, rest] = splitProps(props, ["keys", "size", "class"]);
  const size = () => local.size ?? "sm";

  const kbdCls = () =>
    [
      "inline-flex items-center justify-center",
      "bg-bg-surfaceStrong border border-border-subtle rounded-[4px]",
      "font-mono text-text-secondary",
      size() === "md"
        ? "min-w-[20px] h-[20px] px-1.5 text-[11px]"
        : "min-w-[18px] h-[18px] px-1.5 py-0.5 text-[10px]",
    ].join(" ");

  return (
    <span
      {...rest}
      class={`inline-flex items-center gap-1 align-middle ${local.class ?? ""}`}
      aria-label={local.keys.join(" ")}
    >
      <For each={local.keys}>
        {(k) => <kbd class={kbdCls()}>{k}</kbd>}
      </For>
    </span>
  );
}

export default KeyHint;
