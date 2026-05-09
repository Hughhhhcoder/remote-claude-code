import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import type { CommandSummary, SessionMeta, UiCustomKey } from "@rcc/protocol";
import type { RccClient } from "../client.ts";
import { ChatView } from "../ChatView.tsx";
import { useVisualViewportBottom } from "../useVisualViewportBottom.ts";
import {
  startDictation,
  isSpeechSupported,
  hasMediaRecorder,
  errorMessage,
  type DictationHandle,
} from "../voice.ts";

interface Props {
  client: RccClient;
  sid: string;
  sessions: SessionMeta[];
  pinnedCommands: () => readonly CommandSummary[];
  customKeys: () => readonly UiCustomKey[];
  onOpenSessionList: () => void;
  onSendCommand: (cmd: string) => void;
}

function dotForScope(scope: "builtin" | "user" | "project"): string {
  if (scope === "project") return "bg-accent-400";
  if (scope === "user") return "bg-sky-400";
  return "bg-violet-400";
}

export function MobileChatTab(props: Props) {
  const [draft, setDraft] = createSignal("");
  const [recording, setRecording] = createSignal(false);
  const [voiceError, setVoiceError] = createSignal<string | null>(null);
  const kbOffset = useVisualViewportBottom();
  let voiceHandle: DictationHandle | null = null;
  let draftAtStart = "";
  let inputRef: HTMLInputElement | undefined;

  const activeSession = () => props.sessions.find((s) => s.id === props.sid);

  function send() {
    const text = draft().trim();
    if (!text) return;
    props.client.write(props.sid, text + "\r");
    setDraft("");
    inputRef?.focus();
  }

  function onKeyTap(data: string) {
    props.client.write(props.sid, data);
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
        onPartial: (text) => {
          setDraft(draftAtStart ? `${draftAtStart} ${text}` : text);
        },
        onFinal: (text) => {
          if (text) setDraft(draftAtStart ? `${draftAtStart} ${text}` : text);
          setRecording(false);
          voiceHandle = null;
        },
        onError: (code) => {
          setVoiceError(errorMessage(code));
          setRecording(false);
          voiceHandle = null;
        },
      });
    } catch {
      setVoiceError("无法启动语音输入");
      setRecording(false);
    }
  }

  onCleanup(() => {
    voiceHandle?.cancel();
    voiceHandle = null;
  });

  onMount(() => {
    // Initial sync so first render doesn't need a viewport event.
  });

  return (
    <div class="flex flex-col h-full min-h-0 relative">
      {/* session chip */}
      <button
        type="button"
        onClick={props.onOpenSessionList}
        class="shrink-0 mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-full bg-zinc-900/60 border border-zinc-800 active:bg-zinc-900"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-soft shrink-0" />
        <span class="text-xs font-medium truncate max-w-[40%]">
          {activeSession()?.title ?? "无会话"}
        </span>
        <span class="font-mono text-[10px] text-zinc-500 truncate flex-1 text-left">
          {activeSession()?.cwd ?? ""}
        </span>
        <span class="text-[10px] text-zinc-500 shrink-0">▾</span>
      </button>

      {/* conversation (ChatView without its own input) */}
      <div class="flex-1 min-h-0 overflow-hidden">
        <ChatView
          client={props.client}
          sid={props.sid}
          sessions={props.sessions}
          hideInput
        />
      </div>

      {/* bottom input stack — follows soft keyboard via visualViewport */}
      <div
        class="shrink-0 bg-zinc-950/95 backdrop-blur border-t border-zinc-900"
        style={{
          transform: `translateY(-${kbOffset()}px)`,
          transition: "transform 120ms linear",
        }}
      >
        {/* slash commands */}
        <div class="px-2 pt-2 pb-1 flex gap-1 overflow-x-auto no-scrollbar">
          <For each={props.pinnedCommands()}>
            {(c) => (
              <button
                type="button"
                class={`shrink-0 px-2.5 py-1.5 rounded-md border font-mono text-[11px] flex items-center gap-1.5 active:scale-95 transition ${
                  c.scope === "project"
                    ? "bg-accent-500/10 border-accent-500/30 text-accent-300"
                    : "bg-zinc-900 border-zinc-800 text-zinc-300"
                }`}
                onClick={() => props.onSendCommand(`/${c.name}`)}
              >
                <span class={`w-1 h-1 rounded-full ${dotForScope(c.scope)}`} />/{c.name}
              </button>
            )}
          </For>
        </div>

        {/* custom keys (Esc/Tab/↑↓/^C...) */}
        <div class="px-2 pb-1 flex gap-1.5 overflow-x-auto no-scrollbar">
          <For each={props.customKeys()}>
            {(k) => (
              <button
                type="button"
                class="shrink-0 h-8 min-w-[38px] px-2.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-200 font-mono text-[12px] active:bg-accent-500/20 active:border-accent-500/40 active:text-accent-300 transition"
                title={k.hint ?? k.label}
                onPointerDown={(e) => {
                  e.preventDefault();
                  onKeyTap(k.send);
                }}
              >
                {k.label}
              </button>
            )}
          </For>
        </div>

        {/* input pill */}
        <div class="px-3 pb-2">
          <div class="flex items-center gap-1.5 px-2 py-1.5 rounded-full bg-zinc-900/90 border border-zinc-800">
            <input
              ref={inputRef}
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="消息或 /命令"
              enterkeyhint="send"
              class="flex-1 bg-transparent text-sm outline-none text-zinc-100 placeholder-zinc-600 px-2 min-w-0"
            />
            <button
              type="button"
              onClick={toggleMic}
              class={`w-8 h-8 rounded-full grid place-items-center text-sm transition ${
                recording()
                  ? "bg-rose-500 text-white animate-pulse"
                  : "bg-zinc-800 text-zinc-300"
              }`}
              aria-label="语音输入"
            >
              🎙
            </button>
            <button
              type="button"
              onClick={send}
              disabled={!draft().trim()}
              class="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-rose-500 grid place-items-center text-white text-sm disabled:opacity-40"
              aria-label="发送"
            >
              ➤
            </button>
          </div>
        </div>

        <Show when={voiceError()}>
          <div class="px-4 pb-1 text-[11px] text-rose-400">{voiceError()}</div>
        </Show>
      </div>
    </div>
  );
}
