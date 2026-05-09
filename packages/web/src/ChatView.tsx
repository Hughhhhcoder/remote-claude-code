import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import type { RccClient } from "./client.ts";
import type { ChatMessage, ChatSegment } from "@rcc/protocol";
import { createSharedText, type SharedText } from "./crdt.ts";
import {
  startDictation,
  isSpeechSupported,
  hasMediaRecorder,
  errorMessage,
  type DictationHandle,
} from "./voice.ts";

// Semantic chat view backed by the host's heuristic ChatParser. Rendering is
// intentionally minimal: text as wrapped prose, code as monospace blocks,
// diffs line-coloured, tool_use collapsed by default. See host/chat-parser.ts
// for the (lossy) classification rules — clients should offer a terminal
// fallback toggle, which App.tsx does.
export function ChatView(props: { client: RccClient; sid: string }) {
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  // [crdt] The input draft is a Y.Text synced across every client attached
  // to this sid (docId "input-draft"). Local edits propagate via onInput;
  // remote edits land via the observer below and refresh `draft`. Caret may
  // jump when remote inserts land mid-edit — acceptable trade-off.
  const [draft, setDraft] = createSignal("");
  const [recording, setRecording] = createSignal(false);
  const [voiceMode, setVoiceMode] = createSignal<"speech" | "recorder" | null>(null);
  const [voiceError, setVoiceError] = createSignal<string | null>(null);
  let voiceHandle: DictationHandle | null = null;
  let draftAtStart = "";
  let shared: SharedText | null = null;
  let scrollRef: HTMLDivElement | undefined;

  createEffect(() => {
    const sid = props.sid;
    setMessages([]);
    props.client.send({ v: 1, t: "chat.list.request", sid });

    shared?.destroy();
    const s = createSharedText(props.client, sid, "input-draft");
    shared = s;
    setDraft(s.getValue());
    const offObs = s.observe((v) => setDraft(v));
    onCleanup(() => {
      offObs();
      s.destroy();
      if (shared === s) shared = null;
    });
  });

  const unsub = props.client.on((frame) => {
    if (frame.t === "chat.list" && frame.sid === props.sid) {
      setMessages(frame.messages);
      queueMicrotask(() => scrollRef?.scrollTo({ top: scrollRef.scrollHeight }));
    }
    if (frame.t === "chat.append" && frame.sid === props.sid) {
      setMessages((ms) => {
        // If the host is finalizing a streaming message we already have, swap
        // in place (by id) rather than appending a duplicate.
        const idx = ms.findIndex((m) => m.id === frame.message.id);
        if (idx >= 0) {
          const next = [...ms];
          next[idx] = frame.message;
          return next;
        }
        return [...ms, frame.message].slice(-200);
      });
      queueMicrotask(() => scrollRef?.scrollTo({ top: scrollRef.scrollHeight }));
    }
    // [sdk-driver] SDK sessions stream segment patches via chat.update. Apply
    // them in place so text_delta / tool_result land without a full re-append.
    if (frame.t === "chat.update" && frame.sid === props.sid) {
      setMessages((ms) => {
        const idx = ms.findIndex((m) => m.id === frame.messageId);
        if (idx < 0) return ms;
        const msg = ms[idx]!;
        const segments = msg.segments.slice();
        while (segments.length <= frame.segmentIndex) {
          segments.push({ kind: "text", content: "" });
        }
        segments[frame.segmentIndex] = frame.segment;
        const next = [...ms];
        next[idx] = { ...msg, segments };
        return next;
      });
      queueMicrotask(() => scrollRef?.scrollTo({ top: scrollRef.scrollHeight }));
    }
  });
  onCleanup(() => unsub());

  function send() {
    const text = draft().trim();
    if (!text) return;
    const sid = props.sid;
    // Echo locally immediately; host only tracks assistant output.
    const localId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setMessages((ms) => [
      ...ms,
      {
        id: localId,
        sid,
        role: "user",
        segments: [{ kind: "text", content: text }],
        timestamp: Date.now(),
      },
    ]);
    props.client.write(sid, text + "\r");
    shared?.setValue("");
    setDraft("");
    queueMicrotask(() => scrollRef?.scrollTo({ top: scrollRef.scrollHeight }));
  }

  function updateDraft(v: string) {
    setDraft(v);
    shared?.setValue(v);
  }

  async function toggleMic() {
    if (recording()) {
      voiceHandle?.stop();
      return;
    }
    if (!isSpeechSupported() && !hasMediaRecorder()) {
      setVoiceError("此设备不支持语音输入");
      return;
    }
    setVoiceError(null);
    draftAtStart = draft();
    setRecording(true);
    try {
      voiceHandle = await startDictation({
        onMode: (m) => setVoiceMode(m),
        onPartial: (text) => {
          const combined = draftAtStart ? `${draftAtStart} ${text}` : text;
          updateDraft(combined);
        },
        onFinal: (text) => {
          if (text) {
            const combined = draftAtStart ? `${draftAtStart} ${text}` : text;
            updateDraft(combined);
          }
          setRecording(false);
          setVoiceMode(null);
          voiceHandle = null;
        },
        onError: (code, detail) => {
          setVoiceError(errorMessage(code));
          if (detail) console.warn("[voice]", code, detail);
          setRecording(false);
          setVoiceMode(null);
          voiceHandle = null;
        },
      });
    } catch (err: any) {
      console.warn("[voice] start failed", err);
      setVoiceError("无法启动语音输入");
      setRecording(false);
      setVoiceMode(null);
      voiceHandle = null;
    }
  }

  onCleanup(() => {
    voiceHandle?.cancel();
    voiceHandle = null;
  });

  return (
    <div class="flex flex-col h-full bg-zinc-950">
      <div ref={scrollRef} class="flex-1 overflow-y-auto scrollbar p-4 space-y-3">
        <Show
          when={messages().length > 0}
          fallback={
            <div class="text-center text-xs text-zinc-600 py-8">
              暂无对话消息。启发式解析需要 Claude 输出后才会生成卡片。
            </div>
          }
        >
          <For each={messages()}>{(m) => <MessageRow msg={m} />}</For>
        </Show>
      </div>
      <div class="border-t border-zinc-900 p-3 flex gap-2">
        <textarea
          class="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-orange-500"
          rows={2}
          value={draft()}
          onInput={(e) => {
            const v = e.currentTarget.value;
            setDraft(v);
            shared?.setValue(v);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          placeholder="输入消息… Cmd/Ctrl+Enter 发送"
        />
        <div class="flex flex-col gap-2 shrink-0">
          <button
            type="button"
            class={`px-3 py-2 rounded-lg text-base leading-none border transition ${
              recording()
                ? "bg-rose-600/90 border-rose-500 text-white animate-pulse"
                : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
            }`}
            onClick={toggleMic}
            title={
              recording()
                ? voiceMode() === "recorder"
                  ? "录音中(停止后 Whisper 转写)"
                  : "录音中(点击停止)"
                : "语音输入"
            }
            aria-label="语音输入"
          >
            🎙
          </button>
          <button
            class="px-4 py-2 bg-gradient-to-r from-orange-500 to-rose-500 rounded-lg text-sm font-medium"
            onClick={send}
          >
            发送
          </button>
        </div>
      </div>
      <Show when={voiceError()}>
        <div class="px-3 pb-2 text-[11px] text-rose-400">{voiceError()}</div>
      </Show>
    </div>
  );
}

function MessageRow(props: { msg: ChatMessage }) {
  const isUser = () => props.msg.role === "user";
  const isSystem = () => props.msg.role === "system";
  return (
    <div class={`flex ${isUser() ? "justify-end" : "justify-start"}`}>
      <div
        class={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser()
            ? "bg-orange-500/20 border border-orange-500/30"
            : isSystem()
              ? "bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs"
              : "bg-zinc-900 border border-zinc-800"
        }`}
      >
        <For each={props.msg.segments}>{(seg) => <SegmentBlock seg={seg} />}</For>
        <Show when={props.msg.streaming}>
          <span class="inline-block ml-1 text-zinc-500 text-xs animate-pulse">▍</span>
        </Show>
      </div>
    </div>
  );
}

function SegmentBlock(props: { seg: ChatSegment }) {
  return (
    <Show when={props.seg.kind === "text"} fallback={<NonTextSegment seg={props.seg} />}>
      <div class="whitespace-pre-wrap break-words">
        {(props.seg as Extract<ChatSegment, { kind: "text" }>).content}
      </div>
    </Show>
  );
}

function NonTextSegment(props: { seg: ChatSegment }) {
  const kind = () => props.seg.kind;
  return (
    <Show
      when={kind() === "code"}
      fallback={
        <Show
          when={kind() === "diff"}
          fallback={
            <Show
              when={kind() === "thinking"}
              fallback={
                <Show
                  when={kind() === "tool_result"}
                  fallback={
                    <ToolUseBlock
                      seg={props.seg as Extract<ChatSegment, { kind: "tool_use" }>}
                    />
                  }
                >
                  <ToolResultBlock
                    seg={props.seg as Extract<ChatSegment, { kind: "tool_result" }>}
                  />
                </Show>
              }
            >
              <ThinkingBlock
                seg={props.seg as Extract<ChatSegment, { kind: "thinking" }>}
              />
            </Show>
          }
        >
          <DiffBlock
            content={(props.seg as Extract<ChatSegment, { kind: "diff" }>).content}
          />
        </Show>
      }
    >
      <CodeBlock seg={props.seg as Extract<ChatSegment, { kind: "code" }>} />
    </Show>
  );
}

function CodeBlock(props: { seg: Extract<ChatSegment, { kind: "code" }> }) {
  return (
    <pre class="bg-zinc-950 border border-zinc-800 rounded p-2 text-xs overflow-x-auto my-1">
      <Show when={props.seg.lang}>
        <div class="text-[10px] text-zinc-600 mb-1 font-mono">{props.seg.lang}</div>
      </Show>
      <code>{props.seg.content}</code>
    </pre>
  );
}

function DiffBlock(props: { content: string }) {
  const lines = () => props.content.split("\n");
  return (
    <pre class="text-xs font-mono my-1 bg-zinc-950 border border-zinc-800 rounded p-2 overflow-x-auto">
      <For each={lines()}>
        {(line) => (
          <div
            class={
              line.startsWith("+")
                ? "text-emerald-400"
                : line.startsWith("-")
                  ? "text-rose-400"
                  : "text-zinc-400"
            }
          >
            {line || " "}
          </div>
        )}
      </For>
    </pre>
  );
}

function ToolUseBlock(props: { seg: Extract<ChatSegment, { kind: "tool_use" }> }) {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="my-1 border border-zinc-800 rounded bg-zinc-950 text-xs">
      <button
        class="w-full flex items-center gap-2 px-2 py-1 text-left"
        onClick={() => setOpen(!open())}
      >
        <span class="text-zinc-500 w-3">{open() ? "▼" : "▶"}</span>
        <span class="text-sky-400 font-mono">⚙ {props.seg.tool}</span>
        <span class="text-zinc-500 truncate flex-1">
          {props.seg.input.slice(0, 80)}
        </span>
      </button>
      <Show when={open() && props.seg.output}>
        <pre class="border-t border-zinc-800 p-2 overflow-x-auto">
          <code>{props.seg.output}</code>
        </pre>
      </Show>
    </div>
  );
}

// [sdk-driver] Thinking blocks are rendered collapsed-by-default in a muted
// tone so they don't dominate the transcript. Only shown when the SDK emits
// a real thinking block — CLI driver never produces these.
function ThinkingBlock(props: { seg: Extract<ChatSegment, { kind: "thinking" }> }) {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="my-1 border border-zinc-800/60 rounded bg-zinc-900/40 text-xs italic text-zinc-400">
      <button
        class="w-full flex items-center gap-2 px-2 py-1 text-left"
        onClick={() => setOpen(!open())}
      >
        <span class="text-zinc-600 w-3">{open() ? "▼" : "▶"}</span>
        <span class="text-zinc-500">💭 思考</span>
        <span class="text-zinc-600 truncate flex-1 not-italic">
          {props.seg.content.slice(0, 80)}
        </span>
      </button>
      <Show when={open()}>
        <div class="border-t border-zinc-800/60 p-2 whitespace-pre-wrap break-words">
          {props.seg.content}
        </div>
      </Show>
    </div>
  );
}

// [sdk-driver] tool_result pairs 1:1 with a tool_use by toolUseId. Red border
// when is_error so errors are visible without opening the block.
function ToolResultBlock(props: {
  seg: Extract<ChatSegment, { kind: "tool_result" }>;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <div
      class={`my-1 border rounded text-xs ${
        props.seg.isError
          ? "border-rose-600/50 bg-rose-950/20"
          : "border-emerald-700/40 bg-emerald-950/10"
      }`}
    >
      <button
        class="w-full flex items-center gap-2 px-2 py-1 text-left"
        onClick={() => setOpen(!open())}
      >
        <span class="text-zinc-500 w-3">{open() ? "▼" : "▶"}</span>
        <span
          class={`font-mono ${
            props.seg.isError ? "text-rose-400" : "text-emerald-400"
          }`}
        >
          {props.seg.isError ? "✗ 工具错误" : "✓ 工具返回"}
        </span>
        <span class="text-zinc-500 truncate flex-1">
          {props.seg.content.slice(0, 80)}
        </span>
      </button>
      <Show when={open()}>
        <pre
          class={`border-t p-2 overflow-x-auto ${
            props.seg.isError ? "border-rose-600/30" : "border-emerald-700/30"
          }`}
        >
          <code>{props.seg.content}</code>
        </pre>
      </Show>
    </div>
  );
}
