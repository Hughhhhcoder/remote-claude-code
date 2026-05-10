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
import { registerOfflineHtmlWindowHook } from "./exportOfflineHtml";
import { loadCachedMessages } from "../hooks/useOfflineHydrate";
import { t, tt } from "../i18n/index.ts";

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
  /**
   * [B28-C] If set, MessageList scrolls + flashes the row with this id. Pass
   * the same string multiple times to re-trigger the flash (the list effect
   * guards against no-op re-renders). Undefined: no-op.
   */
  scrollTargetId?: string;
  /**
   * [B28-C] Active search query, lowered in the owner. When trimmed-non-empty,
   * a "N / M" overlay with prev/next arrows is rendered inside the chat
   * viewport so the user can step through hits within the active session.
   */
  searchQuery?: string;
  /**
   * [B33-A] Read-only surface: hides composer, skips CRDT draft/voice/injector
   * wiring. Used by SharedReadonlyView for share-token guests where the WS
   * connection is readonly anyway — the composer would just fail on send.
   */
  readOnly?: boolean;
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

  // [B28-B] Offline HTML export — expose a window hook so ChatHeader's export
  // menu (B28-A) can invoke it without a direct import. For the active sid we
  // serve live messages from the stream; for any other sid we fall back to
  // the localStorage offline cache.
  onMount(() => {
    const unregister = registerOfflineHtmlWindowHook({
      getMessages: (sid) =>
        sid === props.sid ? stream.messages() : loadCachedMessages(sid),
      getSession: (sid) => props.sessions.find((s) => s.id === sid),
    });
    onCleanup(unregister);
  });

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
    if (props.readOnly) {
      // Read-only surface: no composer, no CRDT draft sync. Leave draft as "".
      return;
    }
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
      if (!window.confirm(tt("chat.clearConfirm", { name }))) {
        onDraftChange(text); // restore draft so user can edit without re-typing
        flashCancelNotice(tt("chat.cancelledCmd", { name }));
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
      if (active?.getAttribute("aria-label") === t("chat.inputAria")) return;
      if (active) {
        const tag = active.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || active.isContentEditable) return;
      }
      const composer = document.querySelector<HTMLTextAreaElement>(
        `textarea[aria-label="${t("chat.inputAria")}"]`,
      );
      if (composer) composer.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  // --- Scroll target + in-session search nav (B28-C) ----------------------
  // `localTarget` is a ChatSurface-internal signal driven by prev/next arrows
  // on the search overlay. It's suffixed with `#<n>` to disambiguate repeat
  // clicks on the same message id so MessageList's effect re-fires. External
  // `props.scrollTargetId` (from searchStore) flows through when set; the
  // local signal takes over once the user starts stepping.
  const [localTarget, setLocalTarget] = createSignal<string | null>(null);
  const [navBump, setNavBump] = createSignal(0);

  // Clear local nav whenever the active sid or query changes — stale nav
  // state from one session shouldn't carry into the next.
  createMemo(() => {
    props.sid;
    props.searchQuery;
    setLocalTarget(null);
    setNavBump(0);
  });

  // Collect message ids that contain the current searchQuery (case-insensitive
  // plain substring over flattened segment text). Skips tool_use/tool_result
  // content — excerpts on the host side don't include those either.
  const matchingIds = createMemo<string[]>(() => {
    const q = (props.searchQuery ?? "").trim().toLowerCase();
    if (!q) return [];
    const out: string[] = [];
    const msgs = stream.messages();
    for (const m of msgs) {
      for (const seg of m.segments) {
        const content =
          seg.kind === "text" || seg.kind === "code" || seg.kind === "diff" || seg.kind === "thinking"
            ? (seg as { content: string }).content
            : "";
        if (content && content.toLowerCase().includes(q)) {
          out.push(m.id);
          break;
        }
      }
    }
    return out;
  });

  const currentMatchIndex = createMemo<number>(() => {
    const id = effectiveScrollMessageId_lookup();
    if (!id) return -1;
    const i = matchingIds().indexOf(id);
    return i;
  });

  function stepMatch(delta: 1 | -1): void {
    const ids = matchingIds();
    if (ids.length === 0) return;
    const cur = currentMatchIndex();
    // If no match currently focused, start from either end.
    const start = cur >= 0 ? cur : delta > 0 ? -1 : ids.length;
    const next = (start + delta + ids.length) % ids.length;
    setLocalTarget(ids[next]);
    setNavBump((n) => n + 1);
  }

  // Helper for computing the currently-focused match id without creating a
  // circular memo (`currentMatchIndex` depends on the resolved id).
  function effectiveScrollMessageId_lookup(): string | undefined {
    const l = localTarget();
    return l ?? props.scrollTargetId;
  }

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
        messages={stream.messages()}
        client={props.client}
        messagesSlot={
          <div class="relative">
            <MessageList
              messages={stream.messages()}
              onPinToNotebook={props.onPinToNotebook}
              onFork={props.onForkFromMessage}
              scrollTargetId={
                localTarget()
                  ? `${localTarget()!}#${navBump()}`
                  : props.scrollTargetId
              }
            />
            <Show when={(props.searchQuery ?? "").trim().length > 0}>
              <div
                class={[
                  "sticky top-2 z-10 mx-auto flex items-center gap-2",
                  "w-fit rounded-full border border-border-subtle",
                  "bg-bg-surface/90 backdrop-blur px-3 py-1",
                  "text-[11px] text-text-secondary font-sans shadow-sm",
                ].join(" ")}
                role="status"
                aria-label={t("chat.searchResultsAria")}
              >
                <button
                  type="button"
                  class="px-1 text-text-muted hover:text-text-primary disabled:opacity-40"
                  onClick={() => stepMatch(-1)}
                  disabled={matchingIds().length === 0}
                  aria-label={t("chat.prevMatch")}
                >
                  ‹
                </button>
                <span class="tabular-nums">
                  {matchingIds().length === 0
                    ? "0 / 0"
                    : `${currentMatchIndex() >= 0 ? currentMatchIndex() + 1 : 0} / ${matchingIds().length}`}
                </span>
                <button
                  type="button"
                  class="px-1 text-text-muted hover:text-text-primary disabled:opacity-40"
                  onClick={() => stepMatch(1)}
                  disabled={matchingIds().length === 0}
                  aria-label={t("chat.nextMatch")}
                >
                  ›
                </button>
              </div>
            </Show>
          </div>
        }
        composerSlot={
          props.readOnly ? (
            // Read-only surface: empty element (not undefined — else ChatPane
            // falls back to its PlaceholderComposer). B33-A.
            <></>
          ) : (
          <div class="flex flex-col">
            <Show when={remoteEditActive()}>
              <div class="text-[11px] text-accent font-sans mx-4 mb-1">
                {t("chat.collabEditing")}
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
              mentionSessions={props.sessions}
              mentionCwd={props.session?.cwd}
              placeholder={t("chat.composerPlaceholder")}
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
          )
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
