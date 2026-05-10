// Light windowing (no virtualizer dep): render everything under 200 msgs; above,
// show last N with an "expand older" button. Keeps streaming/delta updates safe.
import {
  createSignal,
  createEffect,
  onCleanup,
  onMount,
  For,
  Show,
  type JSX,
} from "solid-js";
import type { ChatMessage } from "@rcc/protocol";
import { useChatPane } from "./ChatPane";
import { MessageRow } from "./MessageRow";
import { estimateMessageSize, HEAVY_MESSAGE_BYTES } from "./MessageList.perf";

export interface MessageListProps {
  messages: ChatMessage[];
  onPinToNotebook?: (id: string) => void;
  /** When true, autoscroll is disabled (e.g. user scrolled up). Defaults to auto-detect. */
  pinnedToBottom?: boolean;
}

const WINDOW_STEP = 200;
const BOTTOM_THRESHOLD = 32;
const GROUP_WINDOW_MS = 60_000;
/** Messages within the last N of the visible window always render in full, even
 *  if "heavy" — users are most likely to read recent output. */
const ACTIVE_TAIL = 20;

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

  const visibleMessages = (): ChatMessage[] => {
    const all = props.messages;
    if (all.length <= windowSize()) return all;
    return all.slice(all.length - windowSize());
  };

  const hiddenCount = (): number => {
    const n = props.messages.length - windowSize();
    return n > 0 ? n : 0;
  };

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

  // --- Grouping -----------------------------------------------------------
  const isFollowup = (list: ChatMessage[], i: number): boolean => {
    if (i === 0) return false;
    const prev = list[i - 1];
    const cur = list[i];
    if (!prev || !cur) return false;
    if (prev.role !== cur.role) return false;
    return cur.timestamp - prev.timestamp < GROUP_WINDOW_MS;
  };

  const onPillClick = (): void => {
    setNewCount(0);
    scrollToBottom();
  };

  // --- Expand-older with scroll anchoring --------------------------------
  const onExpandOlder = (): void => {
    const el = scrollEl();
    const savedDistance = el ? el.scrollHeight - el.scrollTop : 0;
    setWindowSize((w) => w + WINDOW_STEP);
    if (!el) return;
    queueMicrotask(() => {
      // After the DOM grows upward, restore visual position by keeping the
      // same distance from the bottom of the scroll region.
      el.scrollTop = el.scrollHeight - savedDistance;
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
            const followup = isFollowup(list, idx);
            const inActiveTail = idx >= list.length - ACTIVE_TAIL;
            const size = estimateMessageSize(msg);
            const heavy = size > HEAVY_MESSAGE_BYTES;
            const collapsed = heavy && !inActiveTail && !expandedIds().has(msg.id);
            // Extended contract (P4-C): pass optional `isFollowup` hint via
            // spread so we don't break typecheck if P4-C hasn't added the
            // prop yet (Solid tolerates unknown DOM-ish props on components).
            const extra = { isFollowup: followup } as Record<string, unknown>;
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
                <MessageRow
                  msg={msg}
                  onPin={props.onPinToNotebook}
                  isLast={last}
                  {...extra}
                />
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
