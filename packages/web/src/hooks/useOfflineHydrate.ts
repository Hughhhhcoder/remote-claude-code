// [B20-C] Offline cache helpers.
//
// Persist session list + last-N messages per sid to localStorage so that
// when the WS is down the user still sees something meaningful. Normal
// online flow is unaffected — writes happen as a debounced side-effect
// and reads seed the signal exactly once on store creation.
//
// Storage layout (all keys namespaced under `rcc.offline.`):
//   rcc.offline.sessions           → JSON [SessionMeta, …]   (≤ MAX_SESSIONS)
//   rcc.offline.messages.<sid>     → JSON [ChatMessage, …]   (≤ MAX_MESSAGES_PER_SID)
//   rcc.offline.messages.index     → JSON [sid, …]            (recency, newest first; ≤ MAX_SIDS)
//   rcc.offline.hydrated           → "1" if we seeded from cache this session

import type { ChatMessage, SessionMeta } from "@rcc/protocol";

const NS = "rcc.offline.";
export const OFFLINE_KEYS = {
  sessions: NS + "sessions",
  hydrated: NS + "hydrated",
  messagesPrefix: NS + "messages.",
  messagesIndex: NS + "messages.index",
};

export const MAX_SESSIONS = 50;
export const MAX_MESSAGES_PER_SID = 100;
export const MAX_SIDS = 20;

const DEBOUNCE_MS = 500;

function safeGet(key: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(key: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Read and JSON.parse with a fallback. Bad JSON or missing → fallback. */
export function readJSON<T>(key: string, fallback: T): T {
  const raw = safeGet(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Serialize + write. On QuotaExceededError, evict the oldest cached sid and
 * retry once; if still failing, give up silently. */
function writeJSONWithEvict(key: string, value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return;
  }
  if (safeSet(key, serialized)) return;
  // Eviction: drop the oldest sid bucket, then retry.
  const index = readJSON<string[]>(OFFLINE_KEYS.messagesIndex, []);
  if (index.length > 0) {
    const oldest = index[index.length - 1]!;
    safeRemove(OFFLINE_KEYS.messagesPrefix + oldest);
    safeSet(OFFLINE_KEYS.messagesIndex, JSON.stringify(index.slice(0, -1)));
    safeSet(key, serialized);
  }
}

/** Debounce helper — returns a schedule() fn and a flush() fn. Both no-op after dispose(). */
export function createDebouncer(fn: () => void, delayMs = DEBOUNCE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  return {
    schedule(): void {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delayMs);
    },
    flush(): void {
      if (disposed || !timer) return;
      clearTimeout(timer);
      timer = null;
      fn();
    },
    dispose(): void {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

// --- sessions --------------------------------------------------------------

export function loadCachedSessions(): SessionMeta[] {
  const list = readJSON<SessionMeta[]>(OFFLINE_KEYS.sessions, []);
  return Array.isArray(list) ? list.slice(0, MAX_SESSIONS) : [];
}

export function saveSessions(list: readonly SessionMeta[]): void {
  writeJSONWithEvict(OFFLINE_KEYS.sessions, list.slice(0, MAX_SESSIONS));
  safeSet(OFFLINE_KEYS.hydrated, "1");
}

// --- messages per sid ------------------------------------------------------

export function loadCachedMessages(sid: string): ChatMessage[] {
  const list = readJSON<ChatMessage[]>(OFFLINE_KEYS.messagesPrefix + sid, []);
  return Array.isArray(list) ? list.slice(-MAX_MESSAGES_PER_SID) : [];
}

export function saveMessages(sid: string, messages: readonly ChatMessage[]): void {
  const trimmed = messages.slice(-MAX_MESSAGES_PER_SID);
  writeJSONWithEvict(OFFLINE_KEYS.messagesPrefix + sid, trimmed);
  // Update recency index: bump sid to front, drop overflow.
  const index = readJSON<string[]>(OFFLINE_KEYS.messagesIndex, []);
  const next = [sid, ...index.filter((s) => s !== sid)].slice(0, MAX_SIDS);
  safeSet(OFFLINE_KEYS.messagesIndex, JSON.stringify(next));
  // Drop any sid buckets past the cap.
  for (const stale of index) {
    if (!next.includes(stale)) safeRemove(OFFLINE_KEYS.messagesPrefix + stale);
  }
}

/** True if we ever wrote an offline cache in any prior (or this) session. Used
 * by the UI to decide whether to show a "cached data" badge when disconnected. */
export function hasOfflineCache(): boolean {
  return safeGet(OFFLINE_KEYS.hydrated) === "1";
}
