import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import type { RccClient } from "../client";
import type { FileEntry, SessionMeta } from "@rcc/protocol";
import { IconButton } from "../primitives/IconButton";
import { useIsMobile } from "../hooks/useMediaQuery";
import { MentionPopover, type MentionItem } from "./MentionPopover";

/**
 * Composer — pill-shaped chat input (Phase 4-I).
 *
 * Replaces the textarea + button block from the legacy ChatView. Outer shell
 * is a single rounded-xl pill with a left attach slot, auto-grow textarea,
 * voice slot, and circular accent send button.
 *
 * Auto-grow: inlined (not reusing primitives/Textarea) because the primitive
 * owns its own border/padding and renders a label+hint wrapper that conflicts
 * with the inline-button pill layout. We just adopt the same
 * `height = auto → scrollHeight, clamped` strategy.
 *
 * IME-safe: Enter during an active CJK composition session does NOT submit.
 * We track `compositionstart`/`compositionend` and also check the
 * `KeyboardEvent.isComposing` flag as a belt-and-braces guard.
 *
 * Sticky / viewport behavior is the PARENT's job (ChatPane + AppShell already
 * run `useVisualViewportBottom` to follow the mobile soft keyboard). The
 * composer itself just renders a normal block and calls `onFocus` so parents
 * can scroll messages to the bottom when the keyboard opens.
 *
 * [B24-B] @-mention: typing `@` at start-of-line or after whitespace opens a
 * MentionPopover listing sessions (from `mentionSessions` prop) and files
 * (fetched via `fs.ls.request` when `mentionCwd` is provided). Picking inserts
 * a token like `@session:<sid>` or `@file:<relpath>` at the cursor. Tokens are
 * pure text — no protocol change; the receiving side just renders them as-is.
 */

export interface ComposerProps {
  /** The session this composer belongs to. Required. */
  sid: string;
  /** Shared client — used for chat CRDT draft + voice events. */
  client: RccClient;
  /** Called to send the message. Receives the trimmed-edge text. */
  onSend: (text: string) => void;
  /** Slot for the attach button (P4-K AttachButton). */
  attachSlot?: JSX.Element;
  /** Slot for voice button (P4-K VoiceButton). */
  voiceSlot?: JSX.Element;
  /** Slot for the slash palette trigger (P4-J). Rendered above the composer. */
  slashPaletteSlot?: JSX.Element;
  /** Placeholder text. Optional. */
  placeholder?: string;
  /** Disabled state (e.g. session detached). */
  disabled?: boolean;
  /**
   * When true (default), Shift+Enter inserts a newline and bare Enter submits.
   * When false (CLI terminal mode), bare Enter submits unconditionally.
   */
  allowShiftEnterForNewline?: boolean;
  /** Called when textarea is focused — parent may scroll chat to bottom. */
  onFocus?: () => void;
  /** Called when the draft text changes. Parent owns CRDT sync. */
  onDraftChange?: (text: string) => void;
  /** Initial draft value (from CRDT shared text hydration). */
  initialDraft?: string;
  /** When true, draws a faint accent ring to signal a remote collaborator edit. */
  remoteEditing?: boolean;
  /**
   * Returns the last user message text for Cmd+↑ recall. When null, recall is
   * a no-op. Called lazily only when the shortcut fires and draft is empty.
   */
  getLastUserText?: () => string | null;
  /**
   * Called when user presses Cmd+/ to toggle between chat/terminal views.
   * When omitted (e.g. SDK-driver sessions), the shortcut is a no-op.
   */
  onToggleView?: () => void;
  /**
   * [B24-B] Session list for @session mention autocomplete. When omitted, the
   * session section of the popover is empty (file results still work).
   */
  mentionSessions?: readonly SessionMeta[];
  /**
   * [B24-B] Working directory for @file mention autocomplete. When omitted,
   * file results are not fetched (session suggestions still work).
   */
  mentionCwd?: string;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
const modKey = (e: KeyboardEvent) => (IS_MAC ? e.metaKey : e.ctrlKey);

const MAX_HEIGHT_PX = 192; // 8 rows × 24px line-height
const MIN_HEIGHT_PX = 40; // single-line resting height

const MENTION_MAX_RESULTS = 20;
const MENTION_DEBOUNCE_MS = 200;

/**
 * Detect an active `@...` mention fragment at the given caret position.
 * Returns the fragment start index (position of `@`) and the query (text
 * after `@`), or null if the caret is not in a mention context.
 *
 * Rules:
 *   - `@` must be preceded by start-of-line or whitespace.
 *   - Fragment ends at the caret. Query must not contain whitespace.
 */
function detectMention(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  // Walk back from caret to find the nearest `@` or boundary.
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === "@") {
      const before = i === 0 ? "\n" : text[i - 1];
      if (/\s/.test(before) || before === "\n") {
        return { start: i, query: text.slice(i + 1, caret) };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}

export function Composer(props: ComposerProps): JSX.Element {
  const isMobile = useIsMobile();

  const [draft, setDraft] = createSignal(props.initialDraft ?? "");
  const [composing, setComposing] = createSignal(false);
  const [flash, setFlash] = createSignal(false);
  let ref: HTMLTextAreaElement | undefined;

  // --- @-mention state ----------------------------------------------------
  const [mentionOpen, setMentionOpen] = createSignal(false);
  const [mentionStart, setMentionStart] = createSignal(-1);
  const [mentionQuery, setMentionQuery] = createSignal("");
  const [fileResults, setFileResults] = createSignal<FileEntry[]>([]);
  const [filesLoading, setFilesLoading] = createSignal(false);
  // Path (relative to cwd) currently being listed. "" = cwd itself.
  const [fileListedDir, setFileListedDir] = createSignal<string | null>(null);
  let fileDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  function closeMention() {
    setMentionOpen(false);
    setMentionStart(-1);
    setMentionQuery("");
    if (fileDebounceTimer) {
      clearTimeout(fileDebounceTimer);
      fileDebounceTimer = null;
    }
  }

  function resize() {
    const el = ref;
    if (!el) return;
    el.style.height = "auto";
    if (el.value.length === 0) {
      el.style.height = `${MIN_HEIGHT_PX}px`;
      el.style.overflowY = "hidden";
      return;
    }
    const next = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
  }

  onMount(() => {
    queueMicrotask(resize);
  });

  onCleanup(() => {
    if (fileDebounceTimer) clearTimeout(fileDebounceTimer);
  });

  // Detect mention fragment whenever draft or caret changes.
  function refreshMentionState() {
    const el = ref;
    if (!el) {
      closeMention();
      return;
    }
    const caret = el.selectionStart ?? el.value.length;
    const text = el.value;
    const hit = detectMention(text, caret);
    if (!hit) {
      if (mentionOpen()) closeMention();
      return;
    }
    setMentionStart(hit.start);
    setMentionQuery(hit.query);
    if (!mentionOpen()) setMentionOpen(true);
  }

  function updateDraft(v: string) {
    setDraft(v);
    props.onDraftChange?.(v);
    resize();
    // Mention detection is caret-dependent; defer to next tick so
    // selectionStart reflects post-input value.
    queueMicrotask(refreshMentionState);
  }

  // --- File listing subscription ------------------------------------------
  // Listen for fs.ls replies matching the currently-listed dir and cache.
  createEffect(() => {
    const off = props.client.on((frame) => {
      if (frame.t !== "fs.ls") return;
      const cwd = props.mentionCwd;
      if (!cwd) return;
      // Strip trailing slash on cwd for stable compare.
      const cwdNorm = cwd.endsWith("/") && cwd !== "/" ? cwd.slice(0, -1) : cwd;
      const dir = fileListedDir();
      if (dir === null) return;
      const expected =
        dir === "" ? cwdNorm : cwdNorm === "/" ? `/${dir}` : `${cwdNorm}/${dir}`;
      if (frame.path !== expected) return;
      setFileResults(frame.entries);
      setFilesLoading(false);
    });
    onCleanup(off);
  });

  // When mention is open with a cwd and query changes, (debounced) fetch files.
  createEffect(() => {
    const open = mentionOpen();
    const q = mentionQuery();
    const cwd = props.mentionCwd;
    if (!open || !cwd) return;

    // Decide which subdir to list: the part of the query up to the last `/`.
    const slash = q.lastIndexOf("/");
    const subdir = slash >= 0 ? q.slice(0, slash) : "";

    // Skip fetch if we already have entries for this dir.
    if (fileListedDir() === subdir && fileResults().length > 0) return;

    if (fileDebounceTimer) clearTimeout(fileDebounceTimer);
    fileDebounceTimer = setTimeout(() => {
      const cwdNorm = cwd.endsWith("/") && cwd !== "/" ? cwd.slice(0, -1) : cwd;
      const path =
        subdir === "" ? cwdNorm : cwdNorm === "/" ? `/${subdir}` : `${cwdNorm}/${subdir}`;
      setFileListedDir(subdir);
      setFileResults([]);
      setFilesLoading(true);
      try {
        props.client.send({ v: 1, t: "fs.ls.request", path });
      } catch {
        setFilesLoading(false);
      }
    }, MENTION_DEBOUNCE_MS);
  });

  // --- Candidate assembly -------------------------------------------------
  const mentionItems = createMemo<MentionItem[]>(() => {
    if (!mentionOpen()) return [];
    const q = mentionQuery().toLowerCase();

    // Sessions: filter by id, title, or cwd.
    const sessionItems: MentionItem[] = [];
    const sessions = props.mentionSessions ?? [];
    for (const s of sessions) {
      // Don't suggest the active session.
      if (s.id === props.sid) continue;
      const title = s.title ?? s.cwd;
      const hay = `${s.id} ${title} ${s.cwd}`.toLowerCase();
      if (q !== "" && !hay.includes(q)) continue;
      sessionItems.push({
        id: `session:${s.id}`,
        kind: "session",
        label: title,
        sublabel: s.id,
        token: `@session:${s.id}`,
      });
    }

    // Files: filter entries from the listed dir by the tail portion of q.
    const fileItems: MentionItem[] = [];
    if (props.mentionCwd) {
      const slash = mentionQuery().lastIndexOf("/");
      const subdir = slash >= 0 ? mentionQuery().slice(0, slash) : "";
      const tail = (slash >= 0 ? mentionQuery().slice(slash + 1) : mentionQuery()).toLowerCase();
      for (const e of fileResults()) {
        if (tail !== "" && !e.name.toLowerCase().includes(tail)) continue;
        const rel = subdir === "" ? e.name : `${subdir}/${e.name}`;
        fileItems.push({
          id: `file:${rel}`,
          kind: e.type === "dir" ? "dir" : "file",
          label: e.name,
          sublabel: rel,
          token: `@file:${rel}`,
        });
      }
      // Dirs first, then files, each alpha.
      fileItems.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
    }

    return [...sessionItems, ...fileItems].slice(0, MENTION_MAX_RESULTS);
  });

  function insertMention(item: MentionItem) {
    const el = ref;
    if (!el) return;
    const start = mentionStart();
    if (start < 0) return;
    const caret = el.selectionStart ?? el.value.length;
    const text = el.value;
    const before = text.slice(0, start);
    const after = text.slice(caret);
    // Append a trailing space so the user can keep typing naturally.
    const insertion = `${item.token} `;
    const next = `${before}${insertion}${after}`;
    const newCaret = before.length + insertion.length;
    setDraft(next);
    props.onDraftChange?.(next);
    // Sync DOM and caret.
    queueMicrotask(() => {
      const e2 = ref;
      if (!e2) return;
      e2.value = next;
      e2.focus();
      e2.setSelectionRange(newCaret, newCaret);
      resize();
    });
    closeMention();
  }

  function submit() {
    const raw = draft();
    const text = raw.replace(/^\s+|\s+$/g, "");
    if (text.length === 0) return;
    props.onSend(text);
    setDraft("");
    props.onDraftChange?.("");
    closeMention();
    // Reset height next tick after value prop flush.
    queueMicrotask(resize);
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
  }

  function onKeyDown(e: KeyboardEvent) {
    // Cmd+Enter / Ctrl+Enter: always submit.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
      return;
    }
    // Cmd+/ (Ctrl+/ on non-Mac): toggle view mode if available.
    if (modKey(e) && e.key === "/") {
      if (props.onToggleView) {
        e.preventDefault();
        props.onToggleView();
      }
      return;
    }
    // Cmd+↑ (Ctrl+↑ on non-Mac): recall last user message when draft is empty.
    if (modKey(e) && e.key === "ArrowUp") {
      if (draft().trim() === "") {
        const recalled = props.getLastUserText?.();
        if (recalled) {
          e.preventDefault();
          updateDraft(recalled);
          queueMicrotask(() => {
            const el = ref;
            if (!el) return;
            el.focus();
            const end = el.value.length;
            el.setSelectionRange(end, end);
          });
        }
      }
      return;
    }
    // IME composition in progress — never submit.
    if (composing() || e.isComposing) return;
    // Mention popover intercepts Enter/Tab/Arrows/Esc via its own window
    // listener (capture phase). Bail early so our Enter-submit doesn't fire.
    if (mentionOpen() && mentionItems().length > 0) {
      if (
        e.key === "Enter" ||
        e.key === "Tab" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Escape"
      ) {
        return;
      }
    }
    if (e.key === "Enter") {
      const allowNewline = props.allowShiftEnterForNewline !== false;
      if (allowNewline && e.shiftKey) {
        // Default browser behavior: insert newline. Don't preventDefault.
        return;
      }
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "Escape") {
      ref?.blur();
    }
  }

  const outerCls = () =>
    [
      "relative flex items-end gap-2 px-3 py-2",
      "rounded-xl border bg-bg-surface",
      "transition-[box-shadow,border] duration-[var(--duration-fast,150ms)] ease-rcc",
      props.disabled
        ? "border-border-subtle opacity-60"
        : "border-border-subtle focus-within:border-accent " +
          "focus-within:shadow-[0_0_0_3px_rgba(218,119,86,0.15)]",
      props.remoteEditing ? "ring-2 ring-accent/20" : "",
    ].join(" ");

  const hintId = `composer-hint-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <div class="relative">
      <Show when={props.slashPaletteSlot}>
        <div class="absolute bottom-full left-0 right-0 mb-2">
          {props.slashPaletteSlot}
        </div>
      </Show>

      {/* Mention popover — anchored above the composer on desktop. */}
      <Show when={mentionOpen()}>
        <div class="absolute bottom-full left-0 right-0 mb-2 z-30">
          <MentionPopover
            items={mentionItems()}
            open={mentionOpen()}
            loading={filesLoading()}
            onPick={insertMention}
            onClose={closeMention}
            isMobile={isMobile()}
          />
        </div>
      </Show>

      <span id={hintId} class="sr-only">
        按回车发送,Shift+回车换行,Cmd+↑ 调出上一条消息,Cmd+/ 切换对话/终端视图,@ 提及会话或文件
      </span>

      <div class={outerCls()}>
        <Show when={props.attachSlot}>
          <div class="shrink-0 flex items-end pb-0.5">{props.attachSlot}</div>
        </Show>

        <textarea
          ref={(el) => {
            ref = el;
            queueMicrotask(resize);
          }}
          rows={1}
          value={draft()}
          disabled={props.disabled}
          aria-disabled={props.disabled ? "true" : "false"}
          aria-describedby={hintId}
          placeholder={props.placeholder ?? ""}
          aria-label="输入消息"
          class={
            "flex-1 min-w-0 resize-none bg-transparent outline-none " +
            "font-serif text-[15px] leading-[1.55] text-text-primary " +
            "placeholder:text-text-muted " +
            "disabled:cursor-not-allowed " +
            "max-h-[192px] py-1"
          }
          style={{ height: `${MIN_HEIGHT_PX}px` }}
          onInput={(e) => updateDraft(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          onKeyUp={refreshMentionState}
          onClick={refreshMentionState}
          onSelect={refreshMentionState}
          onBlur={() => {
            // Close mention popover on blur, but give click handlers a
            // chance to fire first.
            setTimeout(() => {
              if (document.activeElement !== ref) closeMention();
            }, 120);
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(e) => {
            setComposing(false);
            // Ensure draft reflects the final composed value.
            updateDraft((e.currentTarget as HTMLTextAreaElement).value);
          }}
          onFocus={() => props.onFocus?.()}
        />

        <Show when={props.voiceSlot}>
          <div class="shrink-0 flex items-end pb-0.5">{props.voiceSlot}</div>
        </Show>

        <IconButton
          size="md"
          aria-label="发送消息"
          onClick={submit}
          disabled={props.disabled || draft().trim().length === 0}
          aria-disabled={
            props.disabled || draft().trim().length === 0 ? "true" : "false"
          }
          class={[
            "shrink-0 rounded-full h-11 w-11 sm:h-9 sm:w-9",
            "bg-accent text-bg-page hover:bg-accent-hover",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "disabled:hover:bg-accent",
            flash() ? "animate-pulse" : "",
          ].join(" ")}
        >
          <span aria-hidden="true" class="text-[15px] leading-none">
            {"➤"}
          </span>
        </IconButton>
      </div>
    </div>
  );
}

export default Composer;
