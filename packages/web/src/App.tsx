import { createSignal, createMemo, lazy, onCleanup, onMount, For, Show } from "solid-js";
import type {
  CommandSummary,
  GitStatusData,
  PeerInfo,
  PermissionMode,
  ProjectColor,
  ProjectMeta,
  SessionDriver,
  SessionMeta,
  SessionUsage,
  Starter,
  TunnelInfo,
} from "@rcc/protocol";
import { RccClient, defaultWsUrl, type ConnStatus } from "./client.ts";
import { TerminalView } from "./TerminalView.tsx";
import { ChatView } from "./ChatView.tsx";
import { NewSessionModal, permissionChip } from "./NewSessionModal.tsx";
import { NewProjectModal, PROJECT_DOT_CLS } from "./NewProjectModal.tsx";
import { ProjectsModal } from "./ProjectsModal.tsx";
import { PeersModal, peerDotCls } from "./PeersModal.tsx";
import { PairingView } from "./PairingView.tsx";
import { DevicesModal } from "./DevicesModal.tsx";
import { ConfigView } from "./ConfigView.tsx";
import { MarketplaceView } from "./MarketplaceView.tsx";
const FileBrowser = lazy(() =>
  import("./FileBrowser.tsx").then((m) => ({ default: m.FileBrowser })),
);
import { NotebookView } from "./NotebookView.tsx";
import { MobileKeyBar } from "./MobileKeyBar.tsx";
import { useIsMobile } from "./useIsMobile.ts";
import { InstallPrompt } from "./InstallPrompt.tsx";
import { PermissionApproval } from "./PermissionApproval.tsx";
import { PushPrompt } from "./PushPrompt.tsx";
import { VersionBadge } from "./VersionBadge.tsx";
import { MetricsPanel } from "./MetricsPanel.tsx";
import { clearToken, loadToken } from "./auth.ts";
import { SettingsModal } from "./SettingsModal.tsx";
import { createPrefsStore, DEFAULT_CUSTOM_KEYS } from "./prefs.ts";
import { ShareModal } from "./ShareModal.tsx";
import { SharedReadonlyView } from "./SharedReadonlyView.tsx";
import { RecordingPanel } from "./RecordingPanel.tsx";
import { CommandPalette, type PaletteAction } from "./CommandPalette.tsx";
import { InboxView, createInboxStore } from "./InboxView.tsx";
import { createWorkflowRunner, type WorkflowRunRequest } from "./workflow-runner.ts";
import { t } from "./i18n/index.ts";

function readShareTokenFromLocation(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("share");
  } catch {
    return null;
  }
}

const FALLBACK_PINNED: readonly CommandSummary[] = [
  { id: "builtin:review", name: "review", description: "完整 PR 代码审查", scope: "builtin", pinned: true },
  { id: "builtin:security-review", name: "security-review", description: "安全审查", scope: "builtin", pinned: true },
  { id: "builtin:simplify", name: "simplify", description: "重构", scope: "builtin", pinned: true },
  { id: "builtin:clear", name: "clear", description: "清空", scope: "builtin", pinned: true },
];

function dotForScope(scope: "builtin" | "user" | "project"): string {
  if (scope === "project") return "bg-orange-400";
  if (scope === "user") return "bg-sky-400";
  return "bg-violet-400";
}

// [git] map shortcut sub-command → whitelisted read-only argv. Anything not
// in this table falls through to `git <sub>` which the host rejects if not
// in its own read-only allowlist.
function gitArgsForShortcut(sub: string): string[] {
  const trimmed = sub.trim();
  if (trimmed === "status") return ["status", "--short", "--branch"];
  if (trimmed === "diff") return ["diff", "--stat"];
  if (trimmed === "log") return ["log", "--oneline", "-n", "20"];
  if (trimmed === "branch") return ["branch", "-a", "--no-color"];
  // /git:blame <file> → blame -n -L 1,80 <file>; /git:show <sha> → show <sha>
  const parts = trimmed.split(/\s+/);
  const head = parts[0]!;
  if (head === "blame" && parts[1]) return ["blame", "-L", "1,120", parts.slice(1).join(" ")];
  if (head === "show" && parts[1]) return ["show", "--stat", parts[1]!];
  return parts;
}

export function App() {
  // Share-token readonly guest path. Decided once at mount: if the URL has
  // `?share=<token>`, we never instantiate the full client (no pair token,
  // no E2E, no prefs/devices). SharedReadonlyView owns its own client.
  const shareToken = readShareTokenFromLocation();
  if (shareToken) {
    // Dynamically rendered so the full App never initializes for guests.
    return <SharedReadonlyView shareToken={shareToken} />;
  }

  const client = new RccClient({ url: defaultWsUrl(), token: loadToken() });
  const isMobile = useIsMobile();
  const prefsStore = createPrefsStore(client);
  const inboxStore = createInboxStore(client);
  const workflowRunner = createWorkflowRunner(client);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [shareOpen, setShareOpen] = createSignal(false);
  const [shareSid, setShareSid] = createSignal<string | null>(null);
  const [inboxOpen, setInboxOpen] = createSignal(false);

  const [sessions, setSessions] = createSignal<SessionMeta[]>([]);
  const [activeSid, setActiveSid] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<ConnStatus>("connecting");
  const [modalOpen, setModalOpen] = createSignal(false);
  const [lastMode, setLastMode] = createSignal<PermissionMode>("default");
  const [tunnel, setTunnel] = createSignal<TunnelInfo | null>(null);
  const [currentDevice, setCurrentDevice] = createSignal<{ id: string; name: string; hasPasskey?: boolean } | null>(null);
  const [devicesOpen, setDevicesOpen] = createSignal(false);
  const [configOpen, setConfigOpen] = createSignal(false);
  const [marketOpen, setMarketOpen] = createSignal(false);
  const [fileBrowserOpen, setFileBrowserOpen] = createSignal(false);
  const [notebookOpen, setNotebookOpen] = createSignal(false);
  const [fileBrowserRoot, setFileBrowserRoot] = createSignal<string>("~");
  const [pinnedIds, setPinnedIds] = createSignal<string[]>([]);
  const [commandsById, setCommandsById] = createSignal<Record<string, CommandSummary>>({});
  const [projects, setProjects] = createSignal<ProjectMeta[]>([]);
  const [projectsModalOpen, setProjectsModalOpen] = createSignal(false);
  const [peers, setPeers] = createSignal<PeerInfo[]>([]);
  const [peersModalOpen, setPeersModalOpen] = createSignal(false);
  const [newProjectOpen, setNewProjectOpen] = createSignal(false);
  const [newSessionProjectId, setNewSessionProjectId] = createSignal<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = createSignal<Set<string>>(new Set());
  const [starters, setStarters] = createSignal<Starter[]>([]);
  // Starter id the user picked in NewSessionModal, cached so the session.created
  // handler can match the next spawned session to its starter and run bootstrap.
  const [pendingStarterId, setPendingStarterId] = createSignal<string | null>(null);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchResults, setSearchResults] = createSignal<
    { sid: string; title: string; score: number; excerpts: string[] }[] | null
  >(null);
  // [git] branch/dirty chip state — keyed by sid so SessionRow can display
  // inline without a round-trip. null ⇒ cwd is not a git repo; undefined ⇒
  // status not yet fetched.
  const [gitBySid, setGitBySid] = createSignal<Record<string, GitStatusData | null>>({});
  // [messages] Default to chat on mobile (terminal is unusable there) and
  // terminal on desktop (power users expect raw xterm until the heuristic
  // parser is replaced with a structured stream in M5).
  const [viewMode, setViewMode] = createSignal<"chat" | "terminal">(
    isMobile() ? "chat" : "terminal",
  );

  const unsubStatus = client.onStatus(setStatus);
  const unsubFrame = client.on((frame) => {
    if (frame.t === "hello" || frame.t === "session.list") {
      setSessions(frame.sessions);
      if (!activeSid() && frame.sessions.length > 0) {
        setActiveSid(frame.sessions[0]!.id);
      }
      // Seed file browser root from the first session cwd if still default.
      if (fileBrowserRoot() === "~" && frame.sessions.length > 0) {
        setFileBrowserRoot(frame.sessions[0]!.cwd);
      }
      // [git] Ask for current git.status for every session — the watcher
      // publishes on change but late clients miss the first emit.
      for (const s of frame.sessions) {
        if (gitBySid()[s.id] === undefined) {
          client.send({ v: 1, t: "git.status.request", sid: s.id });
        }
      }
    }
    if (frame.t === "hello") {
      if (frame.tunnel) setTunnel(frame.tunnel);
      if (frame.device !== undefined) setCurrentDevice(frame.device ?? null);
      if (frame.pinnedCommands) setPinnedIds(frame.pinnedCommands);
      if (frame.projects) setProjects(frame.projects);
    }
    if (frame.t === "project.list") setProjects(frame.projects);
    if (frame.t === "peer.list") setPeers(frame.peers);
    if (frame.t === "peer.status") {
      setPeers((ps) => {
        const idx = ps.findIndex((p) => p.id === frame.peerId);
        if (idx < 0) return ps;
        const next = ps.slice();
        next[idx] = {
          ...next[idx]!,
          connected: frame.connected,
          error: frame.error ?? null,
          sessionCount: frame.sessionCount ?? next[idx]!.sessionCount,
        };
        return next;
      });
    }
    if (frame.t === "cmd.pinned") setPinnedIds(frame.ids);
    if (frame.t === "search.result") {
      if (frame.query === searchQuery()) setSearchResults(frame.matches);
    }
    if (frame.t === "summary") {
      setSessions((s) =>
        s.map((x) => (x.id === frame.sid ? { ...x, summary: frame.summary ?? undefined } : x)),
      );
    }
    if (frame.t === "usage.session") {
      setSessions((s) =>
        s.map((x) => (x.id === frame.sid ? { ...x, usage: frame.usage } : x)),
      );
    }
    if (frame.t === "cmd.list") {
      const map: Record<string, CommandSummary> = {};
      for (const c of frame.commands) map[c.id] = c;
      setCommandsById(map);
    }
    if (frame.t === "tunnel.status") setTunnel(frame.tunnel);
    if (frame.t === "starter.list") setStarters(frame.starters);
    if (frame.t === "session.created") {
      setSessions((s) => [...s, frame.session]);
      setActiveSid(frame.session.id);
      client.send({ v: 1, t: "git.status.request", sid: frame.session.id });
      const psid = pendingStarterId();
      if (psid) {
        setPendingStarterId(null);
        const starter = starters().find((x) => x.id === psid);
        if (starter) runStarterBootstrap(frame.session.id, starter);
      }
    } else if (frame.t === "session.resumed") {
      setSessions((s) =>
        s.map((x) => (x.id === frame.session.id ? { ...x, ...frame.session } : x)),
      );
      setActiveSid(frame.session.id);
    } else if (frame.t === "session.exited") {
      setSessions((s) =>
        s.map((x) => (x.id === frame.sid ? { ...x, status: "exited" } : x)),
      );
    }
    if (frame.t === "git.status") {
      setGitBySid((m) => ({ ...m, [frame.sid]: frame.status }));
    }
  });

  onMount(() => {
    client.send({ v: 1, t: "cmd.list.request" });
    client.send({ v: 1, t: "starter.list.request" });
  });

  /**
   * Run a starter's bootstrap client-side after the session is attached:
   *   1. toggle each enableSkills id to enabled=true
   *   2. inject systemPrompt as the first user message
   *   3. fire firstSteps through the existing workflow-runner
   * We wait 300ms for session.attach to settle before dispatching so the
   * systemPrompt lands in a live pty / SDK session instead of being dropped.
   */
  function runStarterBootstrap(sid: string, starter: Starter) {
    setTimeout(() => {
      if (starter.enableSkills && starter.enableSkills.length > 0) {
        for (const id of starter.enableSkills) {
          client.send({ v: 1, t: "skill.toggle", id, enabled: true });
        }
      }
      if (starter.systemPrompt && starter.systemPrompt.trim()) {
        client.write(sid, starter.systemPrompt + "\r");
      }
      if (starter.firstSteps && starter.firstSteps.length > 0) {
        workflowRunner.start({
          workflow: {
            id: `starter:${starter.id}`,
            name: starter.name,
            steps: starter.firstSteps,
            createdAt: Date.now(),
          },
          sid,
        });
      }
    }, 300);
  }

  const pinnedCommands = createMemo<readonly CommandSummary[]>(() => {
    const ids = pinnedIds();
    const map = commandsById();
    if (ids.length === 0) return FALLBACK_PINNED;
    const out: CommandSummary[] = [];
    for (const id of ids) {
      const meta = map[id];
      if (meta) {
        out.push(meta);
      } else {
        // Not yet loaded — derive name from id (scope:name)
        const [scope, ...rest] = id.split(":");
        out.push({
          id,
          name: rest.join(":"),
          description: "",
          scope: (scope === "user" || scope === "project" || scope === "builtin" ? scope : "builtin") as CommandSummary["scope"],
          pinned: true,
        });
      }
    }
    return out;
  });

  const customKeys = createMemo(() => {
    const k = prefsStore.prefs().customKeys;
    return k.length > 0 ? k : [...DEFAULT_CUSTOM_KEYS];
  });

  const paletteActions = createMemo<PaletteAction[]>(() => [
    { id: "new-session", label: "新建会话", icon: "➕", hint: "New session", run: () => onNewSession() },
    { id: "new-project", label: "新建项目", icon: "📂", hint: "New project", run: () => setNewProjectOpen(true) },
    { id: "config", label: "打开 Claude Code 配置", icon: "⚙", hint: "Skills / MCP / Commands / Subagents / Hooks", run: () => setConfigOpen(true) },
    { id: "market", label: "打开 Marketplace", icon: "🛍", hint: "Install skills & MCPs", run: () => setMarketOpen(true) },
    { id: "settings", label: "打开外观设置", icon: "🎨", hint: "主题 / 键位 / 字体", run: () => setSettingsOpen(true) },
    { id: "files", label: "切换文件浏览器", icon: "📁", hint: "Toggle file browser", run: () => setFileBrowserOpen((v) => !v) },
    { id: "notebook", label: "切换协作笔记本", icon: "📓", hint: "Toggle notebook", run: () => setNotebookOpen((v) => !v) },
    { id: "devices", label: "打开已配对设备", icon: "🔑", hint: "Devices", run: () => setDevicesOpen(true) },
    { id: "projects", label: "管理项目", icon: "🗂", hint: "Projects", run: () => setProjectsModalOpen(true) },
    { id: "peers", label: "管理 peers (远程 host 联邦)", icon: "🌐", hint: "Hosts federation", run: () => setPeersModalOpen(true) },
  ]);

  onCleanup(() => {
    unsubStatus();
    unsubFrame();
    prefsStore.dispose();
    inboxStore.dispose();
    client.dispose();
  });

  // Group sessions by projectId. Sessions without a projectId (legacy or
  // pre-projects hosts) are grouped under the default project so no session
  // is orphaned in the sidebar.
  const sessionsByProject = createMemo(() => {
    const ps = projects();
    const fallback = defaultProjectId();
    const groups = new Map<string, SessionMeta[]>();
    for (const p of ps) groups.set(p.id, []);
    if (fallback && !groups.has(fallback)) groups.set(fallback, []);
    for (const s of sessions()) {
      // [federation] Remote sessions land in their peer group, never in a
      // local project bucket.
      if (s.peerId) continue;
      const key = s.projectId && groups.has(s.projectId) ? s.projectId : fallback;
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

  const connectedPeerCount = createMemo(() => peers().filter((p) => p.connected).length);

  function defaultProjectId(): string | null {
    const ps = projects();
    if (ps.length === 0) return null;
    return (ps.find((p) => p.isDefault) ?? ps[0]!).id;
  }

  function onNewSession(projectId?: string) {
    setNewSessionProjectId(projectId ?? activeSessionProjectId() ?? defaultProjectId());
    setModalOpen(true);
  }

  function onCreateSession(opts: {
    cwd: string;
    permissionMode: PermissionMode;
    projectId: string | null;
    driver: SessionDriver;
    starterId: string | null;
  }) {
    setModalOpen(false);
    setLastMode(opts.permissionMode);
    // SDK-driver sessions have no xterm, so force the chat view for them and
    // leave the toggle disabled in the session header.
    if (opts.driver === "sdk") setViewMode("chat");
    // Stash the starter id so the session.created handler knows which starter
    // to bootstrap once the host echoes the new session back.
    setPendingStarterId(opts.starterId);
    client.newSession({
      cwd: opts.cwd || undefined,
      permissionMode: opts.permissionMode,
      projectId: opts.projectId ?? undefined,
      driver: opts.driver,
      starterId: opts.starterId ?? undefined,
    });
  }

  function onCreateProject(opts: { name: string; cwd: string; color: ProjectColor }) {
    client.send({
      v: 1,
      t: "project.add",
      name: opts.name,
      cwd: opts.cwd,
      color: opts.color,
    });
    setNewProjectOpen(false);
  }

  function toggleProjectCollapsed(id: string) {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function activeSessionProjectId(): string | null {
    const sid = activeSid();
    const s = sessions().find((x) => x.id === sid);
    return s?.projectId ?? null;
  }

  function onCloseSession(sid: string) {
    if (!confirm(`${t("session.closeConfirm")} ${sid}?`)) return;
    client.closeSession(sid);
    setSessions((s) => s.filter((x) => x.id !== sid));
    if (activeSid() === sid) {
      const next = sessions().find((x) => x.id !== sid);
      setActiveSid(next?.id ?? null);
    }
  }

  function onResumeSession(sid: string) {
    // Archived (dead) session — host will reopen pty/SDK with the same id and
    // broadcast session.resumed. We optimistically flip status locally.
    client.resumeSession(sid);
    setSessions((s) =>
      s.map((x) => (x.id === sid ? { ...x, status: "running" } : x)),
    );
    setActiveSid(sid);
  }

  function onShareSession(sid: string) {
    setShareSid(sid);
    setShareOpen(true);
  }

  function sendCommand(cmd: string) {
    const sid = activeSid();
    if (!sid) return;
    // [git] Intercept /git:<sub> — run as a read-only git.exec frame instead
    // of forwarding to the Claude pty.
    if (cmd.startsWith("/git:")) {
      const sub = cmd.slice(5).trim();
      if (sub) {
        const args = gitArgsForShortcut(sub);
        client.send({ v: 1, t: "git.exec.request", sid, args });
        return;
      }
    }
    client.write(sid, cmd + "\r");
  }

  function onPaired(token: string) {
    client.setToken(token);
  }

  function onSignOut() {
    clearToken();
    client.setToken(null);
  }

  return (
    <Show
      when={status() !== "unauthorized"}
      fallback={<PairingView onPaired={onPaired} />}
    >
      <div class="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <div class="h-11 flex items-center justify-between px-4 border-b border-zinc-900 bg-zinc-950 shrink-0">
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-1.5 mr-3">
            <span class="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span class="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          </div>
          <div class="flex items-center gap-2">
            <div class="w-6 h-6 rounded-md bg-gradient-to-br from-orange-500 to-rose-600 grid place-items-center font-bold text-[11px]">
              R
            </div>
            <span class="font-semibold text-sm">rcc</span>
          </div>
          <span class="text-zinc-700">/</span>
          <span class="text-sm text-zinc-300">{t("top.localHost")}</span>
          <Show when={activeSession()}>
            <span class="text-zinc-700">/</span>
            <span class="text-xs text-zinc-500 font-mono">{activeSession()!.title}</span>
          </Show>
        </div>
        <div class="flex items-center gap-3">
          <Show when={currentDevice()}>
            <div class="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span>{t("top.as")}</span>
              <button
                class="text-zinc-300 hover:text-orange-400 underline decoration-dotted"
                onClick={() => setDevicesOpen(true)}
                title={t("top.manageDevices")}
              >
                {currentDevice()!.name}
              </button>
              <button
                onClick={onSignOut}
                class="ml-1 px-1.5 py-0.5 rounded text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10"
                title={t("top.signOut")}
              >
                ⏏
              </button>
            </div>
          </Show>
          <TunnelBadge info={tunnel()} />
          <Show when={peers().length > 0}>
            <button
              onClick={() => setPeersModalOpen(true)}
              class="text-[11px] px-2 py-1 rounded-md border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 hover:border-violet-500/50 text-zinc-300 hover:text-violet-300 transition flex items-center gap-1"
              title={`Host federation · ${connectedPeerCount()}/${peers().length} peers 已连接`}
            >
              <span>🌐</span>
              <span class="font-mono">
                {connectedPeerCount()}/{peers().length}
              </span>
            </button>
          </Show>
          <PushPrompt client={client} />
          <button
            onClick={() => setInboxOpen(true)}
            class="relative text-xs px-2 py-1 rounded-md border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 hover:border-accent-500/50 text-zinc-300 hover:text-accent-300 transition"
            title={t("top.inbox")}
          >
            📥
            <Show when={inboxStore.unread() > 0}>
              <span class="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-accent-500 text-[9px] font-bold leading-4 text-white text-center">
                {inboxStore.unread() > 99 ? "99+" : inboxStore.unread()}
              </span>
            </Show>
          </button>
          <VersionBadge client={client} />
          <MetricsPanel client={client} sessions={sessions()} />
          <InstallPrompt />
          <button
            onClick={() => setSettingsOpen(true)}
            class="text-xs px-2 py-1 rounded-md border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 hover:border-accent-500/50 text-zinc-300 hover:text-accent-300 transition"
            title={t("top.settingsTitle")}
          >
            🎨
          </button>
          <StatusBadge status={status()} />
        </div>
      </div>

      <WorkflowRunBar
        state={workflowRunner.state()}
        onStop={() => workflowRunner.stop()}
      />

      {/* Main grid */}
      <div
        class="flex-1 grid"
        style={{
          "grid-template-columns":
            fileBrowserOpen() && notebookOpen()
              ? "240px 1fr 360px 360px"
              : fileBrowserOpen()
                ? "240px 1fr 360px"
                : notebookOpen()
                  ? "240px 1fr 360px"
                  : "240px 1fr",
          "min-height": "0",
        }}
      >
        {/* Sessions */}
        <aside class="bg-zinc-950 border-r border-zinc-900 flex flex-col overflow-hidden">
          <div class="p-3 border-b border-zinc-900 space-y-2">
            <button
              class="w-full py-2 rounded-lg bg-gradient-to-r from-accent-500 to-accent-600 text-white text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90 transition"
              onClick={() => onNewSession()}
            >
              <span>+</span> {t("sidebar.newSession")}
            </button>
            <button
              class="w-full py-1.5 rounded-lg border border-zinc-800 text-xs text-zinc-300 hover:border-zinc-700 hover:text-zinc-100 flex items-center justify-center gap-1.5"
              onClick={() => setNewProjectOpen(true)}
            >
              <span>+</span> {t("sidebar.newProject")}
            </button>
          </div>
          <div class="flex-1 overflow-y-auto scrollbar p-2">
            <div class="px-2 py-2">
              <input
                type="search"
                placeholder={t("sidebar.searchPlaceholder")}
                value={searchQuery()}
                onInput={(e) => {
                  const q = e.currentTarget.value;
                  setSearchQuery(q);
                  if (!q.trim()) {
                    setSearchResults(null);
                    return;
                  }
                  client.send({ v: 1, t: "search.request", query: q });
                }}
                class="w-full px-2 py-1.5 text-xs rounded bg-zinc-900 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-accent-500"
              />
            </div>
            <Show when={searchResults()}>
              <div class="px-2 py-2">
                <div class="text-[10px] uppercase tracking-widest text-zinc-600 pb-1">
                  {t("sidebar.searchResults")} ({searchResults()!.length})
                </div>
                <For each={searchResults()}>
                  {(m) => (
                    <button
                      class="w-full text-left p-2 rounded hover:bg-zinc-900 block"
                      onClick={() => {
                        setActiveSid(m.sid);
                        setSearchQuery("");
                        setSearchResults(null);
                      }}
                    >
                      <div class="text-sm text-zinc-200 truncate">{m.title}</div>
                      <div class="text-[10px] text-zinc-500 font-mono truncate">{m.sid}</div>
                      <For each={m.excerpts}>
                        {(e) => (
                          <div class="text-[11px] text-zinc-400 mt-1 line-clamp-2">{e}</div>
                        )}
                      </For>
                    </button>
                  )}
                </For>
                <Show when={searchResults()!.length === 0}>
                  <div class="text-xs text-zinc-600 py-2">{t("sidebar.noMatches")}</div>
                </Show>
              </div>
            </Show>
            <Show when={!searchResults()}>
            <div class="flex items-center justify-between px-2 py-2">
              <div class="text-[10px] uppercase tracking-widest text-zinc-600">{t("sidebar.projects")}</div>
              <button
                onClick={() => setProjectsModalOpen(true)}
                class="text-[10px] text-zinc-500 hover:text-zinc-200"
                title={t("sidebar.manage")}
              >
                {t("sidebar.manage")}
              </button>
            </div>
            <Show
              when={projects().length > 0}
              fallback={<div class="px-2 py-4 text-xs text-zinc-600">{t("sidebar.noProjects")}</div>}
            >
              <For each={projects()}>
                {(p) => {
                  const sess = () => sessionsByProject().get(p.id) ?? [];
                  const collapsed = () => collapsedProjects().has(p.id);
                  const dot =
                    PROJECT_DOT_CLS[(p.color ?? "orange") as ProjectColor];
                  return (
                    <div class="mb-2">
                      <div class="flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-zinc-900 group">
                        <button
                          onClick={() => toggleProjectCollapsed(p.id)}
                          class="flex items-center gap-1.5 min-w-0 flex-1 text-left"
                          title={collapsed() ? t("sidebar.expand") : t("sidebar.collapse")}
                        >
                          <span class="text-[10px] text-zinc-600 w-2 shrink-0">
                            {collapsed() ? "▶" : "▼"}
                          </span>
                          <span class={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                          <span class="text-xs font-medium text-zinc-200 truncate">{p.name}</span>
                          <span class="text-[10px] text-zinc-600 shrink-0">
                            {sess().length}
                          </span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onNewSession(p.id);
                          }}
                          class="text-[10px] text-zinc-500 hover:text-accent-300 opacity-0 group-hover:opacity-100 px-1"
                          title={`在 ${p.name} 中新建会话`}
                        >
                          +
                        </button>
                      </div>
                      <Show when={!collapsed()}>
                        <div class="pl-4 text-[10px] text-zinc-600 font-mono px-2 mb-1 truncate">
                          {p.cwd}
                        </div>
                        <Show
                          when={sess().length > 0}
                          fallback={
                            <div class="pl-4 px-2 py-1 text-[11px] text-zinc-600 italic">
                              {t("sidebar.noSessions")}
                            </div>
                          }
                        >
                          <For each={sess()}>
                            {(s) => (
                              <SessionRow
                                meta={s}
                                active={activeSid() === s.id}
                                git={gitBySid()[s.id]}
                                onActivate={() => setActiveSid(s.id)}
                                onClose={() => onCloseSession(s.id)}
                                onResume={() => onResumeSession(s.id)}
                                onShare={() => onShareSession(s.id)}
                              />
                            )}
                          </For>
                        </Show>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </Show>
            <Show when={peers().length > 0}>
              <div class="flex items-center justify-between px-2 py-2 mt-2 border-t border-zinc-900">
                <div class="text-[10px] uppercase tracking-widest text-zinc-600">
                  {t("sidebar.remotePeers")}
                </div>
                <button
                  onClick={() => setPeersModalOpen(true)}
                  class="text-[10px] text-zinc-500 hover:text-zinc-200"
                  title={t("sidebar.manageRemote")}
                >
                  {t("sidebar.manage")}
                </button>
              </div>
              <For each={peers()}>
                {(pr) => {
                  const sess = () => sessionsByPeer().get(pr.id) ?? [];
                  return (
                    <div class="mb-2">
                      <div class="flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-zinc-900">
                        <span class={`w-1.5 h-1.5 rounded-full shrink-0 ${peerDotCls(pr.color)}`} />
                        <span class="text-xs font-medium text-zinc-200 truncate flex-1">
                          {pr.label}
                        </span>
                        <span
                          class={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            pr.connected ? "bg-emerald-400" : "bg-zinc-700"
                          }`}
                          title={pr.connected ? t("sidebar.connected") : pr.error ?? t("sidebar.offline")}
                        />
                        <span class="text-[10px] text-zinc-600 shrink-0">
                          {sess().length}
                        </span>
                      </div>
                      <Show when={!pr.connected && pr.error}>
                        <div class="pl-4 text-[10px] text-rose-400 px-2 mb-1 truncate">
                          {pr.error}
                        </div>
                      </Show>
                      <Show
                        when={sess().length > 0}
                        fallback={
                          <Show when={pr.connected}>
                            <div class="pl-4 px-2 py-1 text-[11px] text-zinc-600 italic">
                              {t("sidebar.noSessions")}
                            </div>
                          </Show>
                        }
                      >
                        <For each={sess()}>
                          {(s) => (
                            <SessionRow
                              meta={s}
                              active={activeSid() === s.id}
                              git={gitBySid()[s.id]}
                              onActivate={() => setActiveSid(s.id)}
                              onClose={() => onCloseSession(s.id)}
                              onResume={() => onResumeSession(s.id)}
                              onShare={() => onShareSession(s.id)}
                            />
                          )}
                        </For>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </Show>
            </Show>
          </div>

          <div class="p-3 border-t border-zinc-900 space-y-1">
            <button
              class="w-full text-xs text-zinc-500 hover:text-zinc-200 flex items-center gap-1.5 py-1.5 px-2 rounded hover:bg-zinc-900"
              onClick={() => setConfigOpen(true)}
              title={t("sidebar.configTitle")}
            >
              <span>⚙</span>
              <span>{t("sidebar.config")}</span>
            </button>
            <button
              class="w-full text-xs text-zinc-500 hover:text-zinc-200 flex items-center gap-1.5 py-1.5 px-2 rounded hover:bg-zinc-900"
              onClick={() => setMarketOpen(true)}
              title={t("sidebar.marketplaceTitle")}
            >
              <span>📥</span>
              <span>{t("sidebar.marketplace")}</span>
            </button>
            <button
              class={`w-full text-xs flex items-center gap-1.5 py-1.5 px-2 rounded hover:bg-zinc-900 ${
                fileBrowserOpen() ? "text-accent-300" : "text-zinc-500 hover:text-zinc-200"
              }`}
              onClick={() => setFileBrowserOpen((v) => !v)}
              title={t("sidebar.fileBrowserTitle")}
            >
              <span>📁</span>
              <span>{t("sidebar.fileBrowser")}</span>
            </button>
            <button
              class="w-full text-xs text-zinc-500 hover:text-zinc-200 flex items-center gap-1.5 py-1.5 px-2 rounded hover:bg-zinc-900"
              onClick={() => setDevicesOpen(true)}
              title={t("top.manageDevices")}
            >
              <span>🔑</span>
              <span>{t("sidebar.devices")}</span>
            </button>
          </div>
        </aside>

        {/* Main */}
        <main class="bg-zinc-950 flex flex-col overflow-hidden">
          <Show
            when={activeSid()}
            fallback={
              <div class="flex-1 grid place-items-center text-zinc-500 text-sm">
                {t("main.emptyHint")}
              </div>
            }
          >
            <>
              {/* session header */}
              <div class="h-12 border-b border-zinc-900 px-5 flex items-center justify-between shrink-0">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="text-sm font-medium truncate">
                    {activeSession()?.title ?? activeSid()}
                  </div>
                  <span class="text-zinc-700">·</span>
                  <div class="font-mono text-xs text-zinc-500">{activeSid()}</div>
                  <Show when={activeSession()}>
                    <PermissionChip mode={activeSession()!.permissionMode} />
                    <DriverChip driver={activeSession()!.driver ?? "cli"} />
                    <Show when={activeSession()!.usage}>
                      <UsageChip usage={activeSession()!.usage!} />
                    </Show>
                    <Show when={gitBySid()[activeSid()!]}>
                      <BranchChip status={gitBySid()[activeSid()!]!} />
                    </Show>
                  </Show>
                  <button
                    onClick={() => {
                      // SDK sessions have no pty → terminal view is pointless;
                      // lock it to chat.
                      if (activeSession()?.driver === "sdk") return;
                      setViewMode((v) => (v === "chat" ? "terminal" : "chat"));
                    }}
                    disabled={activeSession()?.driver === "sdk"}
                    class={`text-[10px] px-1.5 py-0.5 rounded border ${
                      activeSession()?.driver === "sdk"
                        ? "border-zinc-800 text-zinc-600 cursor-not-allowed"
                        : "border-zinc-700 text-zinc-400 hover:text-zinc-100"
                    }`}
                    title={
                      activeSession()?.driver === "sdk"
                        ? t("main.toggleViewDisabled")
                        : t("main.toggleViewTitle")
                    }
                  >
                    {activeSession()?.driver === "sdk"
                      ? t("main.toggleViewSdk")
                      : viewMode() === "chat"
                        ? t("main.toggleViewChat")
                        : t("main.toggleViewTerminal")}
                  </button>
                </div>
                <div class="flex items-center gap-2 text-[11px] text-zinc-500 shrink-0">
                  <button
                    onClick={() => setNotebookOpen((v) => !v)}
                    class={`text-[10px] px-1.5 py-0.5 rounded border transition ${
                      notebookOpen()
                        ? "border-accent-500 text-accent-300 bg-accent-500/10"
                        : "border-zinc-700 text-zinc-400 hover:text-zinc-100"
                    }`}
                    title={t("main.notebookTitle")}
                  >
                    {t("main.notebook")}
                  </button>
                  <RecordingPanel client={client} sid={activeSid()} />
                  <span class="text-zinc-700">{activeSession()?.cols}×{activeSession()?.rows}</span>
                </div>
              </div>

              {/* terminal / chat view */}
              <div class="flex-1 min-h-0 relative">
                <Show
                  when={viewMode() === "terminal" && activeSession()?.driver !== "sdk"}
                  fallback={
                    <ChatView
                      client={client}
                      sid={activeSid()!}
                      sessions={sessions()}
                      onPinToNotebook={(messageId) => {
                        setNotebookOpen(true);
                        const cid =
                          typeof crypto !== "undefined" && "randomUUID" in crypto
                            ? crypto.randomUUID()
                            : `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                        client.send({
                          v: 1,
                          t: "notebook.append",
                          sid: activeSid()!,
                          cell: { kind: "chatRef", id: cid, messageId },
                        });
                      }}
                    />
                  }
                >
                  <TerminalView client={client} sid={activeSid()!} />
                </Show>
              </div>

              {/* command bar */}
              <Show when={!isMobile()}>
                <div class="border-t border-zinc-900 p-3 shrink-0">
                  <div class="flex items-center gap-1.5 overflow-x-auto scrollbar">
                    <For each={pinnedCommands()}>
                      {(c) => (
                        <button
                          class={`shrink-0 text-[11px] px-2.5 py-1.5 rounded-md border flex items-center gap-1.5 font-mono ${
                            c.scope === "project"
                              ? "bg-accent-500/10 border-accent-500/30 text-accent-300 hover:bg-accent-500/20"
                              : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700"
                          }`}
                          onClick={() => sendCommand(`/${c.name}`)}
                          title={c.description || `发送 /${c.name}`}
                        >
                          <span class={`w-1 h-1 rounded-full ${dotForScope(c.scope)}`} />
                          /{c.name}
                        </button>
                      )}
                    </For>
                    <span class="shrink-0 w-px h-5 bg-zinc-800 mx-0.5" />
                    <For each={customKeys()}>
                      {(k) => (
                        <KeyButton
                          label={k.label}
                          onClick={() => client.write(activeSid()!, k.send)}
                          hint={k.hint}
                        />
                      )}
                    </For>
                  </div>
                  <div class="mt-2 flex items-center justify-between text-[11px] text-zinc-600">
                    <div>{t("main.commandHint")}</div>
                    <div>M1 · 本地模式</div>
                  </div>
                </div>
              </Show>
              <Show when={isMobile() && activeSid()}>
                {/* reserve space so MobileKeyBar (2 rows ~ 92px + safe-area) doesn't cover terminal */}
                <div class="shrink-0" style={{ height: "calc(96px + env(safe-area-inset-bottom))" }} />
              </Show>
            </>
          </Show>
        </main>

        <Show when={fileBrowserOpen()}>
          <aside class="bg-zinc-950 border-l border-zinc-900 overflow-hidden">
            <FileBrowser client={client} rootCwd={fileBrowserRoot()} />
          </aside>
        </Show>
        <Show when={notebookOpen() && activeSid()}>
          <aside class="bg-zinc-950 border-l border-zinc-900 overflow-hidden">
            <NotebookView client={client} sid={activeSid()!} />
          </aside>
        </Show>
      </div>

      <NewSessionModal
        open={modalOpen()}
        defaultCwd=""
        defaultMode={lastMode()}
        projects={projects()}
        defaultProjectId={newSessionProjectId() ?? defaultProjectId()}
        starters={starters()}
        onCancel={() => setModalOpen(false)}
        onConfirm={onCreateSession}
      />
      <NewProjectModal
        open={newProjectOpen()}
        onCancel={() => setNewProjectOpen(false)}
        onConfirm={onCreateProject}
      />
      <ProjectsModal
        open={projectsModalOpen()}
        client={client}
        projects={projects()}
        onClose={() => setProjectsModalOpen(false)}
      />
      <PeersModal
        open={peersModalOpen()}
        client={client}
        peers={peers()}
        onClose={() => setPeersModalOpen(false)}
      />
      <DevicesModal
        open={devicesOpen()}
        client={client}
        onClose={() => setDevicesOpen(false)}
        currentDevice={currentDevice()}
        onPasskeyChange={(hasPasskey) => {
          const d = currentDevice();
          if (d) setCurrentDevice({ ...d, hasPasskey });
        }}
      />
      <ConfigView
        open={configOpen()}
        client={client}
        activeSid={activeSid()}
        onClose={() => setConfigOpen(false)}
        onRunWorkflow={(req: WorkflowRunRequest) => {
          workflowRunner.start(req);
          setConfigOpen(false);
        }}
      />
      <MarketplaceView
        open={marketOpen()}
        client={client}
        onClose={() => setMarketOpen(false)}
      />
      <SettingsModal
        open={settingsOpen()}
        store={prefsStore}
        onClose={() => setSettingsOpen(false)}
      />
      <ShareModal
        open={shareOpen()}
        sid={shareSid()}
        client={client}
        onClose={() => setShareOpen(false)}
      />
      <PermissionApproval client={client} device={currentDevice()} />
      <InboxView
        store={inboxStore}
        open={inboxOpen()}
        onClose={() => setInboxOpen(false)}
        handlers={{
          jumpToSid: (sid) => setActiveSid(sid),
          jumpToSidWithApproval: (sid) => setActiveSid(sid),
        }}
      />
      <CommandPalette
        client={client}
        sessions={sessions()}
        activeSid={activeSid()}
        actions={paletteActions()}
        onActivateSession={(sid) => setActiveSid(sid)}
      />
      <Show when={isMobile() && activeSid()}>
        <MobileKeyBar
          client={client}
          sid={activeSid()}
          pinnedCommands={pinnedCommands}
          customKeys={customKeys}
        />
      </Show>
    </div>
    </Show>
  );

  function activeSession() {
    const sid = activeSid();
    return sessions().find((x) => x.id === sid);
  }
}

function PermissionChip(props: { mode: PermissionMode }) {
  const { info, cls } = permissionChip(props.mode);
  return (
    <span
      class={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${cls}`}
      title={info.description}
    >
      {info.label}
    </span>
  );
}

function DriverChip(props: { driver: SessionDriver }) {
  const isSdk = () => props.driver === "sdk";
  return (
    <span
      class={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
        isSdk()
          ? "border-violet-500/30 bg-violet-500/5 text-violet-300"
          : "border-sky-500/30 bg-sky-500/5 text-sky-300"
      }`}
      title={
        isSdk()
          ? "Claude Agent SDK 结构化事件流"
          : "传统 claude CLI (pty + 启发式解析)"
      }
    >
      {isSdk() ? "🧠 SDK" : "⌨ CLI"}
    </span>
  );
}

// [usage] Compact ↑N ↓N · $C chip. Tooltip shows the full breakdown including
// cache-create / cache-read tokens + turn count. Only rendered when the host
// has supplied usage data (SDK-driver sessions only).
function UsageChip(props: { usage: SessionUsage }) {
  const u = () => props.usage;
  const tip = () =>
    [
      `input: ${u().inputTokens.toLocaleString()}`,
      `output: ${u().outputTokens.toLocaleString()}`,
      `cache create: ${u().cacheCreateTokens.toLocaleString()}`,
      `cache read: ${u().cacheReadTokens.toLocaleString()}`,
      `cost: $${u().costUsd.toFixed(4)}`,
      `turns: ${u().turns}`,
    ].join("\n");
  return (
    <span
      class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/5 text-amber-300 font-mono"
      title={tip()}
    >
      <span>↑{formatTokensShort(u().inputTokens)}</span>
      <span class="text-zinc-600">·</span>
      <span>↓{formatTokensShort(u().outputTokens)}</span>
      <span class="text-zinc-600">·</span>
      <span>${u().costUsd.toFixed(u().costUsd >= 1 ? 2 : 4)}</span>
    </span>
  );
}

function formatTokensShort(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function TunnelBadge(props: { info: TunnelInfo | null }) {
  const copyUrl = () => {
    if (props.info?.url) {
      navigator.clipboard?.writeText(props.info.url);
    }
  };
  return (
    <Show when={props.info} fallback={
      <span class="text-[10px] text-zinc-600" title="设置 RCC_TUNNEL=1 启用公网隧道">
        tunnel: off
      </span>
    }>
      {(info) => (
        <div class="flex items-center gap-1.5 text-xs">
          <Show when={info().state === "ready" && info().url}>
            <span class="w-1.5 h-1.5 rounded-full bg-violet-400 pulse-soft" />
            <Show when={info().mode === "named"}>
              <span
                class="text-violet-300 text-[10px] font-medium"
                title={`命名隧道 (${info().name ?? "?"})`}
              >
                🔒
              </span>
            </Show>
            <button
              onClick={copyUrl}
              class="text-violet-300 hover:text-violet-200 font-mono text-[11px] underline decoration-dotted"
              title={
                info().mode === "named"
                  ? `命名隧道 · ${info().hostname ?? info().url} · 点击复制`
                  : "TryCloudflare · 点击复制公网地址"
              }
            >
              {info().url!.replace("https://", "")}
            </button>
          </Show>
          <Show when={info().state === "starting"}>
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400 pulse-soft" />
            <span class="text-amber-400 text-[11px]">tunnel starting…</span>
          </Show>
          <Show when={info().state === "error"}>
            <span class="w-1.5 h-1.5 rounded-full bg-rose-400" />
            <span class="text-rose-400 text-[11px]" title={info().error ?? ""}>tunnel error</span>
          </Show>
          <Show when={info().state === "disabled"}>
            <span class="text-[11px] text-zinc-600">tunnel: off</span>
          </Show>
        </div>
      )}
    </Show>
  );
}

function StatusBadge(props: { status: ConnStatus }) {
  return (
    <div class="flex items-center gap-1.5 text-xs">
      <Show when={props.status === "connected"}>
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-soft" />
        <span class="text-emerald-400">{t("status.connected")}</span>
      </Show>
      <Show when={props.status === "slow"}>
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400 pulse-soft" />
        <span class="text-amber-400" title="host is applying backpressure — dropping non-critical frames">slow</span>
      </Show>
      <Show when={props.status === "connecting"}>
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400 pulse-soft" />
        <span class="text-amber-400">{t("status.connecting")}</span>
      </Show>
      <Show when={props.status === "closed"}>
        <span class="w-1.5 h-1.5 rounded-full bg-rose-400" />
        <span class="text-rose-400">{t("status.disconnected")}</span>
      </Show>
    </div>
  );
}

function SessionRow(props: {
  meta: SessionMeta;
  active: boolean;
  git?: GitStatusData | null;
  onActivate: () => void;
  onClose: () => void;
  onResume: () => void;
  onShare: () => void;
}) {
  const isArchived = () => props.meta.status === "exited";
  return (
    <div
      class={`group p-2.5 rounded-lg mb-1.5 cursor-pointer ${
        props.active
          ? "bg-zinc-900 border border-zinc-800"
          : "hover:bg-zinc-900"
      }`}
      onClick={props.onActivate}
    >
      <div class="flex items-start gap-2">
        <span
          class={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
            props.meta.status === "running" ? "bg-emerald-400 pulse-soft" : "bg-zinc-600"
          }`}
        />
        <div class="min-w-0 flex-1">
          <div
            class={`text-sm truncate ${props.active ? "text-zinc-100" : "text-zinc-300"}`}
            title={
              props.meta.summary
                ? props.meta.summary.bullets.map((b) => `• ${b}`).join("\n")
                : undefined
            }
          >
            {props.meta.summary?.title ?? props.meta.title ?? props.meta.id}
          </div>
          <div class="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span class="text-xs text-zinc-500 font-mono truncate">{props.meta.id}</span>
            <PermissionChip mode={props.meta.permissionMode} />
            <DriverChip driver={props.meta.driver ?? "cli"} />
            <Show when={props.meta.usage}>
              <UsageChip usage={props.meta.usage!} />
            </Show>
            <Show when={props.git}>
              <BranchChip status={props.git!} />
            </Show>
            <Show when={isArchived()}>
              <span
                class="text-[9px] px-1 py-px rounded bg-zinc-800 text-zinc-400 border border-zinc-700"
                title={t("session.archivedTitle")}
              >
                {t("session.archived")}
              </span>
            </Show>
          </div>
        </div>
        <Show when={isArchived()}>
          <button
            class="opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0.5 rounded border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30"
            onClick={(e) => {
              e.stopPropagation();
              props.onResume();
            }}
            title={t("session.resumeTitle")}
          >
            {t("session.resume")}
          </button>
        </Show>
        <button
          class="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-violet-400 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            props.onShare();
          }}
          title={t("session.share")}
        >
          🔗
        </button>
        <button
          class="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-rose-400 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            props.onClose();
          }}
          title={t("session.close")}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function KeyButton(props: { label: string; onClick: () => void; hint?: string }) {
  return (
    <button
      class="shrink-0 text-[11px] px-2 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 font-mono"
      onClick={props.onClick}
      title={props.hint ?? props.label}
    >
      {props.label}
    </button>
  );
}

function BranchChip(props: { status: GitStatusData }) {
  const label = () => props.status.branch ?? props.status.head?.slice(0, 7) ?? "detached";
  const tooltip = () => {
    const s = props.status;
    const bits: string[] = [];
    bits.push(s.branch ? `branch ${s.branch}` : `HEAD ${s.head?.slice(0, 7) ?? "detached"}`);
    if (s.dirty) bits.push("dirty working tree");
    if (s.ahead) bits.push(`↑${s.ahead}`);
    if (s.behind) bits.push(`↓${s.behind}`);
    return bits.join(" · ");
  };
  return (
    <span
      class={`inline-flex items-center gap-1 text-[9px] px-1 py-px rounded border font-mono ${
        props.status.dirty
          ? "bg-amber-950/40 border-amber-800/60 text-amber-300"
          : "bg-zinc-900 border-zinc-700 text-zinc-400"
      }`}
      title={tooltip()}
    >
      <span class="opacity-80">⌥</span>
      <span class="truncate max-w-[96px]">{label()}</span>
      <Show when={props.status.dirty}>
        <span class="w-1 h-1 rounded-full bg-amber-400" />
      </Show>
      <Show when={(props.status.ahead ?? 0) > 0}>
        <span class="text-emerald-400">↑{props.status.ahead}</span>
      </Show>
      <Show when={(props.status.behind ?? 0) > 0}>
        <span class="text-rose-400">↓{props.status.behind}</span>
      </Show>
    </span>
  );
}

function WorkflowRunBar(props: {
  state: import("./workflow-runner.ts").RunState | null;
  onStop: () => void;
}) {
  return (
    <Show when={props.state}>
      {(s) => (
        <div class="h-7 shrink-0 flex items-center gap-3 px-4 border-b border-teal-500/30 bg-gradient-to-r from-teal-500/10 via-teal-500/5 to-transparent text-[11px]">
          <span class="text-teal-300">⏵</span>
          <span class="text-zinc-300">
            {t("workflow.running")} <span class="font-mono text-teal-200">{s().workflow.name}</span>
          </span>
          <span class="text-zinc-500 font-mono">
            {s().index + 1}/{s().total}
          </span>
          <div class="flex-1 h-1 rounded bg-zinc-800 overflow-hidden max-w-48">
            <div
              class="h-full bg-teal-400 transition-[width]"
              style={{ width: `${Math.round(((s().index + 1) / s().total) * 100)}%` }}
            />
          </div>
          <button
            onClick={props.onStop}
            class="px-2 py-0.5 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-[10px]"
          >
            {t("workflow.abort")}
          </button>
        </div>
      )}
    </Show>
  );
}
