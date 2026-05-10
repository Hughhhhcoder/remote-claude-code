import { createSignal, createMemo, onCleanup, Show } from "solid-js";
import type {
  PermissionMode,
  ProjectColor,
  SessionDriver,
  Starter,
} from "@rcc/protocol";
import { RccClient, defaultWsUrl, type ConnStatus } from "./client.ts";
import { NewSessionModal } from "./NewSessionModal.tsx";
import { NewProjectModal } from "./NewProjectModal.tsx";
import { ProjectsModal } from "./ProjectsModal.tsx";
import { PeersModal } from "./PeersModal.tsx";
import { PairingView } from "./PairingView.tsx";
import { DevicesModal } from "./DevicesModal.tsx";
import { ConfigView } from "./ConfigView.tsx";
import { MarketplaceView } from "./MarketplaceView.tsx";
import { PermissionApproval } from "./PermissionApproval.tsx";
import { PushPrompt } from "./PushPrompt.tsx";
import { clearToken, loadToken } from "./auth.ts";
import { SettingsModal } from "./SettingsModal.tsx";
import { createPrefsStore, DEFAULT_CUSTOM_KEYS } from "./prefs.ts";
import { ShareModal } from "./ShareModal.tsx";
import { SharedReadonlyView } from "./SharedReadonlyView.tsx";
import { CommandPalette, type PaletteAction } from "./CommandPalette.tsx";
import { InboxView, createInboxStore } from "./InboxView.tsx";
import { createWorkflowRunner, type WorkflowRunRequest } from "./workflow-runner.ts";
import { t } from "./i18n/index.ts";
import { AppShell } from "./shell/AppShell.tsx";
import { Sidebar } from "./shell/Sidebar.tsx";
import { TopBar } from "./shell/TopBar.tsx";
import { TabNav } from "./shell/TabNav.tsx";
import { ConnectionBanner } from "./shell/ConnectionBanner.tsx";
import { useIsCompact } from "./hooks/useMediaQuery.ts";
import { EmptyState } from "./primitives/EmptyState.tsx";
import { ErrorBoundary } from "./primitives/ErrorBoundary.tsx";
import { ToastContainer } from "./primitives/Toast.tsx";
import { createSessionsStore } from "./stores/sessionsStore.ts";
import { createProjectsStore } from "./stores/projectsStore.ts";
import { createPeersStore } from "./stores/peersStore.ts";
import { createUiStore } from "./stores/uiStore.ts";
import { createCommandsStore } from "./stores/commandsStore.ts";
import { createSearchStore } from "./stores/searchStore.ts";
import { createTunnelStore } from "./stores/tunnelStore.ts";
import { MainPane, WorkflowRunBar } from "./MainPane.tsx";

function readShareTokenFromLocation(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("share");
  } catch {
    return null;
  }
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
    return <SharedReadonlyView shareToken={shareToken} />;
  }

  const client = new RccClient({ url: defaultWsUrl(), token: loadToken() });
  const isCompact = useIsCompact();

  // Stores (order matters: projects before sessions for defaultProjectId dep).
  const prefsStore = createPrefsStore(client);
  const inboxStore = createInboxStore(client);
  const workflowRunner = createWorkflowRunner(client);
  const projectsStore = createProjectsStore(client);
  const sessionsStore = createSessionsStore(client, {
    defaultProjectId: () => projectsStore.defaultProjectId(),
  });
  const peersStore = createPeersStore(client);
  const uiStore = createUiStore(client, {
    initialViewMode: isCompact() ? "chat" : "terminal",
  });
  const commandsStore = createCommandsStore(client);
  const searchStore = createSearchStore(client);
  const tunnelStore = createTunnelStore(client);

  // Cross-store / chrome-only signals kept here (no dedicated store).
  const [status, setStatus] = createSignal<ConnStatus>("connecting");
  const [lastMode, setLastMode] = createSignal<PermissionMode>("default");
  const [newSessionProjectId, setNewSessionProjectId] = createSignal<string | null>(null);
  const [currentDevice, setCurrentDevice] = createSignal<
    { id: string; name: string; hasPasskey?: boolean } | null
  >(null);

  const unsubStatus = client.onStatus(setStatus);
  // App-local frame subscription: only the parts no store claims (device +
  // file-browser root seeding from first session + starter bootstrap timing).
  const unsubFrame = client.on((frame) => {
    if (frame.t === "hello" || frame.t === "session.list") {
      if (uiStore.fileBrowserRoot() === "~" && frame.sessions.length > 0) {
        uiStore.setFileBrowserRoot(frame.sessions[0]!.cwd);
      }
    }
    if (frame.t === "hello") {
      if (frame.device !== undefined) setCurrentDevice(frame.device ?? null);
    }
    if (frame.t === "session.created") {
      // Starter bootstrap lives here because it spans sessions +
      // commands (starters) + workflow-runner stores.
      const psid = sessionsStore.pendingStarterId();
      if (psid) {
        sessionsStore.setPendingStarter(null);
        const starter = commandsStore.starters().find((x) => x.id === psid);
        if (starter) runStarterBootstrap(frame.session.id, starter);
      }
    }
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

  const customKeys = createMemo(() => {
    const k = prefsStore.prefs().customKeys;
    return k.length > 0 ? k : [...DEFAULT_CUSTOM_KEYS];
  });

  const paletteActions = createMemo<PaletteAction[]>(() => [
    { id: "new-session", label: "新建会话", icon: "➕", hint: "New session", run: () => onNewSession() },
    { id: "new-project", label: "新建项目", icon: "📂", hint: "New project", run: () => uiStore.setNewProjectOpen(true) },
    { id: "config", label: "打开 Claude Code 配置", icon: "⚙", hint: "Skills / MCP / Commands / Subagents / Hooks", run: () => uiStore.setConfigOpen(true) },
    { id: "market", label: "打开 Marketplace", icon: "🛍", hint: "Install skills & MCPs", run: () => uiStore.setMarketOpen(true) },
    { id: "settings", label: "打开外观设置", icon: "🎨", hint: "主题 / 键位 / 字体", run: () => uiStore.setSettingsOpen(true) },
    { id: "files", label: "切换文件浏览器", icon: "📁", hint: "Toggle file browser", run: () => uiStore.setFileBrowserOpen((v) => !v) },
    { id: "notebook", label: "切换协作笔记本", icon: "📓", hint: "Toggle notebook", run: () => uiStore.setNotebookOpen((v) => !v) },
    { id: "devices", label: "打开已配对设备", icon: "🔑", hint: "Devices", run: () => uiStore.setDevicesOpen(true) },
    { id: "projects", label: "管理项目", icon: "🗂", hint: "Projects", run: () => uiStore.setProjectsModalOpen(true) },
    { id: "peers", label: "管理 peers (远程 host 联邦)", icon: "🌐", hint: "Hosts federation", run: () => uiStore.setPeersModalOpen(true) },
  ]);

  onCleanup(() => {
    unsubStatus();
    unsubFrame();
    prefsStore.dispose();
    inboxStore.dispose();
    projectsStore.dispose();
    sessionsStore.dispose();
    peersStore.dispose();
    uiStore.dispose();
    commandsStore.dispose();
    searchStore.dispose();
    tunnelStore.dispose();
    client.dispose();
  });

  function onNewSession(projectId?: string) {
    setNewSessionProjectId(
      projectId ?? sessionsStore.activeSessionProjectId() ?? projectsStore.defaultProjectId(),
    );
    uiStore.setModalOpen(true);
  }

  function onCreateSession(opts: {
    cwd: string;
    permissionMode: PermissionMode;
    projectId: string | null;
    driver: SessionDriver;
    starterId: string | null;
  }) {
    uiStore.setModalOpen(false);
    setLastMode(opts.permissionMode);
    // SDK-driver sessions have no xterm, so force the chat view for them.
    if (opts.driver === "sdk") uiStore.setViewMode("chat");
    sessionsStore.setPendingStarter(opts.starterId);
    sessionsStore.newSession({
      cwd: opts.cwd || undefined,
      permissionMode: opts.permissionMode,
      projectId: opts.projectId,
      driver: opts.driver,
      starterId: opts.starterId,
    });
  }

  function onCreateProject(opts: { name: string; cwd: string; color: ProjectColor }) {
    projectsStore.addProject(opts);
    uiStore.setNewProjectOpen(false);
  }

  function onCloseSession(sid: string) {
    if (!confirm(`${t("session.closeConfirm")} ${sid}?`)) return;
    sessionsStore.closeSession(sid);
  }

  function sendCommand(cmd: string) {
    const sid = sessionsStore.activeSid();
    if (!sid) return;
    // [git] Intercept /git:<sub> — run as a read-only git.exec frame instead
    // of forwarding to the Claude pty.
    if (cmd.startsWith("/git:")) {
      const sub = cmd.slice(5).trim();
      if (sub) {
        client.send({ v: 1, t: "git.exec.request", sid, args: gitArgsForShortcut(sub) });
        return;
      }
    }
    client.write(sid, cmd + "\r");
  }

  const activeSession = () => sessionsStore.activeSession();
  const activeSid = () => sessionsStore.activeSid();

  const sidebarNode = () => (
    <Sidebar
      projects={projectsStore.projects()}
      sessions={sessionsStore.sessions()}
      peers={peersStore.peers()}
      activeSid={activeSid()}
      gitBySid={sessionsStore.gitBySid()}
      search={{
        query: searchStore.query(),
        onChange: searchStore.setQuery,
        results: searchStore.results(),
      }}
      collapsedProjects={sessionsStore.collapsedProjects()}
      onToggleProject={sessionsStore.toggleProjectCollapsed}
      onActivateSession={(sid) => {
        sessionsStore.setActiveSid(sid);
        uiStore.setDrawerOpen(false);
      }}
      onCloseSession={onCloseSession}
      onResumeSession={sessionsStore.resumeSession}
      onShareSession={uiStore.openShare}
      onNewSession={(projectId) => {
        uiStore.setDrawerOpen(false);
        onNewSession(projectId);
      }}
      onNewProject={() => uiStore.setNewProjectOpen(true)}
      onOpenConfig={() => uiStore.setConfigOpen(true)}
      onOpenMarket={() => uiStore.setMarketOpen(true)}
      onOpenDevices={() => uiStore.setDevicesOpen(true)}
      onManageProjects={() => uiStore.setProjectsModalOpen(true)}
      onManagePeers={() => uiStore.setPeersModalOpen(true)}
    />
  );

  const topBarNode = () => (
    <TopBar
      isCompact={isCompact()}
      onOpenDrawer={() => uiStore.setDrawerOpen(true)}
      onOpenInbox={() => uiStore.setInboxOpen(true)}
      onOpenSettings={() => uiStore.setSettingsOpen(true)}
      title={activeSession()?.title}
      subtitle={activeSession()?.cwd}
      status={status()}
      unreadInbox={inboxStore.unread()}
      tunnelUrl={tunnelStore.tunnel()?.url ?? null}
      deviceName={currentDevice()?.name ?? null}
      onSignOut={() => {
        clearToken();
        client.setToken(null);
      }}
    />
  );

  const tabNavNode = () => (
    <TabNav
      active={uiStore.mobileTab()}
      onChange={uiStore.setMobileTab}
      pendingApprovals={
        inboxStore.items().filter(
          (it) => it.kind === "approval" && it.status === "pending",
        ).length
      }
    />
  );

  return (
    <Show
      when={status() !== "unauthorized"}
      fallback={<PairingView onPaired={(token) => client.setToken(token)} />}
    >
      <ErrorBoundary scope="app">
      <AppShell
        sidebar={sidebarNode()}
        topBar={topBarNode()}
        tabNav={tabNavNode()}
        connectionBanner={
          <ConnectionBanner
            status={status}
            reconnect={() => client.reconnectState()}
            onReconnectNow={() => client.reconnectNow()}
          />
        }
        drawer={{ open: uiStore.drawerOpen(), onClose: () => uiStore.setDrawerOpen(false) }}
      >
        <ErrorBoundary scope="chat">
        <Show
          when={activeSid()}
          fallback={
            <EmptyState
              icon="💬"
              title={t("main.emptyHint")}
              action={
                <button
                  class="px-4 py-2 rounded-md bg-accent text-bg-page text-sm font-medium hover:bg-accent-hover"
                  onClick={() => onNewSession()}
                >
                  {t("sidebar.newSession")}
                </button>
              }
            />
          }
        >
          <MainPane
            client={client}
            isCompact={isCompact()}
            sendCommand={sendCommand}
            customKeys={customKeys}
            pinnedCommands={commandsStore.pinnedCommands}
            allCommands={() => Object.values(commandsStore.commandsById())}
            sessions={sessionsStore.sessions}
            viewMode={uiStore.viewMode}
            setViewMode={uiStore.setViewMode}
            fileBrowserOpen={uiStore.fileBrowserOpen}
            setFileBrowserOpen={uiStore.setFileBrowserOpen}
            notebookOpen={uiStore.notebookOpen}
            setNotebookOpen={uiStore.setNotebookOpen}
            fileBrowserRoot={uiStore.fileBrowserRoot}
            workflowRunner={workflowRunner}
            activeSid={activeSid}
            activeSession={activeSession}
            gitBySid={sessionsStore.gitBySid}
            onShareSession={uiStore.openShare}
          />
        </Show>
        </ErrorBoundary>
      </AppShell>
      </ErrorBoundary>

      {/* Modals — still inline. Phase 5 relocates most of these into panes. */}
      <NewSessionModal
        open={uiStore.modalOpen()}
        defaultCwd=""
        defaultMode={lastMode()}
        projects={projectsStore.projects()}
        defaultProjectId={newSessionProjectId() ?? projectsStore.defaultProjectId()}
        starters={commandsStore.starters()}
        onCancel={() => uiStore.setModalOpen(false)}
        onConfirm={onCreateSession}
      />
      <NewProjectModal
        open={uiStore.newProjectOpen()}
        onCancel={() => uiStore.setNewProjectOpen(false)}
        onConfirm={onCreateProject}
      />
      <ProjectsModal
        open={uiStore.projectsModalOpen()}
        client={client}
        projects={projectsStore.projects()}
        onClose={() => uiStore.setProjectsModalOpen(false)}
      />
      <PeersModal
        open={uiStore.peersModalOpen()}
        client={client}
        peers={peersStore.peers()}
        onClose={() => uiStore.setPeersModalOpen(false)}
      />
      <DevicesModal
        open={uiStore.devicesOpen()}
        client={client}
        onClose={() => uiStore.setDevicesOpen(false)}
        currentDevice={currentDevice()}
        onPasskeyChange={(hasPasskey) => {
          const d = currentDevice();
          if (d) setCurrentDevice({ ...d, hasPasskey });
        }}
      />
      <ConfigView
        open={uiStore.configOpen()}
        client={client}
        activeSid={activeSid()}
        onClose={() => uiStore.setConfigOpen(false)}
        onRunWorkflow={(req: WorkflowRunRequest) => {
          workflowRunner.start(req);
          uiStore.setConfigOpen(false);
        }}
      />
      <MarketplaceView
        open={uiStore.marketOpen()}
        client={client}
        onClose={() => uiStore.setMarketOpen(false)}
      />
      <SettingsModal
        open={uiStore.settingsOpen()}
        store={prefsStore}
        onClose={() => uiStore.setSettingsOpen(false)}
      />
      <ShareModal
        open={uiStore.shareOpen()}
        sid={uiStore.shareSid()}
        client={client}
        onClose={() => uiStore.setShareOpen(false)}
      />
      <PermissionApproval client={client} device={currentDevice()} />
      <InboxView
        store={inboxStore}
        open={uiStore.inboxOpen()}
        onClose={() => uiStore.setInboxOpen(false)}
        handlers={{
          jumpToSid: (sid) => sessionsStore.setActiveSid(sid),
          jumpToSidWithApproval: (sid) => sessionsStore.setActiveSid(sid),
        }}
      />
      <CommandPalette
        client={client}
        sessions={sessionsStore.sessions()}
        activeSid={activeSid()}
        actions={paletteActions()}
        onActivateSession={sessionsStore.setActiveSid}
      />
      <WorkflowRunBar
        state={workflowRunner.state()}
        onStop={() => workflowRunner.stop()}
      />
      <PushPrompt client={client} />
      <ToastContainer />
    </Show>
  );
}
