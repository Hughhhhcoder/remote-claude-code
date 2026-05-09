import { For, Show, type JSX } from "solid-js";

/**
 * TabNav — Phase 2-C bottom tab bar for compact layouts (< 1024px).
 *
 * AppShell controls mounting (it only renders TabNav when `isCompact`), but
 * we also ship a `visible` escape hatch the caller can flip to temporarily
 * hide the bar (e.g. during a fullscreen modal or voice overlay).
 *
 * Iconography: emoji over SVG.
 *   - Zero JS + zero bytes — rendered by the platform font stack.
 *   - Matches the existing RCC chrome (TopBar also uses ☰ 🔔 ⚙).
 *   - Accessible: visible zh label sits beneath each icon; the <button>
 *     carries an explicit aria-label so screen readers don't read the
 *     emoji character name.
 */

export type TabKey = "chat" | "files" | "approvals" | "settings";

export interface TabNavProps {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  /** Badge count for the 审批 tab. */
  pendingApprovals: number;
  /** Caller-controlled hide (e.g. during fullscreen overlays). Defaults true. */
  visible?: boolean;
}

interface TabDef {
  key: TabKey;
  icon: string;
  label: string;
  ariaLabel: string;
}

const TABS: readonly TabDef[] = [
  { key: "chat", icon: "💬", label: "对话", ariaLabel: "对话" },
  { key: "files", icon: "📁", label: "文件", ariaLabel: "文件" },
  {
    key: "approvals",
    icon: "📋",
    label: "审批",
    ariaLabel: "审批",
  },
  {
    key: "settings",
    icon: "⚙",
    label: "设置",
    ariaLabel: "设置",
  },
] as const;

export function TabNav(props: TabNavProps): JSX.Element {
  const visible = () => props.visible !== false;

  return (
    <nav
      role="navigation"
      aria-label="主导航"
      class={[
        // Base: fixed bottom strip, blurred, above main scroll content.
        "fixed inset-x-0 bottom-0 z-20",
        "bg-bg-page/95 backdrop-blur",
        "border-t border-border-subtle font-sans",
        // Defensive: never show on desktop even if caller mounts it.
        "lg:hidden",
        visible() ? "" : "hidden",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "padding-bottom": "env(safe-area-inset-bottom)" }}
    >
      <ul class="flex items-stretch w-full">
        <For each={TABS}>
          {(tab) => {
            const isActive = () => props.active === tab.key;
            const showBadge = () =>
              tab.key === "approvals" && props.pendingApprovals > 0;
            const badgeText = () =>
              props.pendingApprovals > 99
                ? "99+"
                : String(props.pendingApprovals);

            const ariaFull = () =>
              tab.key === "approvals" && props.pendingApprovals > 0
                ? `${tab.ariaLabel},${props.pendingApprovals} 待处理`
                : tab.ariaLabel;

            return (
              <li class="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => props.onChange(tab.key)}
                  aria-label={ariaFull()}
                  aria-current={isActive() ? "page" : undefined}
                  class={[
                    "relative w-full",
                    "flex flex-col items-center gap-0.5 py-2",
                    "text-[10px] leading-none",
                    "transition duration-fast ease-rcc",
                    "focus-visible:outline-none focus-visible:ring-2",
                    "focus-visible:ring-accent focus-visible:ring-inset",
                    isActive()
                      ? "text-accent font-medium"
                      : "text-text-muted hover:text-text-secondary",
                  ].join(" ")}
                >
                  <span
                    class="text-[20px] leading-none"
                    aria-hidden="true"
                  >
                    {tab.icon}
                  </span>
                  <span class="leading-none">{tab.label}</span>
                  <Show when={showBadge()}>
                    <span
                      class={
                        "absolute top-1 right-[calc(50%-18px)] " +
                        "min-w-[16px] h-4 px-1 rounded-full " +
                        "bg-accent text-bg-surface " +
                        "text-[10px] font-semibold leading-4 " +
                        "text-center pointer-events-none"
                      }
                      aria-hidden="true"
                    >
                      {badgeText()}
                    </span>
                  </Show>
                </button>
              </li>
            );
          }}
        </For>
      </ul>
    </nav>
  );
}

export default TabNav;
