import { For, type JSX } from "solid-js";
import type { PrefsStore } from "../prefs.ts";

/**
 * MobileSettingsPane — mobile-only settings tab content.
 *
 * Mirrors the mockup/mobile.html settings tab: host card at top, then
 * device preferences (theme/notifications), then shortcut rows to
 * existing modals (devices / peers / config / inbox). Keeps this
 * component link-heavy — it does not duplicate any modal's internals.
 */

interface Row {
  icon: string;
  label: string;
  hint?: string;
  onClick: () => void;
}

export interface MobileSettingsPaneProps {
  prefs: PrefsStore;
  currentDeviceName: () => string | null;
  tunnelUrl: () => string | null;
  pendingApprovals: () => number;
  onOpenConfig: () => void;
  onOpenDevices: () => void;
  onOpenPeers: () => void;
  onOpenInbox: () => void;
  onSignOut: () => void;
}

export function MobileSettingsPane(props: MobileSettingsPaneProps): JSX.Element {
  const theme = () => props.prefs.prefs().theme;
  const toggleTheme = () => {
    const next = theme() === "dark" ? "light" : theme() === "light" ? "system" : "dark";
    props.prefs.update({ theme: next });
  };

  const rows: () => Row[] = () => [
    {
      icon: "📥",
      label: "收件箱",
      hint: props.pendingApprovals() > 0 ? `${props.pendingApprovals()} 待审批` : undefined,
      onClick: props.onOpenInbox,
    },
    { icon: "📱", label: "已配对设备", onClick: props.onOpenDevices },
    { icon: "🌐", label: "联邦对端", onClick: props.onOpenPeers },
    { icon: "🛠️", label: "Claude 配置", hint: "skills / hooks / mcp / prompts", onClick: props.onOpenConfig },
  ];

  return (
    <div class="p-4 space-y-5 font-sans text-text-primary">
      {/* Host card */}
      <section class="rounded-xl bg-bg-surface border border-border-subtle p-4">
        <div class="text-xs uppercase tracking-widest text-text-muted">此机</div>
        <div class="mt-1 text-lg font-medium">
          {props.currentDeviceName() ?? "未命名设备"}
        </div>
        <div class="mt-2 text-xs font-mono text-text-secondary break-all">
          {props.tunnelUrl() ?? "本地连接 (ws://)"}
        </div>
      </section>

      {/* Appearance */}
      <section class="rounded-xl bg-bg-surface border border-border-subtle">
        <div class="px-4 pt-3 pb-1 text-xs uppercase tracking-widest text-text-muted">
          外观
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          class="w-full px-4 py-3 text-left flex items-center justify-between min-h-[44px] hover:bg-bg-surface-2 transition"
        >
          <span class="text-sm">主题</span>
          <span class="text-sm text-text-secondary">
            {theme() === "dark" ? "🌙 深色" : theme() === "light" ? "☀️ 浅色" : "🖥 跟随系统"}
          </span>
        </button>
      </section>

      {/* Navigation rows */}
      <section class="rounded-xl bg-bg-surface border border-border-subtle overflow-hidden">
        <For each={rows()}>
          {(row, i) => (
            <button
              type="button"
              onClick={row.onClick}
              class={[
                "w-full px-4 py-3 text-left flex items-center gap-3 min-h-[48px]",
                "hover:bg-bg-surface-2 transition",
                i() > 0 ? "border-t border-border-subtle" : "",
              ].join(" ")}
            >
              <span class="text-xl" aria-hidden="true">
                {row.icon}
              </span>
              <span class="flex-1 text-sm">{row.label}</span>
              {row.hint ? (
                <span class="text-xs text-text-muted">{row.hint}</span>
              ) : (
                <span class="text-text-muted text-lg">›</span>
              )}
            </button>
          )}
        </For>
      </section>

      {/* Sign out */}
      <section class="rounded-xl bg-bg-surface border border-border-subtle">
        <button
          type="button"
          onClick={props.onSignOut}
          class="w-full px-4 py-3 text-left text-sm text-danger min-h-[44px]"
        >
          退出并解绑本设备
        </button>
      </section>
    </div>
  );
}

export default MobileSettingsPane;
