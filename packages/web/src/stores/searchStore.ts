import { createMemo, createSignal } from "solid-js";
import type { SearchMatch } from "@rcc/protocol";
import type { RccClient } from "../client.ts";

export type SearchHit = SearchMatch;

export type SearchMode = "idle" | "searching" | "results";

export interface SearchStore {
  query: () => string;
  results: () => SearchHit[] | null;
  mode: () => SearchMode;
  /** Set query. Empty → clears results. Non-empty → sends search.request. */
  setQuery: (q: string) => void;
  /** Clear results without touching the query text. */
  clearResults: () => void;
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
    dispose: unsub,
  };
}
