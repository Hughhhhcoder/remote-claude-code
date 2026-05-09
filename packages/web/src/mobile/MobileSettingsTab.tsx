import { For, Show, createMemo } from "solid-js";
import type { SessionMeta, TunnelInfo } from "@rcc/protocol";
import type { RccClient, ConnStatus } from "../client.ts";

interface Props {
  client: RccClient;
  status: ConnStatus;
  sessions: SessionMeta[];
  tunnel: TunnelInfo | null;
  currentDevice: { id: string; name: string; hasPasskey?: boolean } | null;
  hostVersion: string | null;
  onOpenDevices: () => void;
  onOpenConfig: () => void;
  onOpenMarket: () => void;
  onOpenProjects: () => void;
  onOpenPeers: () => void;
  onOpenPrefs: () => void;
  onSignOut: () => void;
}

function statusLabel(status: ConnStatus): string {
  if (status === "connected") return "已连接";
  if (status === "connecting") return "连接中…";
  if (status === "slow") return "连接慢";
  if (status === "readonly") return "只读";
  return "已断开";
}

export function MobileSettingsTab(props: Props) {
  const activeSessions = createMemo(
    () => props.sessions.filter((s) => s.status !== "exited").length,
  );

  return (
    <div class="h-full overflow-y-auto scrollbar pb-4">
      <div class="px-5 pt-4 pb-3">
        <div class="text-[22px] font-bold">设置</div>
      </div>

      <div class="px-4 space-y-4">
        {/* Host card */}
        <div class="rounded-2xl p-4 bg-gradient-to-br from-orange-500/15 to-rose-500/5 border border-orange-500/30">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-xl bg-zinc-950 grid place-items-center text-2xl">
              🖥
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[15px] font-semibold truncate">rcc host</div>
              <div class="text-[11px] text-zinc-400 flex items-center gap-1.5 mt-0.5">
                <span
                  class={`w-1.5 h-1.5 rounded-full ${
                    props.status === "connected"
                      ? "bg-emerald-400 pulse-soft"
                      : "bg-amber-400"
                  }`}
                />
                <span>{statusLabel(props.status)}</span>
              </div>
            </div>
          </div>
          <div class="mt-3 grid grid-cols-3 gap-2 text-center">
            <div class="rounded-lg bg-zinc-950/60 py-2">
              <div class="text-[11px] text-zinc-500">会话</div>
              <div class="text-[13px] font-semibold mt-0.5">
                {activeSessions()}
              </div>
            </div>
            <div class="rounded-lg bg-zinc-950/60 py-2">
              <div class="text-[11px] text-zinc-500">隧道</div>
              <div class="text-[13px] font-semibold mt-0.5">
                {props.tunnel?.state === "ready" ? "ready" : "off"}
              </div>
            </div>
            <div class="rounded-lg bg-zinc-950/60 py-2">
              <div class="text-[11px] text-zinc-500">版本</div>
              <div class="text-[13px] font-semibold mt-0.5 font-mono">
                {props.hostVersion ?? "—"}
              </div>
            </div>
          </div>
          <Show when={props.tunnel?.state === "ready" && props.tunnel?.url}>
            <div class="mt-3 px-3 py-2 rounded-lg bg-zinc-950/60 font-mono text-[11px] text-violet-300 truncate">
              {props.tunnel!.url}
            </div>
          </Show>
        </div>

        {/* Claude 配置 */}
        <div>
          <div class="text-[10px] uppercase tracking-widest text-zinc-600 mb-2 px-1">
            Claude 配置
          </div>
          <div class="rounded-xl bg-zinc-900/60 border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
            <SettingsRow
              icon="✨"
              iconBg="bg-orange-500/20 text-orange-400"
              label="Skills / MCP / Commands / …"
              hint="11 tab 面板"
              onClick={props.onOpenConfig}
            />
            <SettingsRow
              icon="🛍"
              iconBg="bg-sky-500/20 text-sky-400"
              label="Marketplace"
              hint="安装 Skills / MCPs / Plugins"
              onClick={props.onOpenMarket}
            />
            <SettingsRow
              icon="🗂"
              iconBg="bg-violet-500/20 text-violet-400"
              label="项目"
              hint="多项目工作区"
              onClick={props.onOpenProjects}
            />
            <SettingsRow
              icon="🌐"
              iconBg="bg-teal-500/20 text-teal-400"
              label="远程 host 联邦"
              hint="Peers"
              onClick={props.onOpenPeers}
            />
          </div>
        </div>

        {/* 此设备 */}
        <div>
          <div class="text-[10px] uppercase tracking-widest text-zinc-600 mb-2 px-1">
            此设备
          </div>
          <div class="rounded-xl bg-zinc-900/60 border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
            <SettingsRow
              icon="🎨"
              iconBg="bg-zinc-800 text-zinc-300"
              label="外观 / 键位 / 字号"
              onClick={props.onOpenPrefs}
            />
            <Show when={props.currentDevice}>
              <div class="flex items-center gap-3 px-4 py-3">
                <span class="w-7 h-7 rounded-lg bg-zinc-800 grid place-items-center text-sm">
                  📱
                </span>
                <div class="flex-1 min-w-0">
                  <div class="text-[13px]">设备名</div>
                  <div class="text-[10px] text-zinc-500 truncate">
                    {props.currentDevice!.name}
                  </div>
                </div>
              </div>
            </Show>
          </div>
        </div>

        {/* 安全 */}
        <div>
          <div class="text-[10px] uppercase tracking-widest text-zinc-600 mb-2 px-1">
            安全
          </div>
          <div class="rounded-xl bg-zinc-900/60 border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
            <div class="flex items-center gap-3 px-4 py-3">
              <span class="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 grid place-items-center text-sm">
                🔒
              </span>
              <div class="flex-1">
                <div class="text-[13px]">端到端加密</div>
                <div class="text-[10px] text-zinc-500">libsodium · X25519</div>
              </div>
              <span class="text-emerald-400 text-xs">✓</span>
            </div>
            <div class="flex items-center gap-3 px-4 py-3">
              <span class="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 grid place-items-center text-sm">
                🔐
              </span>
              <div class="flex-1">
                <div class="text-[13px]">Passkey</div>
                <div class="text-[10px] text-zinc-500">
                  {props.currentDevice?.hasPasskey ? "已启用" : "未配置 · 进入设备管理"}
                </div>
              </div>
              <Show
                when={props.currentDevice?.hasPasskey}
                fallback={<span class="text-zinc-600 text-xs">—</span>}
              >
                <span class="text-emerald-400 text-xs">✓</span>
              </Show>
            </div>
            <SettingsRow
              icon="🔑"
              iconBg="bg-zinc-800 text-zinc-300"
              label="已配对设备"
              hint="查看 / 吊销"
              onClick={props.onOpenDevices}
            />
            <button
              type="button"
              onClick={props.onSignOut}
              class="w-full flex items-center gap-3 px-4 py-3 active:bg-rose-500/5"
            >
              <span class="w-7 h-7 rounded-lg bg-rose-500/20 text-rose-400 grid place-items-center text-sm">
                ⏏
              </span>
              <div class="flex-1 text-left">
                <div class="text-[13px] text-rose-400">退出此设备</div>
              </div>
              <span class="text-zinc-500">›</span>
            </button>
          </div>
        </div>

        {/* 关于 */}
        <div>
          <div class="text-[10px] uppercase tracking-widest text-zinc-600 mb-2 px-1">
            关于
          </div>
          <div class="rounded-xl bg-zinc-900/60 border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
            <div class="flex items-center gap-3 px-4 py-3">
              <div class="flex-1 text-[13px]">协议</div>
              <span class="text-[11px] text-zinc-500 font-mono">rcc/1</span>
            </div>
            <a
              href="https://github.com/Hughhhhcoder/remote-claude-code"
              target="_blank"
              rel="noopener"
              class="flex items-center gap-3 px-4 py-3 active:bg-zinc-800/40"
            >
              <div class="flex-1 text-[13px]">GitHub</div>
              <span class="text-[11px] text-zinc-500">›</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsRow(props: {
  icon: string;
  iconBg: string;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="w-full flex items-center gap-3 px-4 py-3 active:bg-zinc-800/40"
    >
      <span
        class={`w-7 h-7 rounded-lg grid place-items-center text-sm shrink-0 ${props.iconBg}`}
      >
        {props.icon}
      </span>
      <div class="flex-1 text-left min-w-0">
        <div class="text-[13px] truncate">{props.label}</div>
        <Show when={props.hint}>
          <div class="text-[10px] text-zinc-500 truncate">{props.hint}</div>
        </Show>
      </div>
      <span class="text-[11px] text-zinc-500">›</span>
    </button>
  );
}
