import { createSignal, createEffect, onCleanup, For, Show, createMemo } from "solid-js";
import type { RccClient } from "./client.ts";
import type { ChatMessage, ChatSegment, SessionMeta } from "@rcc/protocol";

type CountChoice = 10 | 30 | 50 | "all";

const MAX_BYTES = 32 * 1024;

function segmentToText(seg: ChatSegment): string {
  switch (seg.kind) {
    case "text":
      return seg.content;
    case "code":
      return seg.lang ? "```" + seg.lang + "\n" + seg.content + "\n```" : seg.content;
    case "diff":
      return "```diff\n" + seg.content + "\n```";
    case "thinking":
      return "[thinking] " + seg.content;
    case "tool_use":
      return `[tool:${seg.tool}] ${seg.input}${seg.output ? "\n=> " + seg.output : ""}`;
    case "tool_result":
      return (seg.isError ? "[tool_error] " : "[tool_result] ") + seg.content;
  }
}

function messageToLine(msg: ChatMessage): string {
  const body = msg.segments.map(segmentToText).join("\n");
  return `[${msg.role}] ${body}`;
}

function buildPrompt(title: string, messages: ChatMessage[]): string {
  const lines = messages.map(messageToLine).join("\n\n");
  return `以下是来自会话 "${title}" 的上下文:\n\n${lines}\n\n请基于以上上下文继续协助。`;
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

function sessionTitle(s: SessionMeta): string {
  return s.summary?.title || s.title || s.id.slice(0, 8);
}

export function ContextInjector(props: {
  client: RccClient;
  activeSid: string;
  sessions: SessionMeta[];
  onClose: () => void;
}) {
  const [step, setStep] = createSignal<"pick" | "preview">("pick");
  const [sourceSid, setSourceSid] = createSignal<string | null>(null);
  const [sourceMessages, setSourceMessages] = createSignal<ChatMessage[]>([]);
  const [count, setCount] = createSignal<CountChoice>(30);
  const [loading, setLoading] = createSignal(false);

  const otherSessions = createMemo(() =>
    props.sessions.filter((s) => s.id !== props.activeSid),
  );

  const sourceMeta = createMemo(() => {
    const sid = sourceSid();
    return sid ? props.sessions.find((s) => s.id === sid) ?? null : null;
  });

  const picked = createMemo<ChatMessage[]>(() => {
    const all = sourceMessages();
    const c = count();
    if (c === "all") return all;
    return all.slice(-c);
  });

  const prompt = createMemo(() => {
    const meta = sourceMeta();
    if (!meta) return "";
    return buildPrompt(sessionTitle(meta), picked());
  });

  const promptBytes = createMemo(() => byteLen(prompt()));
  const tooLarge = createMemo(() => promptBytes() > MAX_BYTES);

  const unsub = props.client.on((frame) => {
    if (frame.t === "chat.list" && frame.sid === sourceSid()) {
      setSourceMessages(frame.messages);
      setLoading(false);
      setStep("preview");
    }
  });
  onCleanup(() => unsub());

  function selectSource(sid: string) {
    setSourceSid(sid);
    setSourceMessages([]);
    setLoading(true);
    props.client.send({ v: 1, t: "chat.list.request", sid });
  }

  function confirm() {
    if (tooLarge()) return;
    const text = prompt();
    if (!text) return;
    props.client.write(props.activeSid, text + "\r");
    props.onClose();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }
  }

  return (
    <div
      class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div class="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-900">
          <div class="text-sm font-medium text-zinc-200">
            📋 复用上下文 · {step() === "pick" ? "选择源会话" : "预览并确认"}
          </div>
          <button
            class="text-zinc-500 hover:text-zinc-200 text-lg leading-none"
            onClick={props.onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <Show when={step() === "pick"}>
          <div class="flex-1 overflow-y-auto scrollbar p-3 space-y-1">
            <Show
              when={otherSessions().length > 0}
              fallback={
                <div class="text-center text-xs text-zinc-600 py-12">
                  没有其他会话可供复用。
                </div>
              }
            >
              <For each={otherSessions()}>
                {(s) => (
                  <button
                    class="w-full text-left px-3 py-2 rounded-lg border border-zinc-900 bg-zinc-900/40 hover:border-orange-500/50 hover:bg-zinc-900 transition"
                    onClick={() => selectSource(s.id)}
                  >
                    <div class="flex items-center gap-2">
                      <span class="text-sm text-zinc-200 truncate flex-1">
                        {sessionTitle(s)}
                      </span>
                      <span class="text-[10px] font-mono text-zinc-600">
                        {s.driver}
                      </span>
                      <span class="text-[10px] text-zinc-600">
                        {s.status === "exited" ? "💾" : "●"}
                      </span>
                    </div>
                    <Show when={s.summary?.bullets?.length}>
                      <div class="text-[11px] text-zinc-500 mt-1 truncate">
                        {s.summary!.bullets[0]}
                      </div>
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </Show>

        <Show when={step() === "preview"}>
          <div class="px-4 py-2 border-b border-zinc-900 flex items-center gap-3 text-xs">
            <span class="text-zinc-400">源:</span>
            <span class="text-zinc-200 truncate flex-1">
              {sourceMeta() ? sessionTitle(sourceMeta()!) : ""}
            </span>
            <button
              class="text-zinc-500 hover:text-zinc-300"
              onClick={() => {
                setStep("pick");
                setSourceSid(null);
              }}
            >
              ← 换一个
            </button>
          </div>
          <div class="px-4 py-2 border-b border-zinc-900 flex items-center gap-2 text-xs">
            <span class="text-zinc-400">条数:</span>
            <For each={[10, 30, 50, "all"] as const}>
              {(c) => (
                <button
                  class={`px-2 py-1 rounded border transition ${
                    count() === c
                      ? "border-orange-500 bg-orange-500/10 text-orange-300"
                      : "border-zinc-800 text-zinc-400 hover:border-zinc-700"
                  }`}
                  onClick={() => setCount(c)}
                >
                  {c === "all" ? "全部" : `最近 ${c}`}
                </button>
              )}
            </For>
            <span class="flex-1" />
            <span
              class={`font-mono ${tooLarge() ? "text-rose-400" : "text-zinc-500"}`}
            >
              {(promptBytes() / 1024).toFixed(1)} KB / 32 KB
            </span>
          </div>
          <div class="flex-1 overflow-y-auto scrollbar p-3 bg-zinc-900/30">
            <Show
              when={!loading()}
              fallback={
                <div class="text-center text-xs text-zinc-600 py-12">加载中…</div>
              }
            >
              <Show
                when={picked().length > 0}
                fallback={
                  <div class="text-center text-xs text-zinc-600 py-12">
                    该会话没有可复用的消息。
                  </div>
                }
              >
                <pre class="text-[11px] text-zinc-300 whitespace-pre-wrap break-words font-mono leading-relaxed">
                  {prompt()}
                </pre>
              </Show>
            </Show>
          </div>
          <Show when={tooLarge()}>
            <div class="px-4 py-2 text-[11px] text-rose-400 border-t border-rose-900/40 bg-rose-950/20">
              消息过长,建议减少条数。
            </div>
          </Show>
          <div class="px-4 py-3 border-t border-zinc-900 flex items-center justify-end gap-2">
            <button
              class="px-3 py-1.5 rounded-lg text-xs border border-zinc-800 text-zinc-400 hover:text-zinc-200"
              onClick={props.onClose}
            >
              取消
            </button>
            <button
              class="px-3 py-1.5 rounded-lg text-xs bg-gradient-to-r from-orange-500 to-rose-500 text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={confirm}
              disabled={tooLarge() || picked().length === 0 || loading()}
            >
              注入到当前会话
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
