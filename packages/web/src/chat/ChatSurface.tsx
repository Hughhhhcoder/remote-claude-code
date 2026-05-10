import { Show, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import type { CommandSummary, GitStatusData, SessionMeta } from "@rcc/protocol";
import type { RccClient } from "../client";
import { useIsMobile } from "../hooks/useMediaQuery";
import { createSharedText, type SharedText } from "../crdt";
import { ContextInjector } from "../ContextInjector";
import { ChatPane } from "./ChatPane";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { SlashPalette, type SlashCommand } from "./SlashPalette";
import { VoiceButton } from "./VoiceButton";
import { AttachButton } from "./AttachButton";
import { createStreamingMessages } from "./streaming";

/**
 * ChatSurface — wires Phase-4 components into a single drop-in replacement
 * for the old ChatView (chat mode). Owns:
 *   - streaming message store (P4-H)
 *   - composer draft (local) + CRDT sync (`input-draft` shared text)
 *   - slash-palette detection (/<name> prefix in draft)
 *   - context injector modal
 *
 * Props mirror what MainPane already has — sid, session, gitStatus, sessions
 * (for the injector), onPinToNotebook.
 */

export interface ChatSurfaceProps {
  client: RccClient;
  sid: string;
  session: SessionMeta | undefined;
  sessions: SessionMeta[];
  gitStatus?: GitStatusData | null;
  commands: readonly CommandSummary[];
  onPinToNotebook?: (messageId: string) => void;
  /** [B23-A] Fork a new session from a message (copies messages up to and
   *  including that one). */
  onForkFromMessage?: (messageId: string) => void;
  onShare?: () => void;
  onToggleNotebook?: () => void;
  notebookActive?: boolean;
  viewMode?: "chat" | "terminal";
  onToggleViewMode?: () => void;
  /**
   * Optional override for send. When provided, ChatSurface delegates to this
   * instead of calling `client.write` directly — used by MainPane to route
   * through App.sendCommand (which intercepts `/git:<sub>` etc.).
   */
  onSend?: (text: string) => void;
}

/**
 * Slash commands that mutate or destroy conversation state. Intercepted at
 * SEND time (after SlashPalette closes) and gated by a confirm dialog.
 */
const DESTRUCTIVE_SLASH = new Set(["clear", "resume", "reset", "exit"]);
const SLASH_CMD_RE = /^\/(\w[\w:-]*)\b/;

function toSlashCommands(cmds: readonly CommandSummary[]): SlashCommand[] {
  return cmds.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    category: c.scope,
  }));
}

export function ChatSurface(props: ChatSurfaceProps): JSX.Element {
  const isMobile = useIsMobile();

  // --- streaming message store (per-sid) ----------------------------------
  const stream = createStreamingMessages(props.client, () => props.sid, () => props.sessions);
  onCleanup(() => stream.dispose());

  // --- draft + CRDT share --------------------------------------------------
  const [draft, setDraft] = createSignal("");
  const [sharedKey, setSharedKey] = createSignal(0);
  const [remoteEditActive, setRemoteEditActive] = createSignal(false);
  let shared: SharedText | null = null;
  // Last value we wrote locally (via onDraftChange/setValue). Y.Text#observe
  // fires for BOTH local and remote transactions, so we filter out the echo
  // by comparing the observed value against this ref.
  let lastLocalValue = "";
  let remoteEditTimer: ReturnType<typeof setTimeout> | null = null;
  function flashRemoteEdit(): void {
    setRemoteEditActive(true);
    if (remoteEditTimer) clearTimeout(remoteEditTimer);
    remoteEditTimer = setTimeout(() => {
      setRemoteEditActive(false);
      remoteEditTimer = null;
    }, 2000);
  }
  onCleanup(() => {
    if (remoteEditTimer) clearTimeout(remoteEditTimer);
  });

  // Re-create shared text per sid.
  createMemo(() => {
    const sid = props.sid;
    shared?.destroy();
    const s = createSharedText(props.client, sid, "input-draft");
    shared = s;
    const initial = s.getValue();
    lastLocalValue = initial;
    setDraft(initial);
    const off = s.observe((v) => {
      setDraft(v);
      if (v !== lastLocalValue) flashRemoteEdit();
      lastLocalValue = v;
    });
    onCleanup(() => {
      off();
      s.destroy();
      if (shared === s) shared = null;
    });
    setSharedKey((k) => k + 1);
  });
  void sharedKey;

  function onDraftChange(v: string): void {
    lastLocalValue = v;
    setDraft(v);
    shared?.setValue(v);
  }

  // --- voice snapshot ------------------------------------------------------
  let voiceSnapshot = "";
  function onVoiceStart(): void {
    voiceSnapshot = draft();
  }
  function onVoiceTranscript(text: string, _isFinal: boolean): void {
    const combined = voiceSnapshot ? `${voiceSnapshot} ${text}` : text;
    onDraftChange(combined);
  }
  const [voiceError, setVoiceError] = createSignal<string | null>(null);

  // --- send ----------------------------------------------------------------
  // Inline cancel notice shown briefly after a destructive command is aborted.
  const [cancelNotice, setCancelNotice] = createSignal<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  function flashCancelNotice(msg: string): void {
    setCancelNotice(msg);
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      setCancelNotice(null);
      noticeTimer = null;
    }, 2000);
  }
  onCleanup(() => {
    if (noticeTimer) clearTimeout(noticeTimer);
  });

  function onSend(text: string): void {
    if (!text) return;
    const match = SLASH_CMD_RE.exec(text);
    if (match && DESTRUCTIVE_SLASH.has(match[1].toLowerCase())) {
      const name = match[1].toLowerCase();
      // Native confirm is acceptable for this batch; future batch swaps in a Dialog.
      if (!window.confirm(`清空当前对话上下文? (/${name})`)) {
        onDraftChange(text); // restore draft so user can edit without re-typing
        flashCancelNotice(`已取消 /${name}`);
        return;
      }
    }
    if (props.onSend) props.onSend(text);
    else props.client.write(props.sid, text + "\r");
    lastLocalValue = "";
    shared?.setValue("");
    setDraft("");
  }

  // --- slash palette -------------------------------------------------------
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const SLASH_PREFIX_RE = /^\/[a-z0-9:\-_]*$/i;

  // Auto-open on slash-prefix draft, close otherwise.
  const paletteShould = createMemo(() => SLASH_PREFIX_RE.test(draft()));
  // Effect to reconcile open state.
  createMemo(() => {
    const want = paletteShould();
    if (want !== paletteOpen()) setPaletteOpen(want);
  });

  function onPickCommand(name: string): void {
    // Replace the entire slash fragment with `/<name> ` so the user can type args.
    onDraftChange(`/${name} `);
    setPaletteOpen(false);
  }

  // --- attach / context injector ------------------------------------------
  const [injectOpen, setInjectOpen] = createSignal(false);

  // --- last-user-message recall (Cmd+↑) -----------------------------------
  const lastUserText = (): string | null => {
    const msgs = stream.messages();
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === "user" && m.segments.length > 0) {
        return m.segments.filter((s) => s.kind === "text").map((s) => s.content).join("\n").trim();
      }
    }
    return null;
  };

  // --- Esc → focus composer -----------------------------------------------
  // Bubbling phase so Dialog's capture-phase Esc listener always wins first:
  // if a dialog is open, it stopPropagation()s Esc and this never fires. We
  // also skip when focus is inside another text control (Esc-clears-input).
  onMount(() => {
    if (typeof document === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.getAttribute("aria-label") === "输入消息") return;
      if (active) {
        const tag = active.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || active.isContentEditable) return;
      }
      const composer = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="输入消息"]',
      );
      if (composer) composer.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  // --- JSX -----------------------------------------------------------------
  return (
    <>
      <ChatPane
        sid={props.sid}
        session={props.session}
        gitStatus={props.gitStatus ?? null}
        viewMode={props.viewMode}
        onToggleViewMode={props.onToggleViewMode}
        onShare={props.onShare}
        onToggleNotebook={props.onToggleNotebook}
        notebookActive={props.notebookActive}
        messagesSlot={
          <MessageList
            messages={stream.messages()}
            onPinToNotebook={props.onPinToNotebook}
            onFork={props.onForkFromMessage}
          />
        }
        composerSlot={
          <div class="flex flex-col">
            <Show when={remoteEditActive()}>
              <div class="text-[11px] text-accent font-sans mx-4 mb-1">
                👥 协作者正在编辑…
              </div>
            </Show>
            <Composer
              sid={props.sid}
              client={props.client}
              onSend={onSend}
              initialDraft={draft()}
              onDraftChange={onDraftChange}
              remoteEditing={remoteEditActive()}
              getLastUserText={lastUserText}
              onToggleView={props.onToggleViewMode}
              placeholder="发送消息…"
              attachSlot={<AttachButton onClick={() => setInjectOpen(true)} />}
              voiceSlot={
                <VoiceButton
                  onStart={onVoiceStart}
                  onTranscript={onVoiceTranscript}
                  onError={(m) => setVoiceError(m)}
                />
              }
              slashPaletteSlot={
                <Show when={paletteOpen()}>
                  <SlashPalette
                    commands={toSlashCommands(props.commands)}
                    draft={draft()}
                    open={paletteOpen()}
                    onOpenChange={setPaletteOpen}
                    onPick={onPickCommand}
                    isMobile={isMobile()}
                  />
                </Show>
              }
            />
            <Show when={cancelNotice()}>
              <div class="px-3 pb-1 text-text-muted text-[11px]">
                {cancelNotice()}
              </div>
            </Show>
          </div>
        }
      />

      <Show when={voiceError()}>
        <div class="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 text-[11px] text-danger bg-bg-surface border border-border-subtle rounded-md px-3 py-1.5 shadow">
          {voiceError()}
        </div>
      </Show>

      <Show when={injectOpen()}>
        <ContextInjector
          client={props.client}
          activeSid={props.sid}
          sessions={props.sessions}
          onClose={() => setInjectOpen(false)}
        />
      </Show>
    </>
  );
}

export default ChatSurface;
