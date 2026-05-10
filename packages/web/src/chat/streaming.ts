// [P4-H] rAF-coalesced streaming buffer for SDK chat messages.
//
// Background: the SDK driver sends one `chat.append` (streaming:true) when a
// new assistant message starts, then a burst of `chat.update` / `chat.delta`
// frames as content arrives, then a final `chat.append` (streaming:false)
// with the completed message. Here we coalesce per animation frame, keeping
// only the latest state for each (messageId, segmentIndex) before flushing
// into a Solid signal.
//
// [B12-A] Consumes `chat.delta` (B11-B) which APPENDs textDelta to an
// existing text segment rather than replacing it. Within a flush tick a
// chat.update is an "override" that wins over previous content; deltas
// queued in the same tick still apply on top of it.
//
// This module is pure data reactivity — no JSX. MessageRow handles the
// blinking-cursor affordance based on `ChatMessage.streaming`.
import type { ChatMessage, ChatSegment, Frame } from "@rcc/protocol";
import { createSignal, createEffect, onCleanup, type Accessor } from "solid-js";
import type { RccClient } from "../client";

export interface StreamingStats {
  count: number;
  streaming: boolean;
  /** Orphan frames (updates or deltas) still waiting for a parent message. */
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

/**
 * [B12-A] Pure: append `textDelta` to segments[segmentIndex].content iff that
 * segment exists and is kind:"text". Per `chat.delta` spec missing/non-text
 * targets are silently ignored. Exported for reuse (tests, replay tools).
 */
export function applyTextDelta(
  existing: ChatSegment[],
  segmentIndex: number,
  textDelta: string,
): ChatSegment[] {
  if (segmentIndex < 0 || segmentIndex >= existing.length) return existing;
  const seg = existing[segmentIndex]!;
  if (seg.kind !== "text" || textDelta === "") return existing;
  const next = existing.slice();
  next[segmentIndex] = { ...seg, content: seg.content + textDelta };
  return next;
}

/** Per-(messageId, segmentIndex) pending entry. override (from chat.update)
 * replaces content; textAccum (coalesced chat.delta strings in arrival order)
 * is applied on top of override OR the existing segment. See flush(). */
interface PendingEntry {
  override?: ChatSegment;
  textAccum: string;
}

/** Union stored in orphanUpdates — full-segment replacement or delta accum.
 * Both drain when the parent chat.append arrives. */
type OrphanEntry =
  | { kind: "segment"; segment: ChatSegment }
  | { kind: "delta"; textAccum: string };

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

  // messageId → segmentIndex → pending entry (flush on next rAF).
  const pending = new Map<string, Map<number, PendingEntry>>();
  // Frames that arrived before their chat.append — apply on insert.
  const orphanUpdates = new Map<string, Map<number, OrphanEntry>>();

  let rafHandle: { cancel: () => void } | null = null;

  const [orphanCount, setOrphanCount] = createSignal(0);

  function recomputeOrphanCount(): void {
    let n = 0;
    for (const m of orphanUpdates.values()) n += m.size;
    setOrphanCount(n);
  }

  function getPendingEntry(messageId: string, segmentIndex: number): PendingEntry {
    let bucket = pending.get(messageId);
    if (!bucket) {
      bucket = new Map();
      pending.set(messageId, bucket);
    }
    let entry = bucket.get(segmentIndex);
    if (!entry) {
      entry = { textAccum: "" };
      bucket.set(segmentIndex, entry);
    }
    return entry;
  }

  function parkOrphan(messageId: string, segmentIndex: number, entry: PendingEntry): void {
    let bucket = orphanUpdates.get(messageId);
    if (!bucket) {
      bucket = new Map();
      orphanUpdates.set(messageId, bucket);
    }
    const existing = bucket.get(segmentIndex);
    if (entry.override) {
      // Full replacement wins; fold textAccum onto it so drain emits one seg.
      let seg = entry.override;
      if (entry.textAccum && seg.kind === "text") {
        seg = { ...seg, content: seg.content + entry.textAccum };
      }
      bucket.set(segmentIndex, { kind: "segment", segment: seg });
    } else if (entry.textAccum) {
      if (existing?.kind === "segment") {
        const seg = existing.segment;
        if (seg.kind === "text") {
          bucket.set(segmentIndex, {
            kind: "segment",
            segment: { ...seg, content: seg.content + entry.textAccum },
          });
        }
        // Non-text parked segment + delta: spec says ignore the delta.
      } else if (existing?.kind === "delta") {
        bucket.set(segmentIndex, {
          kind: "delta",
          textAccum: existing.textAccum + entry.textAccum,
        });
      } else {
        bucket.set(segmentIndex, { kind: "delta", textAccum: entry.textAccum });
      }
    }
  }

  /** Apply a pending entry onto a segments array (update-then-delta order). */
  function applyEntry(segments: ChatSegment[], sIdx: number, entry: PendingEntry): ChatSegment[] {
    let out = segments;
    if (entry.override) out = mergeSegments(out, sIdx, entry.override);
    if (entry.textAccum) out = applyTextDelta(out, sIdx, entry.textAccum);
    return out;
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
    // Solid update goes onto a fresh rAF batch.
    const drained = new Map(pending);
    pending.clear();

    setMessages((ms) => {
      let changed = false;
      let next = ms;
      for (const [messageId, segmentMap] of drained) {
        const idx = next.findIndex((m) => m.id === messageId);
        if (idx < 0) {
          // Message not present — re-park each entry as an orphan.
          for (const [sIdx, entry] of segmentMap) {
            parkOrphan(messageId, sIdx, entry);
          }
          continue;
        }
        const msg = next[idx]!;
        let segments = msg.segments;
        for (const [sIdx, entry] of segmentMap) {
          segments = applyEntry(segments, sIdx, entry);
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
    for (const [sIdx, entry] of bucket) {
      if (entry.kind === "segment") {
        segments = mergeSegments(segments, sIdx, entry.segment);
      } else {
        segments = applyTextDelta(segments, sIdx, entry.textAccum);
      }
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
          // Also merge any pending entries that haven't flushed yet so the
          // final frame doesn't race past them.
          const pendingForMsg = pending.get(incoming.id);
          let finalized = incoming;
          if (pendingForMsg) {
            let segments = incoming.segments;
            for (const [sIdx, entry] of pendingForMsg) {
              segments = applyEntry(segments, sIdx, entry);
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
      const entry = getPendingEntry(frame.messageId, frame.segmentIndex);
      // New override wins over any previously accumulated delta text for this
      // slot; later deltas in the same tick append on top.
      entry.override = frame.segment;
      entry.textAccum = "";
      scheduleFlush();
      return;
    }

    if (frame.t === "chat.delta" && frame.sid === sid) {
      if (frame.textDelta === "") return;
      getPendingEntry(frame.messageId, frame.segmentIndex).textAccum += frame.textDelta;
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
