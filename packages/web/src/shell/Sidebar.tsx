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

  return (
    <nav
      class={[
        "h-full flex flex-col bg-bg-page font-sans",
        "text-text-primary",
      ].join(" ")}
      aria-label="会话导航"
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
          <span>新建会话</span>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          class="w-full"
          onClick={props.onNewProject}
        >
          <span aria-hidden="true">+</span>
          <span>新建项目</span>
        </Button>
        <TextInput
          value={props.search.query}
          onInput={(v) => props.search.onChange(v)}
          type="search"
          placeholder="搜索会话"
          aria-label="搜索会话"
        />
      </div>

      {/* Middle: results OR projects+peers */}
      <div class="flex-1 overflow-y-auto scrollbar p-2">
        <Show
          when={hasSearch()}
          fallback={
            <>
              {/* Projects */}
              <div class="flex items-center justify-between px-2 py-2">
                <div class="text-[10px] uppercase tracking-widest text-text-muted">
                  项目
                </div>
                <button
                  type="button"
                  onClick={props.onManageProjects}
                  class={[
                    "text-[11px] text-text-muted hover:text-text-primary",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm px-1",
                  ].join(" ")}
                  title="管理项目"
                >
                  管理
                </button>
              </div>
              <Show
                when={props.projects.length > 0}
                fallback={
                  <div class="px-2 py-4 text-[12px] text-text-muted">
                    暂无项目
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
                                暂无会话
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
                    远程 peers
                  </div>
                  <button
                    type="button"
                    onClick={props.onManagePeers}
                    class={[
                      "text-[11px] text-text-muted hover:text-text-primary",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm px-1",
                    ].join(" ")}
                    title="管理远程"
                  >
                    管理
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
                                ? "已连接"
                                : pr.error ?? "离线"
                            }
                            aria-label={pr.connected ? "已连接" : "离线"}
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
                                暂无会话
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
                  title="切换归档会话可见"
                >
                  {showArchived() ? "隐藏归档" : `显示归档 (${archivedCount()})`}
                </button>
              </Show>
            </>
          }
        >
          {/* Search results */}
          <div class="px-2 py-2">
            <div class="text-[10px] uppercase tracking-widest text-text-muted pb-1">
              搜索结果 ({props.search.results!.length})
            </div>
            <Show
              when={props.search.results!.length > 0}
              fallback={
                <div class="text-[12px] text-text-muted py-2">
                  无匹配结果
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
                      props.onActivateSession(m.sid);
                      props.search.onChange("");
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
          label="配置"
        />
        <FooterAction
          onClick={props.onOpenMarket}
          icon="⇩"
          label="市场"
        />
        <FooterAction
          onClick={props.onOpenDevices}
          icon="⚿"
          label="设备"
        />
        <FooterAction
          onClick={props.onManageProjects}
          icon="▤"
          label="项目管理"
        />
      </div>
    </nav>
  );
}

export default Sidebar;
