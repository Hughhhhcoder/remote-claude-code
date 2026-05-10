import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import type { ActivityItem } from "@rcc/protocol";
import type { createInboxStore } from "../InboxView.tsx";
import { Chip } from "../primitives/Chip.tsx";
import { EmptyState } from "../primitives/EmptyState.tsx";
import { InboxItem, type InboxItemRecord } from "./InboxItem.tsx";

/**
 * InboxPane — responsive pane for the cross-session activity inbox.
 * Replaces the modal drawer in InboxView.tsx while reusing its store.
 */

export interface InboxPaneProps {
  store: ReturnType<typeof createInboxStore>;
  onJumpToSid?: (sid: string) => void;
  onJumpToSidWithApproval?: (sid: string, approvalId: string) => void;
  onClose?: () => void;
}

type FilterKey = "all" | "approval" | "notification" | "message";
type GroupKey = "today" | "week" | "earlier";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "approval", label: "待审批" },
  { key: "notification", label: "通知" },
  { key: "message", label: "消息" },
];

const GROUP_LABEL: Record<GroupKey, string> = {
  today: "今天",
  week: "本周",
  earlier: "更早",
};

const tsOf = (it: ActivityItem) => (it.kind === "crash" ? it.at : it.timestamp);
const shortSid = (s: string) => (s.length > 8 ? s.slice(0, 8) : s);

function groupOf(ts: number): GroupKey {
  const d = new Date();
  const startToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (ts >= startToday) return "today";
  if (ts >= startToday - 6 * 86_400_000) return "week";
  return "earlier";
}

/** Map wire-level ActivityItem → presentational InboxItemRecord. */
function toRecord(it: ActivityItem, cutoff: number): InboxItemRecord {
  const ts = tsOf(it);
  const unread = ts > cutoff;
  const sidTail = "sid" in it ? shortSid(it.sid) : "";

  if (it.kind === "approval") {
    return {
      id: `approval:${it.id}`,
      kind: "approval",
      title: `${it.tool} 审批 · ${it.status === "pending" ? "待处理" : "已处理"}`,
      subtitle: `${sidTail} · ${it.summary}`,
      sid: it.sid,
      timestamp: ts,
      status: it.status === "pending" ? "pending" : unread ? "unread" : "read",
      icon: it.risk === "high" ? "⛔" : it.risk === "medium" ? "⚡" : "⚠",
      meta: { approvalId: it.id, risk: it.risk },
    };
  }
  if (it.kind === "commits") {
    return {
      id: `commits:${it.id}`,
      kind: "workflow",
      title: `${it.count} 个提交`,
      subtitle: `${sidTail} · ${it.subjects.slice(0, 2).join(" / ") || "(无主题)"}`,
      sid: it.sid,
      timestamp: ts,
      status: unread ? "unread" : "read",
      icon: "✓",
    };
  }
  if (it.kind === "crash") {
    return {
      id: `crash:${it.id}`,
      kind: "system",
      title: `host 崩溃${it.type ? ` (${it.type})` : ""}`,
      subtitle: it.message,
      timestamp: ts,
      status: unread ? "unread" : "read",
      icon: "💥",
    };
  }
  if (it.kind === "update") {
    return {
      id: `update:${it.id}`,
      kind: "notification",
      title: `新版本 ${it.latest}`,
      subtitle: it.notes ? it.notes.slice(0, 120) : "点击版本徽章查看详情",
      timestamp: ts,
      status: unread ? "unread" : "read",
      icon: "⬆",
    };
  }
  // session_exit
  return {
    id: `session_exit:${it.id}`,
    kind: "message",
    title: `会话已结束 · ${it.title}`,
    subtitle: sidTail,
    sid: it.sid,
    timestamp: ts,
    status: unread ? "unread" : "read",
    icon: "🏁",
  };
}

export function InboxPane(props: InboxPaneProps): JSX.Element {
  const [filter, setFilter] = createSignal<FilterKey>("all");

  const records = createMemo<InboxItemRecord[]>(() => {
    const cutoff = props.store.lastOpenedAt();
    return props.store.items()
      .map((it) => toRecord(it, cutoff))
      .sort((a, b) => b.timestamp - a.timestamp);
  });

  const visible = createMemo<InboxItemRecord[]>(() => {
    const f = filter();
    return f === "all" ? records() : records().filter((r) => r.kind === f);
  });

  const grouped = createMemo<Array<[GroupKey, InboxItemRecord[]]>>(() => {
    const b: Record<GroupKey, InboxItemRecord[]> = { today: [], week: [], earlier: [] };
    for (const r of visible()) b[groupOf(r.timestamp)].push(r);
    return (["today", "week", "earlier"] as GroupKey[])
      .filter((k) => b[k].length > 0)
      .map((k) => [k, b[k]] as [GroupKey, InboxItemRecord[]]);
  });

  function onPick(rec: InboxItemRecord) {
    const approvalId =
      rec.kind === "approval" ? (rec.meta?.approvalId as string | undefined) : undefined;
    if (rec.sid && approvalId && rec.status === "pending") {
      props.onJumpToSidWithApproval?.(rec.sid, approvalId);
    } else if (rec.sid) {
      props.onJumpToSid?.(rec.sid);
    }
    props.store.markAllRead();
    props.onClose?.();
  }

  return (
    <div class="flex flex-col h-full bg-bg-page">
      <header class="sticky top-0 z-20 bg-bg-page border-b border-border-subtle">
        <div class="flex items-center justify-between px-4 pt-3 pb-2 gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <h2 class="font-serif text-[15px] text-text-primary m-0 truncate">收件箱</h2>
            <Show when={props.store.unread() > 0}>
              <Chip size="xs" tone="accent">{props.store.unread()}</Chip>
            </Show>
            <span class="font-sans text-[11px] text-text-muted">共 {props.store.total()} 条</span>
          </div>
          <button
            type="button"
            class="font-sans text-[11px] text-text-secondary hover:text-text-primary transition duration-fast ease-rcc px-2 py-1 rounded-sm"
            onClick={() => props.store.markAllRead()}
          >
            全部已读
          </button>
        </div>
        <div class="flex items-center gap-1.5 px-4 pb-2 overflow-x-auto">
          <For each={FILTERS}>
            {(f) => (
              <button type="button" onClick={() => setFilter(f.key)} class="shrink-0">
                <Chip size="sm" tone={filter() === f.key ? "accent" : "neutral"}>
                  {f.label}
                </Chip>
              </button>
            )}
          </For>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto overflow-x-hidden">
        <Show
          when={visible().length > 0}
          fallback={
            <EmptyState icon="📭" title="收件箱为空" description="审批、提交和系统通知将在此汇总。" />
          }
        >
          <For each={grouped()}>
            {([key, rows]) => (
              <section>
                <div class="sticky top-0 z-10 bg-bg-page border-b border-border-subtle px-4 py-1.5 font-sans text-[11px] text-text-muted uppercase tracking-wide">
                  {GROUP_LABEL[key]}
                </div>
                <For each={rows}>{(rec) => <InboxItem item={rec} onClick={onPick} />}</For>
              </section>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

export default InboxPane;
