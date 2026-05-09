import { For, Show, createMemo } from "solid-js";
import type { ActivityItem, ApprovalRisk } from "@rcc/protocol";

interface Props {
  items: () => ActivityItem[];
  onJumpToSid: (sid: string) => void;
  onSwitchToChat: () => void;
}

const RISK_BORDER: Record<ApprovalRisk, string> = {
  low: "border-emerald-500/30 bg-emerald-500/5",
  medium: "border-amber-500/30 bg-amber-500/5",
  high: "border-rose-500/40 bg-rose-500/10",
};

const RISK_LABEL: Record<ApprovalRisk, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
};

const RISK_BADGE: Record<ApprovalRisk, string> = {
  low: "bg-emerald-500/20 text-emerald-300",
  medium: "bg-amber-500/20 text-amber-300",
  high: "bg-rose-500/20 text-rose-300",
};

function formatAgo(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 60_000) return "刚刚";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分钟前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
  return `${Math.floor(ms / 86_400_000)} 天前`;
}

export function MobileApprovalsTab(props: Props) {
  const approvals = createMemo(() =>
    props.items()
      .filter((it): it is Extract<ActivityItem, { kind: "approval" }> => it.kind === "approval")
      .sort((a, b) => b.timestamp - a.timestamp),
  );

  const pending = createMemo(() => approvals().filter((a) => a.status === "pending"));
  const history = createMemo(() => approvals().filter((a) => a.status === "resolved"));

  return (
    <div class="h-full overflow-y-auto scrollbar pb-4">
      <div class="px-5 pt-4 pb-3 flex items-center justify-between">
        <div class="text-[22px] font-bold">审批</div>
        <div class="text-[10px] px-2 py-1 rounded-full bg-orange-500/15 text-orange-400">
          {pending().length} 待批 · {history().length} 历史
        </div>
      </div>

      <div class="px-4 space-y-3">
        <Show when={pending().length > 0}>
          <div class="text-[10px] uppercase tracking-widest text-amber-400 flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400 pulse-soft" />
            待批 · 请处理
          </div>
          <div class="text-[11px] text-zinc-400 px-1 pb-1">
            审批弹窗会自动浮出;你也可以点卡片跳到对应会话处理。
          </div>
          <For each={pending()}>
            {(a) => (
              <button
                type="button"
                onClick={() => {
                  props.onJumpToSid(a.sid);
                  props.onSwitchToChat();
                }}
                class={`w-full text-left rounded-2xl border-2 p-4 active:scale-[0.99] transition ${RISK_BORDER[a.risk]}`}
              >
                <div class="flex items-center gap-2 mb-2">
                  <span
                    class={`text-[11px] px-2 py-0.5 rounded-full font-medium ${RISK_BADGE[a.risk]}`}
                  >
                    {RISK_LABEL[a.risk]}
                  </span>
                  <span class="text-[11px] text-zinc-400 font-mono truncate flex-1">
                    {a.tool}
                  </span>
                  <span class="text-[10px] text-zinc-500 shrink-0">{formatAgo(a.timestamp)}</span>
                </div>
                <Show when={a.summary}>
                  <div class="text-[13px] text-zinc-200 leading-snug">{a.summary}</div>
                </Show>
                <div class="mt-2 text-[10px] text-zinc-500 font-mono">
                  sid: {a.sid.slice(0, 8)}…
                </div>
              </button>
            )}
          </For>
        </Show>

        <Show when={pending().length === 0}>
          <div class="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 text-center">
            <div class="text-4xl mb-2">✓</div>
            <div class="text-sm text-zinc-300">当前没有待审批的请求</div>
            <div class="text-[11px] text-zinc-500 mt-1">
              Claude 需要权限时会浮出审批弹窗
            </div>
          </div>
        </Show>

        <Show when={history().length > 0}>
          <div class="text-[10px] uppercase tracking-widest text-zinc-600 mt-2 px-1">
            历史
          </div>
          <div class="space-y-1.5">
            <For each={history().slice(0, 30)}>
              {(a) => (
                <div class="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-zinc-900/40">
                  <span
                    class={`w-7 h-7 rounded-full grid place-items-center text-xs shrink-0 ${RISK_BADGE[a.risk]}`}
                  >
                    {a.risk === "high" ? "!" : "✓"}
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="font-mono text-[11px] text-zinc-300 truncate">
                      {a.tool}
                    </div>
                    <div class="text-[10px] text-zinc-500 truncate">
                      {formatAgo(a.timestamp)} · {a.summary || "—"}
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
