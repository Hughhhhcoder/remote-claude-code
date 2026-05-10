import { createMemo, createSignal, createUniqueId, Show, type JSX } from "solid-js";

/**
 * ThinkingBlock — renders a `thinking` chat segment (Claude's extended-
 * thinking block) as a collapsed chip by default. Expanding reveals the raw
 * thought content in muted italic serif, set apart from normal assistant
 * prose with a left border in the accent color and a faint accent-tinted
 * background.
 *
 * Auto-expand: when the user flips `UiPrefs.showThinking` to true, the block
 * mounts already expanded. The pref is read once from localStorage at mount
 * (the same storage key `rcc:ui-prefs` the PrefsStore writes). We avoid
 * importing the PrefsStore to keep MessageRow's dependency graph untouched —
 * per-segment reactivity on the toggle isn't a requirement; changing the
 * pref applies to every *newly mounted* thinking block (existing ones keep
 * their current expand state, which matches user expectations).
 */

const LS_KEY = "rcc:ui-prefs";

function readShowThinkingPref(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const obj = JSON.parse(raw) as { showThinking?: unknown };
    return obj?.showThinking === true;
  } catch {
    return false;
  }
}

export interface ThinkingBlockProps {
  content: string;
}

/**
 * Counts visible characters for the chip label. Whitespace-collapsed so
 * `"hello  world\n\n"` reports 11 rather than 14 — matches a reader's
 * intuition of "content length".
 */
function contentLength(s: string): number {
  return s.replace(/\s+/g, " ").trim().length;
}

export function ThinkingBlock(props: ThinkingBlockProps): JSX.Element {
  const [expanded, setExpanded] = createSignal<boolean>(readShowThinkingPref());
  const bodyId = createUniqueId();
  const chars = createMemo(() => contentLength(props.content));

  return (
    <div class="my-2 font-sans text-[13px]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded()}
        aria-controls={bodyId}
        class={
          "inline-flex items-center gap-1.5 rounded-md border border-border-subtle " +
          "bg-bg-surface px-2 py-1 text-text-muted hover:text-text-primary " +
          "hover:border-accent/40 transition-colors duration-fast ease-rcc"
        }
      >
        <span aria-hidden="true">💭</span>
        <span>思考 ({chars()} 字)</span>
        <span
          class="text-[10px] text-text-muted"
          aria-hidden="true"
        >
          {expanded() ? "▾" : "▸"}
        </span>
      </button>
      <Show when={expanded()}>
        <div
          id={bodyId}
          class={
            "mt-2 border-l-2 border-accent/40 bg-accent-bg/30 " +
            "pl-3 pr-2 py-2 rounded-r-md"
          }
          role="region"
          aria-label="思考内容"
        >
          <div class="font-serif italic text-text-secondary text-[14px] leading-[1.6] whitespace-pre-wrap break-words">
            {props.content}
          </div>
        </div>
      </Show>
    </div>
  );
}

export default ThinkingBlock;
