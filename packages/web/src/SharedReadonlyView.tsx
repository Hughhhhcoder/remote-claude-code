import { createSignal, createMemo, lazy, onCleanup, onMount, Show } from "solid-js";
import type { SessionMeta } from "@rcc/protocol";
import { RccClient, defaultWsUrl, type ConnStatus } from "./client.ts";
import { ChatSurface } from "./chat/ChatSurface.tsx";
// Lazy-load TerminalView so xterm only ships when the terminal view is opened.
const TerminalView = lazy(() =>
  import("./TerminalView.tsx").then((m) => ({ default: m.TerminalView })),
);

interface Props {
  shareToken: string;
}

export function SharedReadonlyView(props: Props) {
  const client = new RccClient({ url: defaultWsUrl(), shareToken: props.shareToken });
  const [status, setStatus] = createSignal<ConnStatus>("connecting");
  const [sessions, setSessions] = createSignal<SessionMeta[]>([]);
  const [sid, setSid] = createSignal<string | null>(null);
  const [expiresAt, setExpiresAt] = createSignal<number | null>(null);
  const [now, setNow] = createSignal(Date.now());
  const [viewMode, setViewMode] = createSignal<"chat" | "terminal">("chat");

  const unsubStatus = client.onStatus(setStatus);
  const unsubFrame = client.on((frame) => {
    if (frame.t === "hello") {
      setSessions(frame.sessions);
      if (frame.sharedSid) setSid(frame.sharedSid);
      if (frame.sharedExpiresAt) setExpiresAt(frame.sharedExpiresAt);
    }
  });

  const tick = setInterval(() => setNow(Date.now()), 1000);

  onMount(() => {
    // Nothing to do — hello auto-attaches on the host side.
  });

  onCleanup(() => {
    unsubStatus();
    unsubFrame();
    clearInterval(tick);
    client.dispose();
  });

  const activeSession = createMemo(() =>
    sessions().find((s) => s.id === sid()) ?? sessions()[0] ?? null,
  );

  const remaining = () => {
    const exp = expiresAt();
    if (exp === null) return null;
    const ms = exp - now();
    if (ms <= 0) return "已过期";
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return `剩 ${mins}m`;
    const hours = Math.floor(mins / 60);
    return `剩 ${hours}h ${mins % 60}m`;
  };

  return (
    <div class="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <div class="h-11 flex items-center justify-between px-4 border-b border-zinc-900 bg-zinc-950 shrink-0">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-sky-500 grid place-items-center font-bold text-[11px]">
            👁
          </div>
          <span class="font-semibold text-sm">rcc</span>
          <span class="text-zinc-700">·</span>
          <span class="text-[11px] px-1.5 py-0.5 rounded border border-violet-500/40 bg-violet-500/10 text-violet-300">
            只读分享
          </span>
          <Show when={sid()}>
            <span class="text-zinc-700">·</span>
            <span class="font-mono text-[11px] text-zinc-500 truncate">{sid()}</span>
          </Show>
        </div>
        <div class="flex items-center gap-3 text-[11px]">
          <Show when={remaining()}>
            <span class="text-zinc-500">{remaining()}</span>
          </Show>
          <StatusBadge status={status()} />
        </div>
      </div>

      <Show
        when={status() === "unauthorized"}
        fallback={
          <Show
            when={activeSession()}
            fallback={
              <div class="flex-1 grid place-items-center text-zinc-500 text-sm">
                {status() === "connecting" ? "连接中…" : "等待会话数据…"}
              </div>
            }
          >
            {(sess) => (
              <>
                <div class="h-12 border-b border-zinc-900 px-5 flex items-center justify-between shrink-0">
                  <div class="flex items-center gap-3 min-w-0">
                    <div class="text-sm font-medium truncate">
                      {sess().title ?? sess().id}
                    </div>
                    <span class="text-zinc-700">·</span>
                    <div class="font-mono text-xs text-zinc-500">{sess().id.slice(0, 12)}</div>
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (sess().driver === "sdk") return;
                        setViewMode((v) => (v === "chat" ? "terminal" : "chat"));
                      }}
                      disabled={sess().driver === "sdk"}
                      class={`text-[10px] px-1.5 py-0.5 rounded border ${
                        sess().driver === "sdk"
                          ? "border-zinc-800 text-zinc-600 cursor-not-allowed"
                          : "border-zinc-700 text-zinc-400 hover:text-zinc-100"
                      }`}
                    >
                      {sess().driver === "sdk"
                        ? "💬 SDK"
                        : viewMode() === "chat"
                          ? "💬 对话"
                          : "▶ 终端"}
                    </button>
                  </div>
                </div>
                <div class="flex-1 min-h-0 relative">
                  <Show
                    when={viewMode() === "terminal" && sess().driver !== "sdk"}
                    fallback={
                      <ChatSurface
                        client={client}
                        sid={sess().id}
                        session={sess()}
                        sessions={sessions()}
                        commands={[]}
                        readOnly
                      />
                    }
                  >
                    <TerminalView client={client} sid={sess().id} />
                  </Show>
                  <div class="absolute top-2 right-2 text-[10px] px-2 py-1 rounded bg-zinc-900/80 border border-zinc-800 text-zinc-500 pointer-events-none">
                    只读模式 · 不能输入
                  </div>
                </div>
              </>
            )}
          </Show>
        }
      >
        <div class="flex-1 grid place-items-center">
          <div class="max-w-md text-center space-y-3 px-6">
            <div class="text-3xl">🔒</div>
            <div class="text-lg font-semibold">分享链接已失效</div>
            <div class="text-sm text-zinc-500">
              链接可能已过期或被撤销。请向发送者索取新链接。
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

function StatusBadge(props: { status: ConnStatus }) {
  const label = () => {
    switch (props.status) {
      case "connected":
        return { color: "bg-emerald-400", text: "text-emerald-400", msg: "connected" };
      case "readonly":
        return { color: "bg-violet-400", text: "text-violet-300", msg: "readonly" };
      case "connecting":
        return { color: "bg-amber-400", text: "text-amber-400", msg: "connecting…" };
      case "unauthorized":
        return { color: "bg-rose-400", text: "text-rose-400", msg: "expired" };
      case "closed":
      default:
        return { color: "bg-rose-400", text: "text-rose-400", msg: "disconnected" };
    }
  };
  return (
    <div class="flex items-center gap-1.5">
      <span class={`w-1.5 h-1.5 rounded-full ${label().color} pulse-soft`} />
      <span class={label().text}>{label().msg}</span>
    </div>
  );
}
