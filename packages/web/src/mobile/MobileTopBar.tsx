import { Show } from "solid-js";
import type { ConnStatus } from "../client.ts";

interface Props {
  onOpenDrawer: () => void;
  onOpenInbox: () => void;
  title?: string;
  subtitle?: string;
  status: ConnStatus;
  unreadInbox: number;
}

function statusDot(status: ConnStatus): string {
  if (status === "connected") return "bg-emerald-400";
  if (status === "connecting") return "bg-amber-400";
  if (status === "slow") return "bg-amber-400";
  if (status === "readonly") return "bg-sky-400";
  return "bg-rose-500";
}

function statusText(status: ConnStatus): string {
  if (status === "connected") return "已连接";
  if (status === "connecting") return "连接中…";
  if (status === "slow") return "连接慢";
  if (status === "readonly") return "只读";
  if (status === "closed") return "已断开";
  return "未认证";
}

export function MobileTopBar(props: Props) {
  return (
    <div
      class="shrink-0 flex items-center justify-between px-3 bg-zinc-950 border-b border-zinc-900"
      style={{ height: "56px", "padding-top": "env(safe-area-inset-top)" }}
    >
      <button
        type="button"
        onClick={props.onOpenDrawer}
        class="w-9 h-9 rounded-full bg-zinc-900 grid place-items-center text-zinc-300 active:bg-zinc-800"
        aria-label="打开会话列表"
      >
        ☰
      </button>
      <div class="flex flex-col items-center min-w-0 flex-1 px-2">
        <div class="text-[13px] font-semibold truncate max-w-full">
          {props.title ?? "rcc"}
        </div>
        <div class="text-[10px] flex items-center gap-1 text-zinc-400">
          <span class={`w-1 h-1 rounded-full ${statusDot(props.status)}`} />
          <span class="truncate max-w-[200px]">
            {props.subtitle ?? statusText(props.status)}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={props.onOpenInbox}
        class="relative w-9 h-9 rounded-full bg-zinc-900 grid place-items-center text-zinc-300 active:bg-zinc-800"
        aria-label="打开通知"
      >
        🔔
        <Show when={props.unreadInbox > 0}>
          <span class="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-orange-500 text-[9px] text-white grid place-items-center leading-none">
            {props.unreadInbox > 99 ? "99+" : props.unreadInbox}
          </span>
        </Show>
      </button>
    </div>
  );
}
