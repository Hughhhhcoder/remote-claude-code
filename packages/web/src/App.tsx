import { createSignal, createMemo, onCleanup, onMount, For, Show } from "solid-js";
import type { CommandSummary, PermissionMode, SessionMeta, TunnelInfo } from "@rcc/protocol";
import { RccClient, defaultWsUrl, type ConnStatus } from "./client.ts";
import { TerminalView } from "./TerminalView.tsx";
import { NewSessionModal, permissionChip } from "./NewSessionModal.tsx";
import { PairingView } from "./PairingView.tsx";
import { DevicesModal } from "./DevicesModal.tsx";
import { ConfigView } from "./ConfigView.tsx";
import { FileBrowser } from "./FileBrowser.tsx";
import { clearToken, loadToken } from "./auth.ts";

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

export function App() {
  const client = new RccClient({ url: defaultWsUrl(), token: loadToken() });

  const [sessions, setSessions] = createSignal<SessionMeta[]>([]);
  const [activeSid, setActiveSid] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<ConnStatus>("connecting");
  const [modalOpen, setModalOpen] = createSignal(false);
  const [lastMode, setLastMode] = createSignal<PermissionMode>("default");
  const [tunnel, setTunnel] = createSignal<TunnelInfo | null>(null);
  const [currentDevice, setCurrentDevice] = createSignal<{ id: string; name: string } | null>(null);
  const [devicesOpen, setDevicesOpen] = createSignal(false);
  const [configOpen, setConfigOpen] = createSignal(false);
  const [fileBrowserOpen, setFileBrowserOpen] = createSignal(false);
  const [fileBrowserRoot, setFileBrowserRoot] = createSignal<string>("~");
  const [pinnedIds, setPinnedIds] = createSignal<string[]>([]);
  const [commandsById, setCommandsById] = createSignal<Record<string, CommandSummary>>({});

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
    }
    if (frame.t === "hello") {
      if (frame.tunnel) setTunnel(frame.tunnel);
      if (frame.device !== undefined) setCurrentDevice(frame.device ?? null);
      if (frame.pinnedCommands) setPinnedIds(frame.pinnedCommands);
    }
    if (frame.t === "cmd.pinned") setPinnedIds(frame.ids);
    if (frame.t === "cmd.list") {
      const map: Record<string, CommandSummary> = {};
      for (const c of frame.commands) map[c.id] = c;
      setCommandsById(map);
    }
    if (frame.t === "tunnel.status") setTunnel(frame.tunnel);
    if (frame.t === "session.created") {
      setSessions((s) => [...s, frame.session]);
      setActiveSid(frame.session.id);
    } else if (frame.t === "session.exited") {
      setSessions((s) =>
        s.map((x) => (x.id === frame.sid ? { ...x, status: "exited" } : x)),
      );
    }
  });

  onMount(() => {
    client.send({ v: 1, t: "cmd.list.request" });
  });

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

  onCleanup(() => {
    unsubStatus();
    unsubFrame();
    client.dispose();
  });

  function onNewSession() {
    setModalOpen(true);
  }

  function onCreateSession(opts: { cwd: string; permissionMode: PermissionMode }) {
    setModalOpen(false);
    setLastMode(opts.permissionMode);
    client.newSession({
      cwd: opts.cwd || undefined,
      permissionMode: opts.permissionMode,
    });
  }

  function onCloseSession(sid: string) {
    if (!confirm(`关闭会话 ${sid}?`)) return;
    client.closeSession(sid);
    setSessions((s) => s.filter((x) => x.id !== sid));
    if (activeSid() === sid) {
      const next = sessions().find((x) => x.id !== sid);
      setActiveSid(next?.id ?? null);
    }
  }

  function sendCommand(cmd: string) {
    const sid = activeSid();
    if (!sid) return;
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
          <span class="text-sm text-zinc-300">local host</span>
          <Show when={activeSession()}>
            <span class="text-zinc-700">/</span>
            <span class="text-xs text-zinc-500 font-mono">{activeSession()!.title}</span>
          </Show>
        </div>
        <div class="flex items-center gap-3">
          <Show when={currentDevice()}>
            <div class="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span>as</span>
              <button
                class="text-zinc-300 hover:text-orange-400 underline decoration-dotted"
                onClick={() => setDevicesOpen(true)}
                title="管理已配对设备"
              >
                {currentDevice()!.name}
              </button>
              <button
                onClick={onSignOut}
                class="ml-1 px-1.5 py-0.5 rounded text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10"
                title="退出登录 (清除本设备 token)"
              >
                ⏏
              </button>
            </div>
          </Show>
          <TunnelBadge info={tunnel()} />
          <StatusBadge status={status()} />
        </div>
      </div>

      {/* Main grid */}
      <div
        class="flex-1 grid"
        style={{
          "grid-template-columns": fileBrowserOpen() ? "240px 1fr 360px" : "240px 1fr",
          "min-height": "0",
        }}
      >
        {/* Sessions */}
        <aside class="bg-zinc-950 border-r border-zinc-900 flex flex-col overflow-hidden">
          <div class="p-3 border-b border-zinc-900">
            <button
              class="w-full py-2 rounded-lg bg-gradient-to-r from-orange-500 to-rose-500 text-white text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90 transition"
              onClick={onNewSession}
            >
              <span>+</span> New session
            </button>
          </div>
          <div class="flex-1 overflow-y-auto scrollbar p-2">
            <div class="text-[10px] uppercase tracking-widest text-zinc-600 px-2 py-2">
              Sessions
            </div>
            <Show
              when={sessions().length > 0}
              fallback={<div class="px-2 py-4 text-xs text-zinc-600">暂无会话</div>}
            >
              <For each={sessions()}>
                {(s) => (
                  <SessionRow
                    meta={s}
                    active={activeSid() === s.id}
                    onActivate={() => setActiveSid(s.id)}
                    onClose={() => onCloseSession(s.id)}
                  />
                )}
              </For>
            </Show>
          </div>

          <div class="p-3 border-t border-zinc-900 space-y-1">
            <button
              class="w-full text-xs text-zinc-500 hover:text-zinc-200 flex items-center gap-1.5 py-1.5 px-2 rounded hover:bg-zinc-900"
              onClick={() => setConfigOpen(true)}
              title="管理 Skills / MCP / Slash Commands / Subagents / Hooks"
            >
              <span>⚙</span>
              <span>Claude Code 配置</span>
            </button>
            <button
              class={`w-full text-xs flex items-center gap-1.5 py-1.5 px-2 rounded hover:bg-zinc-900 ${
                fileBrowserOpen() ? "text-orange-300" : "text-zinc-500 hover:text-zinc-200"
              }`}
              onClick={() => setFileBrowserOpen((v) => !v)}
              title="切换文件浏览器"
            >
              <span>📁</span>
              <span>文件浏览器</span>
            </button>
            <button
              class="w-full text-xs text-zinc-500 hover:text-zinc-200 flex items-center gap-1.5 py-1.5 px-2 rounded hover:bg-zinc-900"
              onClick={() => setDevicesOpen(true)}
              title="管理已配对设备"
            >
              <span>🔑</span>
              <span>已配对设备</span>
            </button>
          </div>
        </aside>

        {/* Main */}
        <main class="bg-zinc-950 flex flex-col overflow-hidden">
          <Show
            when={activeSid()}
            fallback={
              <div class="flex-1 grid place-items-center text-zinc-500 text-sm">
                选择或新建一个会话开始
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
                  </Show>
                </div>
                <div class="text-[11px] text-zinc-500 shrink-0">
                  {activeSession()?.cols}×{activeSession()?.rows}
                </div>
              </div>

              {/* terminal */}
              <div class="flex-1 min-h-0 relative">
                <TerminalView client={client} sid={activeSid()!} />
              </div>

              {/* command bar */}
              <div class="border-t border-zinc-900 p-3 shrink-0">
                <div class="flex items-center gap-1.5 overflow-x-auto scrollbar">
                  <For each={pinnedCommands()}>
                    {(c) => (
                      <button
                        class={`shrink-0 text-[11px] px-2.5 py-1.5 rounded-md border flex items-center gap-1.5 font-mono ${
                          c.scope === "project"
                            ? "bg-orange-500/10 border-orange-500/30 text-orange-300 hover:bg-orange-500/20"
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
                  <KeyButton label="Esc" onClick={() => client.write(activeSid()!, "\x1b")} />
                  <KeyButton label="Tab" onClick={() => client.write(activeSid()!, "\t")} />
                  <KeyButton label="↑" onClick={() => client.write(activeSid()!, "\x1b[A")} />
                  <KeyButton label="↓" onClick={() => client.write(activeSid()!, "\x1b[B")} />
                  <KeyButton label="^C" onClick={() => client.write(activeSid()!, "\x03")} />
                  <KeyButton
                    label="Shift+Tab"
                    onClick={() => client.write(activeSid()!, "\x1b[Z")}
                    hint="plan mode toggle"
                  />
                </div>
                <div class="mt-2 flex items-center justify-between text-[11px] text-zinc-600">
                  <div>点击按钮向当前 session 发送字符</div>
                  <div>M1 · 本地模式</div>
                </div>
              </div>
            </>
          </Show>
        </main>

        <Show when={fileBrowserOpen()}>
          <aside class="bg-zinc-950 border-l border-zinc-900 overflow-hidden">
            <FileBrowser client={client} rootCwd={fileBrowserRoot()} />
          </aside>
        </Show>
      </div>

      <NewSessionModal
        open={modalOpen()}
        defaultCwd=""
        defaultMode={lastMode()}
        onCancel={() => setModalOpen(false)}
        onConfirm={onCreateSession}
      />
      <DevicesModal
        open={devicesOpen()}
        client={client}
        onClose={() => setDevicesOpen(false)}
      />
      <ConfigView
        open={configOpen()}
        client={client}
        activeSid={activeSid()}
        onClose={() => setConfigOpen(false)}
      />
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
            <button
              onClick={copyUrl}
              class="text-violet-300 hover:text-violet-200 font-mono text-[11px] underline decoration-dotted"
              title="点击复制公网地址"
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
        <span class="text-emerald-400">connected</span>
      </Show>
      <Show when={props.status === "connecting"}>
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400 pulse-soft" />
        <span class="text-amber-400">connecting…</span>
      </Show>
      <Show when={props.status === "closed"}>
        <span class="w-1.5 h-1.5 rounded-full bg-rose-400" />
        <span class="text-rose-400">disconnected</span>
      </Show>
    </div>
  );
}

function SessionRow(props: {
  meta: SessionMeta;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
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
          <div class={`text-sm truncate ${props.active ? "text-zinc-100" : "text-zinc-300"}`}>
            {props.meta.title ?? props.meta.id}
          </div>
          <div class="flex items-center gap-1.5 mt-0.5">
            <span class="text-xs text-zinc-500 font-mono truncate">{props.meta.id}</span>
            <PermissionChip mode={props.meta.permissionMode} />
          </div>
        </div>
        <button
          class="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-rose-400 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            props.onClose();
          }}
          title="关闭会话"
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
