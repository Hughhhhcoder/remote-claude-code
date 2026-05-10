import { createSignal, createMemo, createEffect } from "solid-js";
import type {
  GitStatusData,
  PermissionMode,
  SessionDriver,
  SessionMeta,
} from "@rcc/protocol";
import type { RccClient } from "../client.ts";
import { toast } from "../primitives/Toast.tsx";
import {
  createDebouncer,
  loadCachedSessions,
  saveSessions,
} from "../hooks/useOfflineHydrate.ts";

export type SessionsStore = ReturnType<typeof createSessionsStore>;

export interface SessionsStoreOptions {
  /**
   * Optional getter for the fallback project id used to bucket sessions
   * whose `projectId` is null or unknown. Provided as a getter (not a value)
   * to avoid a circular dependency with projectsStore — callers wire this
   * up with `() => projects.defaultProjectId()`.
   */
  defaultProjectId?: () => string | null;
}

export interface NewSessionOpts {
  cwd?: string;
  permissionMode?: PermissionMode;
  projectId?: string | null;
  driver?: SessionDriver;
  starterId?: string | null;
}

/**
 * Session domain store. Owns the list of sessions, the active sid, per-session
 * git status, and the sidebar's collapsed-project set.
 *
 * Frame dispatch (subset that App.tsx previously handled inline):
 *   hello / session.list  → replace sessions, seed activeSid, request git.status
 *   session.created       → append + setActive + request git.status
 *   session.resumed       → merge + setActive
 *   session.exited        → mark status=exited
 *   summary               → patch session.summary
 *   usage.session         → patch session.usage
 *   git.status            → update gitBySid[sid]
 *
 * NOT handled here (intentionally left in App.tsx for Phase 3-C):
 *   - starter bootstrap on session.created (timing-sensitive; uses
 *     workflow-runner + pendingStarterId flow that spans multiple stores)
 *   - viewMode flip to "chat" for SDK driver sessions (UI concern)
 *   - file-browser root seeding from first session cwd (UI concern)
 *   - confirm() dialog before closeSession (UI concern — caller decides)
 */
export function createSessionsStore(
  client: RccClient,
  options: SessionsStoreOptions = {},
) {
  const [sessions, setSessions] = createSignal<SessionMeta[]>(loadCachedSessions());
  const [activeSid, setActiveSid] = createSignal<string | null>(null);
  const [gitBySid, setGitBySid] = createSignal<
    Record<string, GitStatusData | null>
  >({});
  const [collapsedProjects, setCollapsedProjects] = createSignal<Set<string>>(
    new Set(),
  );
  const [pendingStarterId, setPendingStarterId] = createSignal<string | null>(
    null,
  );

  // --- Optimistic close rollback tracking ------------------------------
  // When the user closes a session we drop it locally before the host has
  // acknowledged. If the host rejects (error frame) or the next
  // `session.list` still contains the sid, we restore the snapshot and
  // toast the user. See B15-A.
  interface CloseSnapshot {
    session: SessionMeta;
    wasActive: boolean;
    timer: ReturnType<typeof setTimeout>;
  }
  const pendingCloses = new Map<string, CloseSnapshot>();
  const CLOSE_TIMEOUT_MS = 10_000;

  function rollbackClose(sid: string, reason: string): void {
    const snap = pendingCloses.get(sid);
    if (!snap) return;
    clearTimeout(snap.timer);
    pendingCloses.delete(sid);
    setSessions((s) =>
      s.some((x) => x.id === sid) ? s : [...s, snap.session],
    );
    if (snap.wasActive) setActiveSid(sid);
    toast(`关闭失败 · ${reason}`, { tone: "danger" });
  }

  function resolveClose(sid: string): void {
    const snap = pendingCloses.get(sid);
    if (!snap) return;
    clearTimeout(snap.timer);
    pendingCloses.delete(sid);
  }

  function requestGitStatusForMissing(list: readonly SessionMeta[]): void {
    const git = gitBySid();
    for (const s of list) {
      if (git[s.id] === undefined) {
        client.send({ v: 1, t: "git.status.request", sid: s.id });
      }
    }
  }

  const unsubFrame = client.on((frame) => {
    if (frame.t === "hello" || frame.t === "session.list") {
      // Reconcile optimistic closes: any pending sid still present in the
      // authoritative list means the host refused — rollback. Absent sids
      // confirm the close.
      if (pendingCloses.size > 0) {
        const present = new Set(frame.sessions.map((s) => s.id));
        for (const sid of Array.from(pendingCloses.keys())) {
          if (present.has(sid)) rollbackClose(sid, "主机仍持有该会话");
          else resolveClose(sid);
        }
      }
      setSessions(frame.sessions);
      if (!activeSid() && frame.sessions.length > 0) {
        setActiveSid(frame.sessions[0]!.id);
      }
      // The host publishes git.status on change, but late clients miss
      // the first emit — request for any sid we don't yet have.
      requestGitStatusForMissing(frame.sessions);
      return;
    }

    if (frame.t === "error") {
      // Host rejected a command. If it references a sid with a pending
      // close, roll that close back. Other error payloads are ignored
      // here — they surface elsewhere.
      if (frame.sid && pendingCloses.has(frame.sid)) {
        rollbackClose(frame.sid, frame.message || frame.code);
      }
      return;
    }

    if (frame.t === "session.created") {
      setSessions((s) => [...s, frame.session]);
      setActiveSid(frame.session.id);
      client.send({ v: 1, t: "git.status.request", sid: frame.session.id });
      return;
    }

    if (frame.t === "session.resumed") {
      setSessions((s) =>
        s.map((x) => (x.id === frame.session.id ? { ...x, ...frame.session } : x)),
      );
      setActiveSid(frame.session.id);
      return;
    }

    if (frame.t === "session.exited") {
      setSessions((s) =>
        s.map((x) => (x.id === frame.sid ? { ...x, status: "exited" } : x)),
      );
      return;
    }

    if (frame.t === "summary") {
      setSessions((s) =>
        s.map((x) =>
          x.id === frame.sid ? { ...x, summary: frame.summary ?? undefined } : x,
        ),
      );
      return;
    }

    if (frame.t === "usage.session") {
      setSessions((s) =>
        s.map((x) => (x.id === frame.sid ? { ...x, usage: frame.usage } : x)),
      );
      return;
    }

    if (frame.t === "git.status") {
      setGitBySid((m) => ({ ...m, [frame.sid]: frame.status }));
      return;
    }
  });

  // --- Actions ---------------------------------------------------------

  function newSession(opts: NewSessionOpts = {}): void {
    client.newSession({
      cwd: opts.cwd,
      permissionMode: opts.permissionMode,
      projectId: opts.projectId ?? undefined,
      driver: opts.driver,
      starterId: opts.starterId ?? undefined,
    });
  }

  /**
   * Optimistically remove the session locally and tell the host to close it.
   * Flips activeSid to the next available session when the active one is
   * dropped. Caller is responsible for any confirm() dialog.
   *
   * Rollback (B15-A): snapshots the session and starts a 10s timer. The
   * next `session.list` reconciles — if the sid is still present, or an
   * `error` frame with that sid arrives, we restore the snapshot and
   * surface a toast. The timer is a safety net for hosts that never reply.
   */
  function closeSession(sid: string): void {
    const prev = sessions().find((x) => x.id === sid);
    const wasActive = activeSid() === sid;
    client.closeSession(sid);
    setSessions((s) => s.filter((x) => x.id !== sid));
    if (wasActive) {
      const next = sessions().find((x) => x.id !== sid);
      setActiveSid(next?.id ?? null);
    }
    if (!prev) return;
    // Clear any in-flight close for the same sid before starting a new one.
    const existing = pendingCloses.get(sid);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(
      () => rollbackClose(sid, "请求超时"),
      CLOSE_TIMEOUT_MS,
    );
    pendingCloses.set(sid, { session: prev, wasActive, timer });
  }

  /**
   * Ask the host to reopen the pty/SDK for an archived session. Optimistically
   * flips status to "running" locally; host will broadcast session.resumed
   * which the frame handler will merge into place.
   */
  function resumeSession(sid: string): void {
    client.resumeSession(sid);
    setSessions((s) =>
      s.map((x) => (x.id === sid ? { ...x, status: "running" } : x)),
    );
    setActiveSid(sid);
  }

  /**
   * Signal the caller's intent to share a session — the actual share modal
   * is UI, so this just returns the sid so the UI layer can open the modal.
   * Kept as a method so the call site reads `sessions.shareSession(sid)`.
   */
  function shareSession(sid: string): string {
    return sid;
  }

  function toggleProjectCollapsed(id: string): void {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // --- Derived ---------------------------------------------------------

  // [B20-C] Persist session list to localStorage (debounced) so offline
  // sessions can render a last-known list. Online flow is unaffected —
  // the next `session.list` frame overwrites the signal which retriggers
  // this effect.
  const persistSessions = createDebouncer(() => saveSessions(sessions()));
  createEffect(() => {
    sessions(); // track
    persistSessions.schedule();
  });

  /**
   * Sessions bucketed by projectId. Local sessions with no projectId (or a
   * projectId that doesn't map to a known project) fall under the
   * `defaultProjectId()` bucket. Remote (peerId) sessions are excluded — use
   * `sessionsByPeer` for those.
   */
  const sessionsByProject = createMemo(() => {
    const fallback = options.defaultProjectId?.() ?? null;
    const groups = new Map<string, SessionMeta[]>();
    if (fallback) groups.set(fallback, []);
    for (const s of sessions()) {
      if (s.peerId) continue;
      const key = s.projectId ?? fallback;
      if (!key) continue;
      const arr = groups.get(key) ?? [];
      arr.push(s);
      groups.set(key, arr);
    }
    return groups;
  });

  const sessionsByPeer = createMemo(() => {
    const groups = new Map<string, SessionMeta[]>();
    for (const s of sessions()) {
      if (!s.peerId) continue;
      const arr = groups.get(s.peerId) ?? [];
      arr.push(s);
      groups.set(s.peerId, arr);
    }
    return groups;
  });

  function activeSession(): SessionMeta | undefined {
    const sid = activeSid();
    if (!sid) return undefined;
    return sessions().find((x) => x.id === sid);
  }

  function activeSessionProjectId(): string | null {
    return activeSession()?.projectId ?? null;
  }

  return {
    // State getters
    sessions,
    activeSid,
    gitBySid,
    collapsedProjects,
    pendingStarterId,

    // Setters / actions
    setActiveSid,
    setPendingStarter: setPendingStarterId,
    newSession,
    closeSession,
    resumeSession,
    shareSession,
    toggleProjectCollapsed,

    // Derived
    sessionsByProject,
    sessionsByPeer,
    activeSession,
    activeSessionProjectId,

    dispose: () => {
      for (const snap of pendingCloses.values()) clearTimeout(snap.timer);
      pendingCloses.clear();
      persistSessions.flush();
      persistSessions.dispose();
      unsubFrame();
    },
  };
}
