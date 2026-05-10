import { For, type JSX } from "solid-js";
import type { PrefsStore } from "../prefs.ts";
import { t, tt } from "../i18n/index.ts";

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
      label: t("mobile.settings.inbox"),
      hint: props.pendingApprovals() > 0 ? tt("mobile.settings.pendingApprovals", { n: props.pendingApprovals() }) : undefined,
      onClick: props.onOpenInbox,
    },
    { icon: "📱", label: t("mobile.settings.pairedDevices"), onClick: props.onOpenDevices },
    { icon: "🌐", label: t("mobile.settings.peers"), onClick: props.onOpenPeers },
    { icon: "🛠️", label: t("mobile.settings.claudeConfig"), hint: t("mobile.settings.claudeConfigHint"), onClick: props.onOpenConfig },
  ];

  return (
    <div class="p-4 space-y-5 font-sans text-text-primary">
      {/* Host card */}
      <section class="rounded-xl bg-bg-surface border border-border-subtle p-4">
        <div class="text-xs uppercase tracking-widest text-text-muted">{t("mobile.settings.thisDevice")}</div>
        <div class="mt-1 text-lg font-medium">
          {props.currentDeviceName() ?? t("mobile.settings.unnamedDevice")}
        </div>
        <div class="mt-2 text-xs font-mono text-text-secondary break-all">
          {props.tunnelUrl() ?? t("mobile.settings.localConnection")}
        </div>
      </section>

      {/* Appearance */}
      <section class="rounded-xl bg-bg-surface border border-border-subtle">
        <div class="px-4 pt-3 pb-1 text-xs uppercase tracking-widest text-text-muted">
          {t("mobile.settings.appearance")}
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          class="w-full px-4 py-3 text-left flex items-center justify-between min-h-[44px] hover:bg-bg-surface-2 transition"
        >
          <span class="text-sm">{t("mobile.settings.theme")}</span>
          <span class="text-sm text-text-secondary">
            {theme() === "dark" ? t("mobile.settings.themeDark") : theme() === "light" ? t("mobile.settings.themeLight") : t("mobile.settings.themeSystem")}
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
          {t("mobile.settings.signOut")}
        </button>
      </section>
    </div>
  );
}

export default MobileSettingsPane;
