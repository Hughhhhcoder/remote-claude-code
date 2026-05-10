import {
  createSignal,
  createEffect,
  onCleanup,
  onMount,
  For,
  Show,
  createMemo,
} from "solid-js";
import { Portal } from "solid-js/web";
import type { RccClient } from "./client.ts";
import type { ChatMessage, ChatSegment, SessionMeta } from "@rcc/protocol";
import { Button } from "./primitives/Button";
import { Chip } from "./primitives/Chip";
import { EmptyState } from "./primitives/EmptyState";

type CountChoice = 10 | 30 | 50 | "all";

const MAX_BYTES = 32 * 1024;
const WARN_BYTES = Math.floor(MAX_BYTES * 0.75); // 24 KB — start warning here

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

function formatKb(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

/**
 * ContextInjector — pick a past session, preview the last N messages, and
 * inject them as a prompt into the active session.
 *
 * Design notes:
 * - Uses semantic tokens (bg-bg-surface, text-text-primary, accent) to match
 *   RCC's Claude-warm design language.
 * - Mobile: bottom sheet with 44px touch targets and safe-area padding.
 * - Desktop: centered card capped at ~720px.
 * - Keyboard: Esc closes, ArrowUp/Down navigate the session list, Enter picks.
 */
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
  const [focusIdx, setFocusIdx] = createSignal(0);

  let panelRef: HTMLDivElement | undefined;
  let firstListItemRef: HTMLButtonElement | undefined;

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
  const approachingLimit = createMemo(
    () => !tooLarge() && promptBytes() >= WARN_BYTES,
  );

  const bytesTone = createMemo<"neutral" | "warn" | "danger">(() => {
    if (tooLarge()) return "danger";
    if (approachingLimit()) return "warn";
    return "neutral";
  });

  const unsub = props.client.on((frame) => {
    if (frame.t === "chat.list" && frame.sid === sourceSid()) {
      setSourceMessages(frame.messages);
      setLoading(false);
      setStep("preview");
    }
  });
  onCleanup(() => unsub());

  // Body scroll lock while the overlay is mounted.
  onMount(() => {
    if (typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    onCleanup(() => {
      document.body.style.overflow = prev;
    });
  });

  // Focus the panel on mount so Esc/Arrow keys work without extra click.
  onMount(() => {
    panelRef?.focus();
  });

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

  function backToPick() {
    setStep("pick");
    setSourceSid(null);
    setSourceMessages([]);
  }

  // When the list is shown, clamp focusIdx and wire keyboard nav.
  createEffect(() => {
    if (step() !== "pick") return;
    const len = otherSessions().length;
    if (focusIdx() >= len) setFocusIdx(Math.max(0, len - 1));
  });

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.onClose();
      return;
    }
    if (step() === "pick") {
      const list = otherSessions();
      if (list.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((i) => Math.min(list.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        const target = list[focusIdx()];
        if (target) {
          e.preventDefault();
          selectSource(target.id);
        }
      }
    }
  }

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) props.onClose();
  }

  return (
    <Portal>
      {/* Backdrop */}
      <div
        class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onBackdrop}
        aria-hidden="true"
      />
      {/* Positioning wrapper — bottom sheet on mobile, centered on desktop */}
      <div
        class="fixed inset-0 z-50 flex pointer-events-none items-end justify-center sm:items-center sm:p-4"
        onClick={onBackdrop}
      >
        <div
          ref={(el) => {
            panelRef = el;
          }}
          role="dialog"
          aria-modal="true"
          aria-label="复用上下文"
          tabIndex={-1}
          onKeyDown={onKeyDown}
          class={[
            "pointer-events-auto relative",
            "bg-bg-surface text-text-primary",
            "w-full max-w-3xl flex flex-col",
            "rounded-t-2xl sm:rounded-lg",
            "max-h-[90vh] sm:max-h-[85vh]",
            "shadow-2xl border border-border-subtle",
            "animate-slide-up sm:animate-fade-in",
            "focus:outline-none",
            "overflow-hidden",
          ].join(" ")}
          style={{ "padding-bottom": "env(safe-area-inset-bottom)" }}
        >
          {/* Mobile drag handle */}
          <div class="sm:hidden flex items-center justify-center pt-2 pb-1 shrink-0">
            <div
              class="w-12 h-[5px] rounded-full bg-border-strong/60"
              aria-hidden="true"
            />
          </div>

          {/* Header */}
          <div class="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0">
            <div class="flex flex-col gap-0.5 min-w-0">
              <h2 class="font-serif text-lg font-medium text-text-primary m-0 truncate">
                复用上下文
              </h2>
              <div class="text-xs text-text-muted">
                {step() === "pick" ? "选择来源会话" : "预览并注入"}
              </div>
            </div>
            <button
              class={[
                "shrink-0 inline-flex items-center justify-center",
                "w-11 h-11 -mr-2 rounded-md",
                "text-text-muted hover:text-text-primary hover:bg-bg-surfaceStrong",
                "transition duration-fast ease-rcc",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              ].join(" ")}
              onClick={props.onClose}
              aria-label="关闭"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>

          {/* STEP: pick */}
          <Show when={step() === "pick"}>
            <div class="flex-1 overflow-y-auto scrollbar px-4 sm:px-5 py-4">
              <Show
                when={otherSessions().length > 0}
                fallback={
                  <EmptyState
                    icon="📂"
                    title="没有其他会话"
                    description="当前没有可供复用的历史会话。先创建或保留一次会话后再来试试。"
                  />
                }
              >
                <div class="grid gap-2">
                  <For each={otherSessions()}>
                    {(s, i) => {
                      const isFocused = () => focusIdx() === i();
                      return (
                        <button
                          ref={(el) => {
                            if (i() === 0) firstListItemRef = el;
                          }}
                          class={[
                            "group w-full text-left rounded-lg border",
                            "px-4 py-3 min-h-[64px]",
                            "bg-bg-surface",
                            "transition duration-fast ease-rcc",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            isFocused()
                              ? "border-accent/60 bg-accent/5 ring-1 ring-accent/30"
                              : "border-border-subtle hover:border-border-strong hover:bg-bg-surfaceStrong",
                          ].join(" ")}
                          onClick={() => {
                            setFocusIdx(i());
                            selectSource(s.id);
                          }}
                          onMouseEnter={() => setFocusIdx(i())}
                        >
                          <div class="flex items-center gap-2.5 min-w-0">
                            <div class="flex-1 min-w-0">
                              <div class="text-sm font-medium text-text-primary truncate">
                                {sessionTitle(s)}
                              </div>
                              <Show when={s.summary?.bullets?.length}>
                                <div class="text-xs text-text-muted mt-1 truncate">
                                  {s.summary!.bullets[0]}
                                </div>
                              </Show>
                            </div>
                            <div class="flex items-center gap-1.5 shrink-0">
                              <Chip tone="neutral" size="xs">
                                <span class="font-mono">{s.driver}</span>
                              </Chip>
                              <Chip
                                tone={s.status === "exited" ? "neutral" : "success"}
                                size="xs"
                                dot={s.status !== "exited"}
                              >
                                {s.status === "exited" ? "已保存" : "活跃"}
                              </Chip>
                            </div>
                          </div>
                        </button>
                      );
                    }}
                  </For>
                </div>
                <div class="mt-4 text-[11px] text-text-muted text-center">
                  ↑↓ 选择 · Enter 确认 · Esc 关闭
                </div>
              </Show>
            </div>
          </Show>

          {/* STEP: preview */}
          <Show when={step() === "preview"}>
            {/* Source bar */}
            <div class="px-5 py-3 border-b border-border-subtle flex items-center gap-3 text-xs shrink-0">
              <span class="text-text-muted">来源:</span>
              <span class="text-text-primary font-medium truncate flex-1">
                {sourceMeta() ? sessionTitle(sourceMeta()!) : ""}
              </span>
              <button
                class={[
                  "shrink-0 h-8 px-2 rounded-md text-xs",
                  "text-text-secondary hover:text-text-primary hover:bg-bg-surfaceStrong",
                  "transition duration-fast ease-rcc",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                ].join(" ")}
                onClick={backToPick}
              >
                ← 换一个
              </button>
            </div>

            {/* Count chooser + size meter */}
            <div class="px-5 py-3 border-b border-border-subtle flex flex-wrap items-center gap-2 shrink-0">
              <span class="text-xs text-text-muted mr-1">条数</span>
              <div class="flex items-center gap-1 flex-wrap">
                <For each={[10, 30, 50, "all"] as const}>
                  {(c) => {
                    const active = () => count() === c;
                    return (
                      <button
                        class={[
                          "h-8 px-3 rounded-md text-xs font-medium",
                          "transition duration-fast ease-rcc",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                          active()
                            ? "bg-accent text-white"
                            : "bg-bg-surfaceStrong text-text-secondary border border-border-subtle hover:text-text-primary hover:border-border-strong",
                        ].join(" ")}
                        onClick={() => setCount(c)}
                      >
                        {c === "all" ? "全部" : `最近 ${c}`}
                      </button>
                    );
                  }}
                </For>
              </div>
              <span class="flex-1" />
              <Chip tone={bytesTone()} size="sm">
                <span class="font-mono tabular-nums">
                  {formatKb(promptBytes())} / {formatKb(MAX_BYTES)} KB
                </span>
              </Chip>
            </div>

            {/* Preview body */}
            <div class="flex-1 overflow-y-auto scrollbar bg-bg-page">
              <Show
                when={!loading()}
                fallback={
                  <div class="flex flex-col items-center justify-center py-16 gap-3">
                    <svg
                      class="animate-spin text-text-muted"
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      aria-hidden="true"
                    >
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    <div class="text-xs text-text-muted">加载会话中…</div>
                  </div>
                }
              >
                <Show
                  when={picked().length > 0}
                  fallback={
                    <EmptyState
                      icon="✨"
                      title="暂无可用消息"
                      description="这个会话暂时没有可复用的消息;换个来源试试。"
                    />
                  }
                >
                  <pre class="text-[12px] text-text-secondary whitespace-pre-wrap break-words font-mono leading-relaxed px-5 py-4 m-0">
                    {prompt()}
                  </pre>
                </Show>
              </Show>
            </div>

            {/* Warning banner */}
            <Show when={tooLarge()}>
              <div class="px-5 py-2.5 text-xs text-danger border-t border-danger/30 bg-danger/10 shrink-0 flex items-center gap-2">
                <span aria-hidden="true">⚠</span>
                <span>内容超出 32 KB 上限,请减少条数后再注入。</span>
              </div>
            </Show>
            <Show when={approachingLimit()}>
              <div class="px-5 py-2.5 text-xs text-warn border-t border-warn/30 bg-warn/10 shrink-0 flex items-center gap-2">
                <span aria-hidden="true">⚠</span>
                <span>接近 32 KB 上限,注入后可能会被截断。</span>
              </div>
            </Show>

            {/* Footer actions */}
            <div class="px-5 py-4 border-t border-border-subtle flex items-center justify-between gap-3 shrink-0">
              <div class="text-xs text-text-muted">
                <Show
                  when={picked().length > 0}
                  fallback={<>无可注入消息</>}
                >
                  将注入 <span class="text-text-primary font-medium">{picked().length}</span> 条消息
                </Show>
              </div>
              <div class="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={props.onClose}>
                  取消
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={confirm}
                  disabled={tooLarge() || picked().length === 0 || loading()}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                  注入到当前会话
                </Button>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Portal>
  );
}
