import { createSignal, createMemo, For, Show } from "solid-js";
import type { ActivityItem } from "@rcc/protocol";
import type { RccClient } from "./client.ts";

type TabKey = "all" | "approval" | "commits" | "system";

const LS_KEY = "rcc:inbox:lastOpenedAt";

function loadLastOpenedAt(): number {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function saveLastOpenedAt(ts: number): void {
  try {
    localStorage.setItem(LS_KEY, String(ts));
  } catch {
    // ignore
  }
}

function itemTimestamp(it: ActivityItem): number {
  return it.kind === "crash" ? it.at : it.timestamp;
}

function itemKey(it: ActivityItem): string {
  return `${it.kind}:${it.id}`;
}

function formatWhen(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d
    .getHours()
    .toString()
    .padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function categoryOf(it: ActivityItem): TabKey {
  if (it.kind === "approval") return "approval";
  if (it.kind === "commits") return "commits";
  return "system";
}

function shortSid(sid: string): string {
  return sid.length > 8 ? sid.slice(0, 8) : sid;
}

export interface InboxStore {
  unread: () => number;
  total: () => number;
  items: () => ActivityItem[];
  lastOpenedAt: () => number;
  markAllRead: () => void;
  dispose: () => void;
}

/**
 * Subscribes to activity frames and keeps a rolling items list in sync. Call
 * once in the App root and pass to <InboxView>. `unread()` reflects the
 * count of items newer than the last time the user opened the inbox.
 */
export function createInboxStore(client: RccClient): InboxStore {
  const [items, setItems] = createSignal<ActivityItem[]>([]);
  const [lastOpenedAt, setLastOpenedAt] = createSignal<number>(loadLastOpenedAt());

  const unsub = client.on((frame) => {
    if (frame.t === "activity.list") {
      const byKey = new Map<string, ActivityItem>();
      for (const it of items()) byKey.set(itemKey(it), it);
      for (const it of frame.items) byKey.set(itemKey(it), it);
      setItems([...byKey.values()].sort((a, b) => itemTimestamp(a) - itemTimestamp(b)));
    } else if (frame.t === "activity.append") {
      const k = itemKey(frame.item);
      setItems((prev) => {
        const idx = prev.findIndex((x) => itemKey(x) === k);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = frame.item;
          return next;
        }
        return [...prev, frame.item];
      });
    }
  });

  const statusUnsub = client.onStatus((s) => {
    if (s === "connected") {
      client.send({ v: 1, t: "activity.list.request" });
    }
  });

  const unread = createMemo(() => {
    const cutoff = lastOpenedAt();
    return items().filter((it) => itemTimestamp(it) > cutoff).length;
  });

  return {
    unread,
    total: () => items().length,
    items,
    lastOpenedAt,
    markAllRead: () => {
      const now = Date.now();
      setLastOpenedAt(now);
      saveLastOpenedAt(now);
    },
    dispose: () => {
      unsub();
      statusUnsub();
    },
  };
}

export interface InboxHandlers {
  jumpToSid: (sid: string) => void;
  jumpToSidWithApproval?: (sid: string, approvalId: string) => void;
}

export function InboxView(props: {
  store: InboxStore;
  open: boolean;
  onClose: () => void;
  handlers: InboxHandlers;
}) {
  const [tab, setTab] = createSignal<TabKey>("all");

  const sorted = createMemo(() => {
    const arr = [...props.store.items()];
    arr.sort((a, b) => itemTimestamp(b) - itemTimestamp(a));
    return arr;
  });

  const visible = createMemo(() => {
    const t = tab();
    const arr = sorted();
    if (t === "all") return arr;
    return arr.filter((it) => categoryOf(it) === t);
  });

  function onItemClick(it: ActivityItem) {
    switch (it.kind) {
      case "approval":
        if (it.status === "pending" && props.handlers.jumpToSidWithApproval) {
          props.handlers.jumpToSidWithApproval(it.sid, it.id);
        } else {
          props.handlers.jumpToSid(it.sid);
        }
        props.store.markAllRead();
        props.onClose();
        return;
      case "commits":
      case "session_exit":
        props.handlers.jumpToSid(it.sid);
        props.store.markAllRead();
        props.onClose();
        return;
      case "crash":
        alert(`${it.type ?? "crash"}: ${it.message}`);
        return;
      case "update":
        props.store.markAllRead();
        props.onClose();
        return;
    }
  }

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-[70] flex">
        <div
          class="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={() => {
            props.store.markAllRead();
            props.onClose();
          }}
        />
        <aside class="relative ml-auto w-full sm:w-[420px] h-full bg-zinc-950 border-l border-zinc-900 shadow-2xl flex flex-col">
          <div class="h-11 flex items-center justify-between px-4 border-b border-zinc-900 shrink-0">
            <div class="flex items-center gap-2">
              <span>📥</span>
              <span class="text-sm font-semibold">Inbox</span>
              <span class="text-[10px] text-zinc-500">{props.store.total()} 条</span>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="text-[10px] text-zinc-500 hover:text-zinc-200"
                onClick={() => props.store.markAllRead()}
                title="标记全部已读"
              >
                全部已读
              </button>
              <button
                class="text-zinc-500 hover:text-zinc-200 text-sm"
                onClick={() => {
                  props.store.markAllRead();
                  props.onClose();
                }}
                title="关闭"
              >
                ✕
              </button>
            </div>
          </div>
          <div class="flex items-center gap-1 px-3 py-2 border-b border-zinc-900 shrink-0">
            <TabBtn label="全部" active={tab() === "all"} onClick={() => setTab("all")} />
            <TabBtn label="审批" active={tab() === "approval"} onClick={() => setTab("approval")} />
            <TabBtn label="提交" active={tab() === "commits"} onClick={() => setTab("commits")} />
            <TabBtn label="系统" active={tab() === "system"} onClick={() => setTab("system")} />
          </div>
          <div class="flex-1 overflow-y-auto scrollbar">
            <Show
              when={visible().length > 0}
              fallback={<div class="text-center text-xs text-zinc-600 py-16">暂无事件</div>}
            >
              <For each={visible()}>
                {(it) => (
                  <ItemRow
                    item={it}
                    isUnread={itemTimestamp(it) > props.store.lastOpenedAt()}
                    onClick={() => onItemClick(it)}
                  />
                )}
              </For>
            </Show>
          </div>
        </aside>
      </div>
    </Show>
  );
}

function TabBtn(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      class={`text-[11px] px-2.5 py-1 rounded-md border ${
        props.active
          ? "bg-accent-500/10 border-accent-500/40 text-accent-300"
          : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {props.label}
    </button>
  );
}

function ItemRow(props: { item: ActivityItem; isUnread: boolean; onClick: () => void }) {
  const it = () => props.item;
  return (
    <button
      class={`w-full text-left px-3 py-2.5 border-b border-zinc-900 flex items-start gap-2.5 hover:bg-zinc-900/50 ${
        props.isUnread ? "bg-zinc-900/20" : ""
      }`}
      onClick={props.onClick}
    >
      <span class="mt-0.5 shrink-0">{iconFor(it())}</span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-zinc-200 truncate">{titleFor(it())}</span>
          <Show when={props.isUnread}>
            <span class="w-1.5 h-1.5 rounded-full bg-accent-400 shrink-0" />
          </Show>
        </div>
        <div class="text-[11px] text-zinc-500 truncate">{subtitleFor(it())}</div>
        <div class="text-[10px] text-zinc-600 mt-0.5">{formatWhen(itemTimestamp(it()))}</div>
      </div>
    </button>
  );
}

function iconFor(it: ActivityItem): string {
  switch (it.kind) {
    case "approval":
      return it.risk === "high" ? "⚠" : it.risk === "medium" ? "⚡" : "🔔";
    case "commits":
      return "✓";
    case "crash":
      return "💥";
    case "update":
      return "⬆";
    case "session_exit":
      return "🏁";
  }
}

function titleFor(it: ActivityItem): string {
  switch (it.kind) {
    case "approval":
      return `${it.tool} 审批 · ${it.status === "pending" ? "待处理" : "已处理"}`;
    case "commits":
      return `${it.count} 个提交`;
    case "crash":
      return `host 崩溃${it.type ? ` (${it.type})` : ""}`;
    case "update":
      return `新版本 ${it.latest}`;
    case "session_exit":
      return `会话已结束 · ${it.title}`;
  }
}

function subtitleFor(it: ActivityItem): string {
  switch (it.kind) {
    case "approval":
      return `${shortSid(it.sid)} · ${it.summary}`;
    case "commits":
      return `${shortSid(it.sid)} · ${it.subjects.slice(0, 2).join(" / ") || "(无主题)"}`;
    case "crash":
      return it.message;
    case "update":
      return it.notes ? it.notes.slice(0, 120) : "点击右上角版本徽章查看详情";
    case "session_exit":
      return shortSid(it.sid);
  }
}
