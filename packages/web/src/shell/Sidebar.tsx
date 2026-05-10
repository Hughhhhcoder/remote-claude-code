import { For, Show, createMemo, createSignal, type JSX } from "solid-js";
import type {
  SessionMeta,
  ProjectMeta,
  PeerInfo,
  GitStatusData,
} from "@rcc/protocol";
import { Button } from "../primitives/Button.tsx";
import { TextInput } from "../primitives/TextInput.tsx";
import { SessionRow } from "../sessions/SessionRow.tsx";
import { ProjectHeader } from "../sessions/ProjectHeader.tsx";
import { usePullToRefresh } from "../hooks/usePullToRefresh.ts";
import { useIsMobile } from "../hooks/useMediaQuery.ts";
import { t, tt } from "../i18n/index.ts";

/**
 * Sidebar — single responsive sidebar for RCC v0.2.
 *
 * Works at both desktop column (300px) and mobile drawer (320px) widths
 * without per-form variants. Uses font-sans (chrome, not content).
 *
 * Layout:
 *   [header]   new-session + new-project + search  (shrink-0)
 *   [middle]   search results OR projects/sessions + remote peers (flex-1 scroll)
 *   [footer]   config / marketplace / devices / projects (shrink-0)
 *
 * No protocol frame sends happen in this component — all actions bubble
 * through props callbacks so Phase 3 stores can wire them up later.
 */

export type SearchHit = {
  sid: string;
  title: string;
  score: number;
  excerpts: string[];
};

export interface SidebarProps {
  projects: ProjectMeta[];
  sessions: SessionMeta[];
  peers: PeerInfo[];
  activeSid: string | null;
  gitBySid: Record<string, GitStatusData | null>;
  search: {
    query: string;
    onChange: (q: string) => void;
    results: SearchHit[] | null;
  };
  collapsedProjects: Set<string>;
  onToggleProject: (id: string) => void;
  onActivateSession: (sid: string) => void;
  /**
   * [B28-C] Invoked when a search result is clicked, in addition to
   * `onActivateSession`. The caller can use this to request the chat scroll
   * to the matched message (when the host surfaces a `messageId`) and to
   * stop clearing the search query on activation if desired.
   */
  onSearchResultClick?: (sid: string, messageId?: string) => void;
  onCloseSession: (sid: string) => void;
  onResumeSession: (sid: string) => void;
  onShareSession: (sid: string) => void;
  /** [B23-B] Apply a partial update of user-editable session metadata. */
  onSetSessionMeta?: (sid: string, patch: { pinned?: boolean; archived?: boolean; tags?: string[] }) => void;
  /** [B23-C] Manually rename a session. `null` clears any custom title. */
  onRenameSession?: (sid: string, title: string | null) => void;
  onNewSession: (projectId?: string) => void;
  onNewProject: () => void;
  onOpenConfig: () => void;
  onOpenMarket: () => void;
  onOpenDevices: () => void;
  onManageProjects: () => void;
  onManagePeers: () => void;
  /**
   * [B29-A] Invoked when the user completes a pull-to-refresh gesture on
   * the mobile sessions list. The caller should trigger a fresh
   * `session.list` frame on the websocket. Optional; when omitted the
   * gesture is inert.
   */
  onRefreshSessions?: () => void | Promise<void>;
}

const PEER_DOT: Record<string, string> = {
  violet: "bg-violet-400",
  teal: "bg-teal-400",
  orange: "bg-orange-400",
  pink: "bg-pink-400",
  cyan: "bg-cyan-400",
};

function peerDot(color: string | undefined): string {
  return PEER_DOT[color ?? "violet"] ?? PEER_DOT.violet;
}

/**
 * Ghost button for the footer. Matches Button(variant=ghost,size=sm) but
 * left-aligned with an icon glyph slot — the primitive is centered.
 */
function FooterAction(props: {
  onClick: () => void;
  icon: string;
  label: string;
  title?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title ?? props.label}
      class={[
        "w-full flex items-center gap-2 px-2 py-2 rounded-md",
        "font-sans text-[13px] text-text-secondary",
        "hover:text-text-primary hover:bg-bg-surfaceStrong",
        "transition-colors duration-fast ease-rcc",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      ].join(" ")}
    >
      <span aria-hidden="true" class="w-4 text-center text-text-muted">
        {props.icon}
      </span>
      <span class="truncate">{props.label}</span>
    </button>
  );
}

export function Sidebar(props: SidebarProps): JSX.Element {
  // [B23-B] Archived sessions hidden by default; toggled by footer button.
  const [showArchived, setShowArchived] = createSignal(false);

  // Pinned first, then running/exited by original order. Archived filtered
  // out unless `showArchived()` is true.
  function orderSessions(list: SessionMeta[]): SessionMeta[] {
    const visible = list.filter((s) => showArchived() || !s.archived);
    return visible.slice().sort((a, b) => {
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return 0;
    });
  }

  // Group sessions by local project id — peer sessions handled separately.
  const sessionsByProject = createMemo<Map<string, SessionMeta[]>>(() => {
    const m = new Map<string, SessionMeta[]>();
    for (const s of props.sessions) {
      if (s.peerId) continue; // remote — shown under peers
      const key = s.projectId ?? "__default__";
      const list = m.get(key) ?? [];
      list.push(s);
      m.set(key, list);
    }
    // Apply ordering per project.
    for (const [k, v] of m) m.set(k, orderSessions(v));
    return m;
  });

  const sessionsByPeer = createMemo<Map<string, SessionMeta[]>>(() => {
    const m = new Map<string, SessionMeta[]>();
    for (const s of props.sessions) {
      if (!s.peerId) continue;
      const list = m.get(s.peerId) ?? [];
      list.push(s);
      m.set(s.peerId, list);
    }
    for (const [k, v] of m) m.set(k, orderSessions(v));
    return m;
  });

  const archivedCount = createMemo(
    () => props.sessions.filter((s) => s.archived).length,
  );

  const hasSearch = () => !!props.search.results;

  // [B29-A] Pull-to-refresh — mobile only; desktop users have the reconnect
  // banner + hello handshake to resync. `handlers` are no-ops off-touch so
  // wheel scrolling is untouched.
  const isMobile = useIsMobile();
  const ptr = usePullToRefresh({
    onRefresh: async () => {
      if (props.onRefreshSessions) {
        await props.onRefreshSessions();
      }
    },
    threshold: 64,
    maxOffset: 120,
  });

  return (
    <nav
      class={[
        "h-full flex flex-col bg-bg-page font-sans",
        "text-text-primary",
      ].join(" ")}
      aria-label={t("sidebar.sessionsNavAria")}
    >
      {/* Header: new-session, new-project, search */}
      <div class="shrink-0 p-3 border-b border-border-subtle space-y-2">
        <Button
          variant="primary"
          size="md"
          class="w-full"
          onClick={() => props.onNewSession()}
        >
          <span aria-hidden="true">+</span>
          <span>{t("sidebar.newSessionBtn")}</span>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          class="w-full"
          onClick={props.onNewProject}
        >
          <span aria-hidden="true">+</span>
          <span>{t("sidebar.newProjectBtn")}</span>
        </Button>
        <TextInput
          value={props.search.query}
          onInput={(v) => props.search.onChange(v)}
          type="search"
          placeholder={t("sidebar.searchPlaceholderShort")}
          aria-label={t("sidebar.searchAria")}
        />
      </div>

      {/* Middle: results OR projects+peers */}
      <div
        ref={(el) => ptr.ref(isMobile() ? el : null)}
        class="relative flex-1 overflow-y-auto scrollbar p-2"
        onPointerDown={isMobile() ? ptr.handlers.onPointerDown : undefined}
        onPointerMove={isMobile() ? ptr.handlers.onPointerMove : undefined}
        onPointerUp={isMobile() ? ptr.handlers.onPointerUp : undefined}
        onPointerCancel={isMobile() ? ptr.handlers.onPointerCancel : undefined}
        style={{
          transform: ptr.offset() > 0 ? `translateY(${ptr.offset()}px)` : undefined,
          transition:
            ptr.state() === "dragging" ? "none" : "transform 200ms ease-out",
        }}
      >
        {/* Pull-to-refresh indicator — floats above the scroll content. */}
        <Show when={isMobile() && ptr.state() !== "idle"}>
          <div
            class="pointer-events-none absolute inset-x-0 flex items-center justify-center"
            style={{
              top: `-${ptr.threshold}px`,
              height: `${ptr.threshold}px`,
            }}
            aria-live="polite"
            aria-label={
              ptr.state() === "refreshing"
                ? t("sidebar.refreshing")
                : ptr.state() === "success"
                  ? t("sidebar.refreshed")
                  : t("sidebar.pullToRefresh")
            }
          >
            <Show
              when={ptr.state() === "success"}
              fallback={
                <span
                  class={[
                    "inline-block w-5 h-5 rounded-full border-2 border-text-muted border-t-accent",
                    ptr.state() === "refreshing" ? "animate-spin" : "",
                  ].join(" ")}
                  style={{
                    opacity: String(
                      Math.min(1, ptr.offset() / ptr.threshold),
                    ),
                    transform:
                      ptr.state() === "dragging"
                        ? `rotate(${(ptr.offset() / ptr.threshold) * 360}deg)`
                        : undefined,
                  }}
                  aria-hidden="true"
                />
              }
            >
              <span class="text-success text-[16px]" aria-hidden="true">
                ✓
              </span>
            </Show>
          </div>
        </Show>
        <Show
          when={hasSearch()}
          fallback={
            <>
              {/* Projects */}
              <div class="flex items-center justify-between px-2 py-2">
                <div class="text-[10px] uppercase tracking-widest text-text-muted">
                  {t("sidebar.projectsHeader")}
                </div>
                <button
                  type="button"
                  onClick={props.onManageProjects}
                  class={[
                    "text-[11px] text-text-muted hover:text-text-primary",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm px-1",
                  ].join(" ")}
                  title={t("sidebar.manageProjectsTitle")}
                >
                  {t("sidebar.manage")}
                </button>
              </div>
              <Show
                when={props.projects.length > 0}
                fallback={
                  <div class="px-2 py-4 text-[12px] text-text-muted">
                    {t("sidebar.noProjectsShort")}
                  </div>
                }
              >
                <For each={props.projects}>
                  {(p) => {
                    const sess = createMemo(
                      () => sessionsByProject().get(p.id) ?? [],
                    );
                    const collapsed = createMemo(() =>
                      props.collapsedProjects.has(p.id),
                    );
                    return (
                      <div class="mb-2">
                        <ProjectHeader
                          project={p}
                          sessionCount={sess().length}
                          collapsed={collapsed()}
                          onToggle={() => props.onToggleProject(p.id)}
                          onNewSession={() => props.onNewSession(p.id)}
                        />
                        <Show when={!collapsed()}>
                          <div class="pl-4 pr-2 pt-0.5 pb-1 text-[11px] font-mono text-text-muted truncate">
                            {p.cwd}
                          </div>
                          <Show
                            when={sess().length > 0}
                            fallback={
                              <div class="pl-4 px-2 py-1 text-[11px] text-text-muted italic">
                                {t("sidebar.noSessionsShort")}
                              </div>
                            }
                          >
                            <div class="pl-2">
                              <For each={sess()}>
                                {(s) => (
                                  <SessionRow
                                    session={s}
                                    active={props.activeSid === s.id}
                                    git={props.gitBySid[s.id]}
                                    onActivate={() =>
                                      props.onActivateSession(s.id)
                                    }
                                    onClose={() => props.onCloseSession(s.id)}
                                    onResume={() => props.onResumeSession(s.id)}
                                    onShare={() => props.onShareSession(s.id)}
                                    onSetMeta={
                                      props.onSetSessionMeta
                                        ? (patch) =>
                                            props.onSetSessionMeta!(s.id, patch)
                                        : undefined
                                    }
                                    onRename={
                                      props.onRenameSession
                                        ? (title) =>
                                            props.onRenameSession!(s.id, title)
                                        : undefined
                                    }
                                  />
                                )}
                              </For>
                            </div>
                          </Show>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </Show>

              {/* Remote peers */}
              <Show when={props.peers.length > 0}>
                <div class="flex items-center justify-between px-2 py-2 mt-2 border-t border-border-subtle">
                  <div class="text-[10px] uppercase tracking-widest text-text-muted">
                    {t("sidebar.remotePeersShort")}
                  </div>
                  <button
                    type="button"
                    onClick={props.onManagePeers}
                    class={[
                      "text-[11px] text-text-muted hover:text-text-primary",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm px-1",
                    ].join(" ")}
                    title={t("sidebar.manageRemoteTitle")}
                  >
                    {t("sidebar.manage")}
                  </button>
                </div>
                <For each={props.peers}>
                  {(pr) => {
                    const sess = createMemo(
                      () => sessionsByPeer().get(pr.id) ?? [],
                    );
                    return (
                      <div class="mb-2">
                        <div class="flex items-center gap-1.5 px-2 py-2 rounded-md hover:bg-bg-surfaceStrong min-h-[40px]">
                          <span
                            class={`w-1.5 h-1.5 rounded-full shrink-0 ${peerDot(pr.color)}`}
                            aria-hidden="true"
                          />
                          <span class="text-[13px] font-medium text-text-primary truncate flex-1">
                            {pr.label}
                          </span>
                          <span
                            class={[
                              "w-1.5 h-1.5 rounded-full shrink-0",
                              pr.connected ? "bg-success" : "bg-text-muted/50",
                            ].join(" ")}
                            title={
                              pr.connected
                                ? t("sidebar.connectedShort")
                                : pr.error ?? t("sidebar.offlineShort")
                            }
                            aria-label={pr.connected ? t("sidebar.connectedShort") : t("sidebar.offlineShort")}
                          />
                          <span class="text-[11px] text-text-muted shrink-0">
                            {sess().length}
                          </span>
                        </div>
                        <Show when={!pr.connected && pr.error}>
                          <div class="pl-4 text-[11px] text-danger px-2 mb-1 truncate">
                            {pr.error}
                          </div>
                        </Show>
                        <Show
                          when={sess().length > 0}
                          fallback={
                            <Show when={pr.connected}>
                              <div class="pl-4 px-2 py-1 text-[11px] text-text-muted italic">
                                {t("sidebar.noSessionsShort")}
                              </div>
                            </Show>
                          }
                        >
                          <div class="pl-2">
                            <For each={sess()}>
                              {(s) => (
                                <SessionRow
                                  session={s}
                                  active={props.activeSid === s.id}
                                  git={props.gitBySid[s.id]}
                                  onActivate={() =>
                                    props.onActivateSession(s.id)
                                  }
                                  onClose={() => props.onCloseSession(s.id)}
                                  onResume={() => props.onResumeSession(s.id)}
                                  onShare={() => props.onShareSession(s.id)}
                                  onSetMeta={
                                    props.onSetSessionMeta
                                      ? (patch) =>
                                          props.onSetSessionMeta!(s.id, patch)
                                      : undefined
                                  }
                                  onRename={
                                    props.onRenameSession
                                      ? (title) =>
                                          props.onRenameSession!(s.id, title)
                                      : undefined
                                  }
                                />
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </Show>
              {/* [B23-B] Archived toggle — only shown when any session is archived. */}
              <Show when={archivedCount() > 0}>
                <button
                  type="button"
                  onClick={() => setShowArchived((v) => !v)}
                  class={[
                    "mt-3 w-full text-left px-2 py-2 rounded-md",
                    "font-sans text-[12px] text-text-muted",
                    "hover:text-text-primary hover:bg-bg-surfaceStrong",
                  ].join(" ")}
                  title={t("sidebar.toggleArchivedTitle")}
                >
                  {showArchived() ? t("sidebar.hideArchived") : tt("sidebar.showArchived", { n: archivedCount() })}
                </button>
              </Show>
            </>
          }
        >
          {/* Search results */}
          <div class="px-2 py-2">
            <div class="text-[10px] uppercase tracking-widest text-text-muted pb-1">
              {tt("sidebar.searchResultsCount", { n: props.search.results!.length })}
            </div>
            <Show
              when={props.search.results!.length > 0}
              fallback={
                <div class="text-[12px] text-text-muted py-2">
                  {t("sidebar.noMatchResults")}
                </div>
              }
            >
              <For each={props.search.results!}>
                {(m) => (
                  <button
                    type="button"
                    class={[
                      "w-full text-left p-2 rounded-md block min-h-[44px]",
                      "hover:bg-bg-surfaceStrong transition-colors duration-fast ease-rcc",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    ].join(" ")}
                    onClick={() => {
                      // [B28-C] Notify the app so it can stash a scroll
                      // target before the session activates. SearchMatch
                      // doesn't carry a messageId today — fine, jumpTo
                      // degrades to "jump to session" in that case.
                      props.onSearchResultClick?.(m.sid);
                      props.onActivateSession(m.sid);
                      // Keep the query so the in-chat N/M overlay stays
                      // visible; users can clear it explicitly if desired.
                    }}
                  >
                    <div class="font-serif text-[14px] text-text-primary truncate">
                      {m.title}
                    </div>
                    <div class="font-mono text-[11px] text-text-muted truncate">
                      {m.sid}
                    </div>
                    <For each={m.excerpts}>
                      {(ex) => (
                        <div class="text-[11px] text-text-secondary mt-1 line-clamp-2">
                          {ex}
                        </div>
                      )}
                    </For>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </div>

      {/* Footer actions */}
      <div class="shrink-0 p-3 border-t border-border-subtle space-y-1">
        <FooterAction
          onClick={props.onOpenConfig}
          icon="⚙"
          label={t("sidebar.configLabel")}
        />
        <FooterAction
          onClick={props.onOpenMarket}
          icon="⇩"
          label={t("sidebar.marketplaceLabel")}
        />
        <FooterAction
          onClick={props.onOpenDevices}
          icon="⚿"
          label={t("sidebar.devicesLabel")}
        />
        <FooterAction
          onClick={props.onManageProjects}
          icon="▤"
          label={t("sidebar.projectsManageLabel")}
        />
      </div>
    </nav>
  );
}

export default Sidebar;
