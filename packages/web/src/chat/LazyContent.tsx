// Lazy-render wrapper for heavy-ish MessageRow content (B18-B).
//
// Uses IntersectionObserver with a 200px rootMargin so content reveals
// before it scrolls into view. Once revealed it stays rendered — avoids
// expensive re-mount thrash as users scroll up and down through a long
// session. Tiny messages should NOT be wrapped in this (caller decides).
import {
  createSignal,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";

export interface LazyContentProps {
  /** Stable placeholder height; keeps scroll anchoring smooth until reveal. */
  placeholderClass?: string;
  children: JSX.Element;
}

const DEFAULT_PLACEHOLDER =
  "block w-full h-12 rounded-md bg-bg-surface border border-border-subtle";

export function LazyContent(props: LazyContentProps): JSX.Element {
  const [revealed, setRevealed] = createSignal(false);
  let sentinel: HTMLDivElement | undefined;

  onMount(() => {
    // SSR / no-IO fallback: just reveal immediately.
    if (typeof IntersectionObserver === "undefined" || !sentinel) {
      setRevealed(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setRevealed(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "200px 0px", threshold: 0 },
    );
    io.observe(sentinel);
    onCleanup(() => io.disconnect());
  });

  return (
    <Show
      when={revealed()}
      fallback={
        <div
          ref={sentinel}
          class={props.placeholderClass ?? DEFAULT_PLACEHOLDER}
          aria-hidden="true"
        />
      }
    >
      {props.children}
    </Show>
  );
}

export default LazyContent;
