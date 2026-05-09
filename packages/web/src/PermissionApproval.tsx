import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { ApprovalRisk, FrameByT } from "@rcc/protocol";
import type { RccClient } from "./client.ts";
import { useIsMobile } from "./useIsMobile.ts";

type Pending = FrameByT<"approval.request">;

const HIGH_RISK_DELAY_MS = 500;

interface RiskStyle {
  label: string;
  emoji: string;
  badge: string;
  border: string;
  approve: string;
  approveHigh: string;
}

const RISK_STYLES: Record<ApprovalRisk, RiskStyle> = {
  low: {
    label: "低风险",
    emoji: "🟢",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    border: "border-emerald-500/30",
    approve: "bg-emerald-500 hover:bg-emerald-400 text-zinc-950",
    approveHigh: "bg-emerald-500 hover:bg-emerald-400 text-zinc-950",
  },
  medium: {
    label: "中风险",
    emoji: "🟡",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    border: "border-amber-500/40",
    approve: "bg-emerald-500 hover:bg-emerald-400 text-zinc-950",
    approveHigh: "bg-emerald-500 hover:bg-emerald-400 text-zinc-950",
  },
  high: {
    label: "高风险",
    emoji: "🔴",
    badge: "bg-rose-500/15 text-rose-300 border-rose-500/40",
    border: "border-rose-500/50",
    approve: "bg-rose-500 hover:bg-rose-400 text-white",
    approveHigh: "bg-rose-500 hover:bg-rose-400 text-white",
  },
};

export function PermissionApproval(props: { client: RccClient }) {
  const [current, setCurrent] = createSignal<Pending | null>(null);
  const [showRaw, setShowRaw] = createSignal(false);
  const [onceOnly, setOnceOnly] = createSignal(true);
  const [countdown, setCountdown] = createSignal(0);
  const isMobile = useIsMobile();

  const unsub = props.client.on((frame) => {
    if (frame.t === "approval.request") {
      setCurrent(frame);
      setShowRaw(false);
      setOnceOnly(true);
      if (frame.risk === "high") {
        setCountdown(HIGH_RISK_DELAY_MS);
      } else {
        setCountdown(0);
      }
    } else if (frame.t === "approval.cleared") {
      const c = current();
      if (c && c.id === frame.id) setCurrent(null);
    } else if (frame.t === "session.exited") {
      const c = current();
      if (c && c.sid === frame.sid) setCurrent(null);
    }
  });

  let tickTimer: ReturnType<typeof setInterval> | null = null;
  createEffect(() => {
    const c = current();
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    if (!c || c.risk !== "high") return;
    const started = Date.now();
    tickTimer = setInterval(() => {
      const left = HIGH_RISK_DELAY_MS - (Date.now() - started);
      if (left <= 0) {
        setCountdown(0);
        if (tickTimer) {
          clearInterval(tickTimer);
          tickTimer = null;
        }
      } else {
        setCountdown(left);
      }
    }, 50);
  });

  onCleanup(() => {
    unsub();
    if (tickTimer) clearInterval(tickTimer);
  });

  function respond(approve: boolean) {
    const c = current();
    if (!c) return;
    props.client.send({
      v: 1,
      t: "approval.response",
      id: c.id,
      sid: c.sid,
      approve,
    });
    setCurrent(null);
  }

  return (
    <Show when={current()}>
      {(c) => {
        const style = () => RISK_STYLES[c().risk];
        const approveDisabled = () => countdown() > 0;
        return (
          <div
            class="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
          >
            <div
              class={`w-full md:max-w-md bg-zinc-950 rounded-t-3xl md:rounded-2xl border ${style().border} shadow-2xl p-5 ${
                isMobile() ? "pb-8 animate-slide-up" : ""
              }`}
              style={isMobile() ? { "max-height": "85vh", "overflow-y": "auto" } : {}}
            >
              <div class="flex items-center gap-2 mb-4">
                <span
                  class={`text-[11px] px-2 py-1 rounded-full border font-medium ${style().badge}`}
                >
                  {style().emoji} {style().label}
                </span>
                <span class="text-[11px] text-zinc-500 font-mono">
                  sid:{c().sid.slice(0, 6)}
                </span>
                <span class="ml-auto text-[10px] text-zinc-600">
                  {new Date(c().timestamp).toLocaleTimeString()}
                </span>
              </div>

              <div class="mb-3">
                <div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">工具</div>
                <div class="text-2xl font-bold text-zinc-100">{c().tool}</div>
              </div>

              <Show when={c().summary}>
                <div class="mb-4 text-sm text-zinc-300 leading-relaxed">{c().summary}</div>
              </Show>

              <button
                class="w-full text-left text-[11px] text-zinc-500 hover:text-zinc-300 mb-2 flex items-center gap-1.5"
                onClick={() => setShowRaw((v) => !v)}
              >
                <span>{showRaw() ? "▼" : "▶"}</span>
                <span>原始 prompt（启发式匹配）</span>
              </button>
              <Show when={showRaw()}>
                <pre class="text-[10px] font-mono text-zinc-500 bg-zinc-900/60 rounded-lg p-3 mb-4 max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                  {c().raw}
                </pre>
              </Show>

              <label class="flex items-center gap-2 text-xs text-zinc-400 mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onceOnly()}
                  onChange={(e) => setOnceOnly(e.currentTarget.checked)}
                  class="w-4 h-4 accent-orange-500"
                />
                <span>只同意这一次</span>
                <span class="text-[10px] text-zinc-600">（持久化规则尚未实现）</span>
              </label>

              <Show when={c().risk === "high"}>
                <div class="text-[11px] text-rose-400 mb-3 flex items-center gap-1.5">
                  <span>⚠</span>
                  <span>高风险操作 — 按钮 {(HIGH_RISK_DELAY_MS / 1000).toFixed(1)}s 内不可点击防误触</span>
                </div>
              </Show>

              <div class="grid grid-cols-2 gap-3">
                <button
                  class="h-12 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-sm transition"
                  onClick={() => respond(false)}
                >
                  ✗ 拒绝
                </button>
                <button
                  class={`h-12 rounded-xl font-semibold text-sm transition ${style().approve} disabled:opacity-50 disabled:cursor-not-allowed`}
                  disabled={approveDisabled()}
                  onClick={() => respond(true)}
                >
                  <Show
                    when={!approveDisabled()}
                    fallback={<span>等 {(countdown() / 1000).toFixed(1)}s</span>}
                  >
                    <span>✓ 同意</span>
                  </Show>
                </button>
              </div>

              <div class="mt-3 text-center text-[10px] text-zinc-600">
                30 秒无响应自动取消 · 你也可以在终端直接回答
              </div>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
