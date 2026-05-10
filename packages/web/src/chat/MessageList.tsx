// Light windowing (no virtualizer dep): render everything under 200 msgs; above,
// show last N with an "expand older" button. Keeps streaming/delta updates safe.
//
// B18-B hardening for 10k-message sessions:
//  - IntersectionObserver-deferred content for mid-sized messages (>2KB, outside tail).
//  - Doubling expand step so users can drill back in history in O(log N) clicks.
//  - Single createMemo for isFollowup flags instead of per-row recompute.
import {
  createSignal,
  createEffect,
  createMemo,
  onCleanup,
  onMount,
  For,
  Show,
  type JSX,
} from "solid-js";
import type { ChatMessage } from "@rcc/protocol";
import { useChatPane } from "./ChatPane";
import { MessageRow } from "./MessageRow";
import { LazyContent } from "./LazyContent";
import { estimateMessageSize, HEAVY_MESSAGE_BYTES } from "./MessageList.perf";

export interface MessageListProps {
  messages: ChatMessage[];
  onPinToNotebook?: (id: string) => void;
  /** [B23-A] Fork a new session from a specific message. */
  onFork?: (messageId: string) => void;
  /** When true, autoscroll is disabled (e.g. user scrolled up). Defaults to auto-detect. */
  pinnedToBottom?: boolean;
  /**
   * [B28-C] When set, the list scrolls the row with the matching
   * `data-message-id` into view and flashes it for 2s. Setting this to the
   * same value twice only fires once (effect is memoized on the string).
   * Undefined / null: no-op.
   */
  scrollTargetId?: string;
}

const WINDOW_STEP = 200;
const BOTTOM_THRESHOLD = 32;
const GROUP_WINDOW_MS = 60_000;
/** Messages within the last N of the visible window always render in full, even
 *  if "heavy" — users are most likely to read recent output. */
const ACTIVE_TAIL = 20;
/** Below this size, skip the IntersectionObserver wrapper entirely — the
 *  observer overhead would cost more than rendering a tiny message. */
const LAZY_CONTENT_THRESHOLD_BYTES = 2 * 1024;

export function MessageList(props: MessageListProps): JSX.Element {
  const pane = useChatPane();
  const scrollEl = (): HTMLDivElement | undefined => pane?.scrollEl();

  // --- Windowing state ----------------------------------------------------
  const [windowSize, setWindowSize] = createSignal(WINDOW_STEP);
  // User-expanded heavy-message overrides (persist across re-renders while
  // the session is open).
  const [expandedIds, setExpandedIds] = createSignal<Set<string>>(new Set());

  // Reset window when sid changes (switching sessions).
  createEffect(() => {
    pane?.sid();
    setWindowSize(WINDOW_STEP);
    setExpandedIds(new Set<string>());
  });

  const visibleMessages = createMemo<ChatMessage[]>(() => {
    const all = props.messages;
    const w = windowSize();
    if (all.length <= w) return all;
    return all.slice(all.length - w);
  });

  const hiddenCount = (): number => {
    const n = props.messages.length - windowSize();
    return n > 0 ? n : 0;
  };

  // Precomputed per-index isFollowup flags — avoids O(visible) array lookups
  // inside the For render loop. Recomputes only when visibleMessages changes.
  const followupFlags = createMemo<boolean[]>(() => {
    const list = visibleMessages();
    const flags = new Array<boolean>(list.length);
    for (let i = 0; i < list.length; i += 1) {
      if (i === 0) {
        flags[i] = false;
        continue;
      }
      const prev = list[i - 1];
      const cur = list[i];
      if (!prev || !cur || prev.role !== cur.role) {
        flags[i] = false;
      } else {
        flags[i] = cur.timestamp - prev.timestamp < GROUP_WINDOW_MS;
      }
    }
    return flags;
  });

  // --- Bottom-lock tracking ----------------------------------------------
  const [atBottom, setAtBottom] = createSignal(true);
  const [newCount, setNewCount] = createSignal(0);

  const isAtBottom = (el: HTMLDivElement): boolean =>
    el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_THRESHOLD;

  const scrollToBottom = (): void => {
    const el = scrollEl();
    if (!el) return;
    queueMicrotask(() => el.scrollTo({ top: el.scrollHeight }));
  };

  // Wire scroll listener when the scrollEl becomes available. The listener
  // is rAF-throttled so fast-flicks don't spam scrollTop/scrollHeight reads.
  createEffect(() => {
    const el = scrollEl();
    if (!el) return;
    let rafId = 0;
    const tick = (): void => {
      rafId = 0;
      const bottom = isAtBottom(el);
      setAtBottom(bottom);
      if (bottom) setNewCount(0);
    };
    const onScroll = (): void => {
      if (rafId !== 0) return;
      rafId = requestAnimationFrame(tick);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Prime state on mount (sync, no rAF needed).
    tick();
    onCleanup(() => {
      el.removeEventListener("scroll", onScroll);
      if (rafId !== 0) cancelAnimationFrame(rafId);
    });
  });

  // Autoscroll on append: track length and react when it grows.
  let prevLen = props.messages.length;
  createEffect(() => {
    const len = props.messages.length;
    if (len > prevLen) {
      const delta = len - prevLen;
      const forceStick = props.pinnedToBottom === true;
      if (forceStick || atBottom()) {
        scrollToBottom();
      } else {
        setNewCount((c) => c + delta);
      }
    }
    prevLen = len;
  });

  onMount(() => {
    // Initial snap-to-bottom so a freshly attached session lands at newest.
    scrollToBottom();
  });

  // --- Scroll-to-message (B28-C) -----------------------------------------
  // When a search result is clicked, `scrollTargetId` is set to a chat
  // message id. We find the corresponding `[data-message-id]` element,
  // expand the window if the target is older than the visible range,
  // scroll into view, and flash a highlight class for 2s.
  //
  // Callers may suffix the id with `#<n>` to force a re-trigger on the same
  // message (e.g. prev/next arrows on the in-chat search overlay). The
  // suffix is stripped before the DOM lookup.
  let lastScrollTarget: string | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  createEffect(() => {
    const raw = props.scrollTargetId;
    if (!raw || raw === lastScrollTarget) return;
    lastScrollTarget = raw;
    const hashAt = raw.indexOf("#");
    const target = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
    if (!target) return;

    // Ensure the target is inside the visible window. If the message
    // exists but is older than what we currently render, grow the window.
    const all = props.messages;
    const idx = all.findIndex((m) => m.id === target);
    if (idx < 0) return; // message not in this session — nothing to do
    const currentWindow = windowSize();
    if (all.length - idx > currentWindow) {
      setWindowSize(all.length - idx + WINDOW_STEP);
    }

    // Wait for Solid to render any newly-included rows, then scroll.
    queueMicrotask(() => {
      if (typeof document === "undefined") return;
      const el = document.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(target)}"]`,
      );
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Remove any existing flash so re-triggering restarts the animation.
      el.classList.remove("flash-message");
      // Force reflow so re-adding the class restarts the keyframes.
      void el.offsetWidth;
      el.classList.add("flash-message");
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        el.classList.remove("flash-message");
        flashTimer = null;
      }, 2000);
    });
  });
  onCleanup(() => {
    if (flashTimer) clearTimeout(flashTimer);
  });

  const onPillClick = (): void => {
    setNewCount(0);
    scrollToBottom();
  };

  // --- Expand-older with scroll anchoring --------------------------------
  // Doubling step: 200 → 400 → 800 → 1600 → ... so drilling back through a
  // 10k-message history takes ~6 clicks instead of 50.
  const onExpandOlder = (): void => {
    const el = scrollEl();
    const savedDistance = el ? el.scrollHeight - el.scrollTop : 0;
    if (import.meta.env.DEV) {
      performance.mark("messagelist-expand-start");
    }
    setWindowSize((w) => {
      const total = props.messages.length;
      const remaining = total - w;
      if (remaining <= 0) return w;
      // First click: fixed WINDOW_STEP. Subsequent clicks: double current window,
      // capped at the remaining count so we never overshoot total.
      const step = w <= WINDOW_STEP ? WINDOW_STEP : w;
      return Math.min(total, w + Math.min(remaining, step));
    });
    if (!el) return;
    queueMicrotask(() => {
      // After the DOM grows upward, restore visual position by keeping the
      // same distance from the bottom of the scroll region.
      el.scrollTop = el.scrollHeight - savedDistance;
      if (import.meta.env.DEV) {
        performance.mark("messagelist-expand-end");
        try {
          performance.measure(
            "MessageList expand",
            "messagelist-expand-start",
            "messagelist-expand-end",
          );
        } catch {
          /* marks may have been cleared */
        }
      }
    });
  };

  const expandHeavy = (id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  // --- Render -------------------------------------------------------------
  const logAriaLabel = (): string =>
    `对话已加载,${props.messages.length} 条消息`;

  return (
    <div
      class="relative"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label={logAriaLabel()}
    >
      <Show when={props.messages.length === 0}>
        <div class="text-center text-xs text-text-muted py-8">等待回复…</div>
      </Show>

      <Show when={hiddenCount() > 0}>
        <div class="flex justify-center pb-4">
          <button
            type="button"
            class="text-xs text-text-secondary hover:text-text-primary border border-border-subtle rounded-full px-3 py-1.5 bg-bg-surface"
            onClick={onExpandOlder}
            aria-label={`显示更早消息,共 ${hiddenCount()} 条`}
          >
            显示更早消息 ({hiddenCount()})
          </button>
        </div>
      </Show>

      <div class="space-y-5 sm:space-y-6">
        <For each={visibleMessages()}>
          {(msg, i) => {
            const list = visibleMessages();
            const idx = i();
            const last = idx === list.length - 1;
            const followup = followupFlags()[idx] ?? false;
            const inActiveTail = idx >= list.length - ACTIVE_TAIL;
            const size = estimateMessageSize(msg);
            const heavy = size > HEAVY_MESSAGE_BYTES;
            const collapsed = heavy && !inActiveTail && !expandedIds().has(msg.id);
            // Mid-sized messages (>2KB) outside the active tail get wrapped in
            // LazyContent so their heavy inner rendering defers until near-view.
            // Tiny messages skip the observer entirely.
            const useLazy = !inActiveTail && size > LAZY_CONTENT_THRESHOLD_BYTES;
            // Extended contract (P4-C): pass optional `isFollowup` hint via
            // spread so we don't break typecheck if P4-C hasn't added the
            // prop yet (Solid tolerates unknown DOM-ish props on components).
            const extra = { isFollowup: followup } as Record<string, unknown>;
            const row = (): JSX.Element => (
              <MessageRow
                msg={msg}
                onPin={props.onPinToNotebook}
                onFork={props.onFork}
                isLast={last}
                {...extra}
              />
            );
            return (
              <Show
                when={!collapsed}
                fallback={
                  <button
                    type="button"
                    onClick={() => expandHeavy(msg.id)}
                    class="my-6 py-2 px-3 rounded border border-border-subtle bg-bg-surface text-[11px] text-text-muted font-mono block w-full text-left hover:text-text-secondary"
                  >
                    [折叠] 历史消息 · {size} bytes · 点击展开
                  </button>
                }
              >
                <Show when={useLazy} fallback={row()}>
                  <LazyContent>{row()}</LazyContent>
                </Show>
              </Show>
            );
          }}
        </For>
      </div>

      {/* "N new messages ↓" pill — pinned bottom-right of the scroll region. */}
      <Show when={!atBottom() && newCount() > 0}>
        <button
          type="button"
          onClick={onPillClick}
          class="fixed sm:absolute bottom-20 right-3 sm:right-4 sm:bottom-4 z-10 bg-accent text-bg-page rounded-full px-3 py-1.5 text-xs shadow-md hover:bg-accent-hover"
          aria-label="Jump to latest messages"
        >
          {newCount()} 条新消息 ↓
        </button>
      </Show>
    </div>
  );
}

export default MessageList;
