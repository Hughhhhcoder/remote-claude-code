import { For, Show } from "solid-js";

export type MobileTab = "chat" | "files" | "approvals" | "settings";

interface TabDef {
  id: MobileTab;
  icon: string;
  label: string;
}

const TABS: readonly TabDef[] = [
  { id: "chat", icon: "💬", label: "对话" },
  { id: "files", icon: "📁", label: "文件" },
  { id: "approvals", icon: "📋", label: "审批" },
  { id: "settings", icon: "⚙", label: "设置" },
];

interface Props {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
  pendingApprovals: number;
  unreadInbox?: number;
  hidden?: boolean;
}

export function MobileTabNav(props: Props) {
  return (
    <Show when={!props.hidden}>
      <div
        class="shrink-0 flex items-stretch justify-around bg-zinc-950/95 backdrop-blur border-t border-zinc-900"
        style={{ "padding-bottom": "env(safe-area-inset-bottom)" }}
      >
        <For each={TABS}>
          {(tab) => {
            const isActive = () => props.active === tab.id;
            const badge = () =>
              tab.id === "approvals" ? props.pendingApprovals : 0;
            return (
              <button
                type="button"
                onClick={() => props.onChange(tab.id)}
                class={`flex flex-col items-center justify-center gap-0.5 flex-1 py-2 text-[10px] relative transition ${
                  isActive() ? "text-accent-400" : "text-zinc-500"
                }`}
              >
                <span class="text-xl leading-none">{tab.icon}</span>
                <span class={isActive() ? "font-medium" : ""}>{tab.label}</span>
                <Show when={badge() > 0}>
                  <span class="absolute top-1 right-[calc(50%-18px)] min-w-[16px] h-4 px-1 rounded-full bg-orange-500 text-[9px] text-white grid place-items-center leading-none">
                    {badge() > 99 ? "99+" : badge()}
                  </span>
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
