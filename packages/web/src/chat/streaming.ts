// [P4-H] rAF-coalesced streaming buffer for SDK chat messages.
//
// SDK sends chat.append(streaming:true) → flurry of chat.update/chat.delta
// → final chat.append(streaming:false). We coalesce per animation frame,
// keeping only the latest state for each (messageId, segmentIndex).
//
// [B12-A] chat.delta APPENDs textDelta to an existing text segment. Within
// a flush tick chat.update is an override; deltas queued in the same tick
// apply on top of it.
//
// [B13-B / B14-C] Reconnect replay (WIRED B14-C). Every chat.append/update/
// delta carries optional `seq`. Store tracks max via lastSeenSeq() and
// registers a resolver with the client; on WS reconnect the client folds
// `chatSince: <lastSeq>` into session.attach. Host answers with chat.replay
// { frames, lostCount } — lostCount === 0 → re-dispatch frames through the
// normal path; lostCount > 0 → fall back to chat.list.request. Old hosts
// omit seq → resolver returns undefined → chatSince stays null → legacy
// chat.list path is the safety net.
//
// This module is pure data reactivity — no JSX.
import type { ChatMessage, ChatSegment, Frame, SessionMeta } from "@rcc/protocol";
import { createSignal, createEffect, onCleanup, type Accessor } from "solid-js";
import type { RccClient } from "../client";
import { toast } from "../primitives/Toast";
import {
  createDebouncer,
  loadCachedMessages,
  saveMessages,
} from "../hooks/useOfflineHydrate";

export interface StreamingStats {
  count: number;
  streaming: boolean;
  /** Orphan frames (updates or deltas) still waiting for a parent message. */
  pendingOrphanUpdates: number;
}

export interface StreamingMessagesStore {
  messages: Accessor<ChatMessage[]>;
  stats: Accessor<StreamingStats>;
  /** [B14-C] Last seen chat-frame seq (across append/update/delta). Consumed
   * by the client so `session.attach` on reconnect can pass `chatSince`. */
  lastSeenSeq(): number | undefined;
  clear(): void;
  dispose(): void;
}

/** Same 200-message cap ChatView uses; keep memory bounded. */
const MAX_MESSAGES = 200;

/** Pure: replace `segmentIndex` with `incoming`, padding with empty text
 * segments if past the end (mirrors ChatView's defensive behavior). */
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

/** [B12-A] Pure: append `textDelta` to segments[segmentIndex].content iff
 * that segment exists and is kind:"text". Missing/non-text silently ignored
 * per `chat.delta` spec. Exported for tests/replay tools. */
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
  sessionsAccessor?: Accessor<readonly SessionMeta[]>,
): StreamingMessagesStore {
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);

  // messageId → segmentIndex → pending entry (flush on next rAF).
  const pending = new Map<string, Map<number, PendingEntry>>();
  // Frames that arrived before their chat.append — apply on insert.
  const orphanUpdates = new Map<string, Map<number, OrphanEntry>>();

  let rafHandle: { cancel: () => void } | null = null;

  // [B14-C] Highest chat-frame seq seen across append/update/delta. undefined
  // → host isn't seq-stamping (or nothing received yet); reattach sends
  // chatSince=null so host falls back to plain chat.list replay.
  let lastSeenSeq: number | undefined;
  function noteSeq(seq: number | undefined): void {
    if (typeof seq === "number" && (lastSeenSeq === undefined || seq > lastSeenSeq)) {
      lastSeenSeq = seq;
    }
  }

  // Re-register the per-sid chatSince resolver when active sid changes.
  let resolverSid: string | undefined;
  let unregisterResolver: (() => void) | null = null;
  function syncResolver(sid: string | undefined): void {
    if (sid === resolverSid) return;
    unregisterResolver?.();
    unregisterResolver = sid
      ? client.registerChatSinceResolver(sid, () => lastSeenSeq)
      : null;
    resolverSid = sid;
  }

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
    rafHandle = rafSchedule(() => { rafHandle = null; flush(); });
  }

  function flush(): void {
    if (pending.size === 0) return;
    // Snapshot + clear before setMessages so re-entrant frames during the
    // Solid update land on a fresh rAF batch.
    const drained = new Map(pending);
    pending.clear();

    setMessages((ms) => {
      let changed = false;
      let next = ms;
      for (const [messageId, segmentMap] of drained) {
        const idx = next.findIndex((m) => m.id === messageId);
        if (idx < 0) {
          // Message not present — re-park each entry as an orphan.
          for (const [sIdx, entry] of segmentMap) parkOrphan(messageId, sIdx, entry);
          continue;
        }
        const msg = next[idx]!;
        let segments = msg.segments;
        for (const [sIdx, entry] of segmentMap) segments = applyEntry(segments, sIdx, entry);
        if (segments !== msg.segments) {
          if (!changed) { next = next.slice(); changed = true; }
          next[idx] = { ...msg, segments };
        }
      }
      return changed ? next : ms;
    });
    recomputeOrphanCount();
  }

  function clear(): void {
    if (rafHandle) { rafHandle.cancel(); rafHandle = null; }
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

  /** [B14-C] Apply chat.append/update/delta for the current sid. Extracted
   * so chat.replay can re-dispatch buffered frames through the same path. */
  function handleChatFrame(frame: Frame, sid: string): void {
    if (frame.t === "chat.append" && frame.sid === sid) {
      noteSeq(frame.seq);
      const incoming = applyOrphansTo(frame.message);
      setMessages((ms) => {
        const idx = ms.findIndex((m) => m.id === incoming.id);
        if (idx >= 0) {
          // Finalizing a streaming message — also merge any pending entries
          // so the final frame doesn't race past them.
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
      noteSeq(frame.seq);
      const entry = getPendingEntry(frame.messageId, frame.segmentIndex);
      entry.override = frame.segment;
      entry.textAccum = "";
      scheduleFlush();
      return;
    }

    if (frame.t === "chat.delta" && frame.sid === sid) {
      noteSeq(frame.seq);
      if (frame.textDelta === "") return;
      getPendingEntry(frame.messageId, frame.segmentIndex).textAccum += frame.textDelta;
      scheduleFlush();
      return;
    }
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

    if (frame.t === "chat.replay" && frame.sid === sid) {
      // [B15-C] Dead-sid guard: drop silently if the sid isn't in our known
      // sessions (host tore it down but a replay raced in). Before any
      // pending/orphan mutation so state stays consistent.
      const known = sessionsAccessor?.();
      if (known && !known.some((s) => s.id === frame.sid)) return;
      // [B14-C] Reply to session.attach.chatSince. lostCount > 0 → cursor
      // older than host ring; re-hydrate via chat.list. Clear pending/orphans
      // but keep `messages` so user sees old prefix until chat.list replaces
      // wholesale (no flash). lostCount === 0 → re-dispatch buffered frames.
      if (frame.lostCount > 0) {
        pending.clear();
        orphanUpdates.clear();
        if (rafHandle) { rafHandle.cancel(); rafHandle = null; }
        setOrphanCount(0);
        // [B15-C] One toast per replay event (not per-frame) — the guard runs
        // before the re-dispatch loop, which fires per frame for lostCount=0.
        toast("会话快照回放窗口溢出 · 已重新加载", { tone: "warn" });
        client.send({ v: 1, t: "chat.list.request", sid });
        return;
      }
      for (const inner of frame.frames) handleChatFrame(inner, sid);
      return;
    }

    if (frame.t === "chat.append" || frame.t === "chat.update" || frame.t === "chat.delta") {
      handleChatFrame(frame, sid);
      return;
    }
  });

  // On sid change, clear and request a fresh list. Mirrors ChatView.tsx.
  // [B14-C] Also reset seq tracking and re-register the resolver so reconnect
  // replay scopes to the active session.
  // [B20-C] Seed from localStorage cache (if any) after clear so the user
  // still sees the last N messages when offline. chat.list (or chat.replay)
  // will overwrite whenever the WS delivers it.
  createEffect(() => {
    const sid = sidAccessor();
    clear();
    lastSeenSeq = undefined;
    syncResolver(sid);
    if (sid) {
      const cached = loadCachedMessages(sid);
      if (cached.length > 0) setMessages(cached);
      client.send({ v: 1, t: "chat.list.request", sid });
    }
  });

  // [B20-C] Debounced persistence of messages → localStorage, keyed by the
  // currently-active sid. Each sid change creates a new debouncer bound to
  // that sid; the previous one is flushed + disposed.
  let persistMessages: ReturnType<typeof createDebouncer> | null = null;
  let persistedSid: string | undefined;
  createEffect(() => {
    const sid = sidAccessor();
    if (sid !== persistedSid) {
      persistMessages?.flush();
      persistMessages?.dispose();
      persistMessages = sid
        ? createDebouncer(() => saveMessages(sid, messages()))
        : null;
      persistedSid = sid;
    }
    messages(); // track
    persistMessages?.schedule();
  });

  const stats: Accessor<StreamingStats> = () => {
    const ms = messages();
    const streaming = ms.some((m) => m.streaming);
    return { count: ms.length, streaming, pendingOrphanUpdates: orphanCount() };
  };

  function dispose(): void {
    unsubFrame();
    if (rafHandle) { rafHandle.cancel(); rafHandle = null; }
    pending.clear();
    orphanUpdates.clear();
    unregisterResolver?.();
    unregisterResolver = null;
    resolverSid = undefined;
    persistMessages?.flush();
    persistMessages?.dispose();
    persistMessages = null;
  }

  onCleanup(dispose);

  return {
    messages,
    stats,
    lastSeenSeq: () => lastSeenSeq,
    clear,
    dispose,
  };
}
