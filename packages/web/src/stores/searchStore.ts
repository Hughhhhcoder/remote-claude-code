import { createMemo, createSignal } from "solid-js";
import type { SearchMatch } from "@rcc/protocol";
import type { RccClient } from "../client.ts";

export type SearchHit = SearchMatch;

export type SearchMode = "idle" | "searching" | "results";

/**
 * [B28-C] When a search result is clicked we remember the (sid, messageId?)
 * target so the chat surface can scroll to it after the session is activated.
 * `messageId` is optional — today's `search.result` frames only carry `sid`
 * so jumpTo degrades to "just scroll into the active session" when the id is
 * absent. Consumed once by `consumeScrollTarget(sid)`: that caller reads the
 * pending target only if its sid matches and then clears it, so the same
 * jump doesn't re-fire on every re-render.
 */
export interface ScrollTarget {
  sid: string;
  messageId?: string;
}

export interface SearchStore {
  query: () => string;
  results: () => SearchHit[] | null;
  mode: () => SearchMode;
  /** Set query. Empty → clears results. Non-empty → sends search.request. */
  setQuery: (q: string) => void;
  /** Clear results without touching the query text. */
  clearResults: () => void;
  /** [B28-C] Request a jump into a session at a specific message. */
  jumpTo: (sid: string, messageId?: string) => void;
  /**
   * [B28-C] If the pending scroll target matches `sid`, return its messageId
   * (possibly undefined) and clear the pending state. Otherwise returns null
   * — the caller should not scroll.
   */
  consumeScrollTarget: (sid: string) => string | undefined | null;
  /** [B28-C] Current pending target, if any (read-only accessor). */
  pendingScrollTarget: () => ScrollTarget | null;
  dispose: () => void;
}

/**
 * Owns the sidebar search box. Frames consumed:
 *   - search.result → adopt matches if the echoed query matches our current
 *
 * Host-side search is async, so we tag matches with the query they were
 * issued for and drop late replies that no longer correspond to what the
 * user typed.
 */
export function createSearchStore(client: RccClient): SearchStore {
  const [query, setQueryInternal] = createSignal("");
  const [results, setResults] = createSignal<SearchHit[] | null>(null);
  const [pending, setPending] = createSignal<ScrollTarget | null>(null);

  const unsub = client.on((frame) => {
    if (frame.t === "search.result") {
      if (frame.query === query()) setResults(frame.matches);
    }
  });

  function setQuery(q: string): void {
    setQueryInternal(q);
    if (!q.trim()) {
      setResults(null);
      return;
    }
    client.send({ v: 1, t: "search.request", query: q });
  }

  function clearResults(): void {
    setResults(null);
  }

  function jumpTo(sid: string, messageId?: string): void {
    setPending({ sid, messageId });
  }

  function consumeScrollTarget(sid: string): string | undefined | null {
    const p = pending();
    if (!p || p.sid !== sid) return null;
    setPending(null);
    return p.messageId;
  }

  const mode = createMemo<SearchMode>(() => {
    if (!query().trim()) return "idle";
    if (results() === null) return "searching";
    return "results";
  });

  return {
    query,
    results,
    mode,
    setQuery,
    clearResults,
    jumpTo,
    consumeScrollTarget,
    pendingScrollTarget: pending,
    dispose: unsub,
  };
}
