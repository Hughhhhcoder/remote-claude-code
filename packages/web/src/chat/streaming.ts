// [P4-H] rAF-coalesced streaming buffer for SDK chat messages.
//
// Background: the SDK driver appends one `chat.append` (streaming:true) when a
// new assistant message starts, then emits a burst of `chat.update` frames as
// text_delta / tool_use blocks arrive, then a final `chat.append`
// (streaming:false) with the completed message. The naive handler in
// ChatView.tsx re-renders on every frame. Here we coalesce updates per
// animation frame, keeping only the latest segment for each
// (messageId, segmentIndex) pair before flushing into a Solid signal.
//
// This module is pure data reactivity — no JSX. MessageRow handles the
// blinking-cursor affordance based on `ChatMessage.streaming`.
import type { ChatMessage, ChatSegment, Frame } from "@rcc/protocol";
import { createSignal, createEffect, onCleanup, type Accessor } from "solid-js";
import type { RccClient } from "../client";

export interface StreamingStats {
  /** Total messages currently in buffer. */
  count: number;
  /** True if any message has streaming === true. */
  streaming: boolean;
  /** Number of queued-but-not-applied updates (frames arriving ahead of append). */
  pendingOrphanUpdates: number;
}

export interface StreamingMessagesStore {
  messages: Accessor<ChatMessage[]>;
  stats: Accessor<StreamingStats>;
  clear(): void;
  dispose(): void;
}

/** Same 200-message cap ChatView.tsx uses; keep memory bounded. */
const MAX_MESSAGES = 200;

/**
 * Pure: return a new segments array with `segmentIndex` replaced by `incoming`.
 * Pads with empty text segments if `segmentIndex` is past the end — mirrors the
 * defensive behavior in ChatView.tsx so late-arriving updates don't drop text.
 */
export function mergeSegments(
  existing: ChatSegment[],
  segmentIndex: number,
  incoming: ChatSegment,
): ChatSegment[] {
  const next = existing.slice();
  while (next.length <= segmentIndex) {
    next.push({ kind: "text", content: "" });
  }
  next[segmentIndex] = incoming;
  return next;
}

function rafSchedule(cb: () => void): { cancel: () => void } {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(cb);
    return {
      cancel: () => {
        if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
      },
    };
  }
  // SSR / test fallback: next microtask.
  const t = setTimeout(cb, 16);
  return { cancel: () => clearTimeout(t) };
}

export function createStreamingMessages(
  client: RccClient,
  sidAccessor: Accessor<string | undefined>,
): StreamingMessagesStore {
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);

  // messageId → segmentIndex → latest segment (pending flush on next rAF).
  const pending = new Map<string, Map<number, ChatSegment>>();
  // Updates that arrived before their chat.append — apply on insert.
  const orphanUpdates = new Map<string, Map<number, ChatSegment>>();

  let rafHandle: { cancel: () => void } | null = null;

  const [orphanCount, setOrphanCount] = createSignal(0);

  function recomputeOrphanCount(): void {
    let n = 0;
    for (const m of orphanUpdates.values()) n += m.size;
    setOrphanCount(n);
  }

  function scheduleFlush(): void {
    if (rafHandle) return;
    rafHandle = rafSchedule(() => {
      rafHandle = null;
      flush();
    });
  }

  function flush(): void {
    if (pending.size === 0) return;
    // Snapshot + clear before setMessages so any re-entrant frame during the
    // Solid update goes onto a fresh rAF batch. In practice setMessages is
    // synchronous and the scheduler is rAF-driven, so re-entry is unlikely —
    // but the swap is cheap insurance.
    const drained = new Map(pending);
    pending.clear();

    setMessages((ms) => {
      let changed = false;
      let next = ms;
      for (const [messageId, segmentMap] of drained) {
        const idx = next.findIndex((m) => m.id === messageId);
        if (idx < 0) {
          // Message not present — re-park as orphan. This can happen if
          // chat.update arrived before chat.append.
          let bucket = orphanUpdates.get(messageId);
          if (!bucket) {
            bucket = new Map();
            orphanUpdates.set(messageId, bucket);
          }
          for (const [sIdx, seg] of segmentMap) bucket.set(sIdx, seg);
          continue;
        }
        const msg = next[idx]!;
        let segments = msg.segments;
        for (const [sIdx, seg] of segmentMap) {
          segments = mergeSegments(segments, sIdx, seg);
        }
        if (segments !== msg.segments) {
          if (!changed) {
            next = next.slice();
            changed = true;
          }
          next[idx] = { ...msg, segments };
        }
      }
      return changed ? next : ms;
    });
    recomputeOrphanCount();
  }

  function clear(): void {
    if (rafHandle) {
      rafHandle.cancel();
      rafHandle = null;
    }
    pending.clear();
    orphanUpdates.clear();
    setOrphanCount(0);
    setMessages([]);
  }

  function applyOrphansTo(message: ChatMessage): ChatMessage {
    const bucket = orphanUpdates.get(message.id);
    if (!bucket || bucket.size === 0) return message;
    let segments = message.segments;
    for (const [sIdx, seg] of bucket) {
      segments = mergeSegments(segments, sIdx, seg);
    }
    orphanUpdates.delete(message.id);
    recomputeOrphanCount();
    return { ...message, segments };
  }

  const unsubFrame = client.on((frame: Frame) => {
    const sid = sidAccessor();
    if (!sid) return;

    if (frame.t === "chat.list" && frame.sid === sid) {
      // Fresh hydration — discard any in-flight coalescing from the prior
      // state and apply any orphans that match.
      pending.clear();
      if (rafHandle) {
        rafHandle.cancel();
        rafHandle = null;
      }
      const hydrated = frame.messages.map((m) => applyOrphansTo(m));
      setMessages(hydrated);
      return;
    }

    if (frame.t === "chat.append" && frame.sid === sid) {
      const incoming = applyOrphansTo(frame.message);
      setMessages((ms) => {
        const idx = ms.findIndex((m) => m.id === incoming.id);
        if (idx >= 0) {
          // Finalizing a streaming message we already have — swap in place.
          // Also merge any pending updates that haven't flushed yet so the
          // final frame doesn't race past them.
          const pendingForMsg = pending.get(incoming.id);
          let finalized = incoming;
          if (pendingForMsg) {
            let segments = incoming.segments;
            for (const [sIdx, seg] of pendingForMsg) {
              segments = mergeSegments(segments, sIdx, seg);
            }
            finalized = { ...incoming, segments };
            pending.delete(incoming.id);
          }
          const next = ms.slice();
          next[idx] = finalized;
          return next;
        }
        const appended = [...ms, incoming];
        return appended.length > MAX_MESSAGES
          ? appended.slice(appended.length - MAX_MESSAGES)
          : appended;
      });
      return;
    }

    if (frame.t === "chat.update" && frame.sid === sid) {
      // Stash into pending map; flush on next animation frame.
      let bucket = pending.get(frame.messageId);
      if (!bucket) {
        bucket = new Map();
        pending.set(frame.messageId, bucket);
      }
      bucket.set(frame.segmentIndex, frame.segment);
      scheduleFlush();
      return;
    }
  });

  // On sid change, clear and request a fresh list. Mirrors ChatView.tsx line 52-55.
  createEffect(() => {
    const sid = sidAccessor();
    clear();
    if (sid) {
      client.send({ v: 1, t: "chat.list.request", sid });
    }
  });

  const stats: Accessor<StreamingStats> = () => {
    const ms = messages();
    let streaming = false;
    for (const m of ms) {
      if (m.streaming) {
        streaming = true;
        break;
      }
    }
    return {
      count: ms.length,
      streaming,
      pendingOrphanUpdates: orphanCount(),
    };
  };

  function dispose(): void {
    unsubFrame();
    if (rafHandle) {
      rafHandle.cancel();
      rafHandle = null;
    }
    pending.clear();
    orphanUpdates.clear();
  }

  onCleanup(dispose);

  return {
    messages,
    stats,
    clear,
    dispose,
  };
}
