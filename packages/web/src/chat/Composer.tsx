import {
  Show,
  createSignal,
  onMount,
  type JSX,
} from "solid-js";
import type { RccClient } from "../client";
import { IconButton } from "../primitives/IconButton";

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
}

const MAX_HEIGHT_PX = 192; // 8 rows × 24px line-height
const MIN_HEIGHT_PX = 40; // single-line resting height

export function Composer(props: ComposerProps): JSX.Element {
  const [draft, setDraft] = createSignal(props.initialDraft ?? "");
  const [composing, setComposing] = createSignal(false);
  const [flash, setFlash] = createSignal(false);
  let ref: HTMLTextAreaElement | undefined;

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

  function updateDraft(v: string) {
    setDraft(v);
    props.onDraftChange?.(v);
    resize();
  }

  function submit() {
    const raw = draft();
    const text = raw.replace(/^\s+|\s+$/g, "");
    if (text.length === 0) return;
    props.onSend(text);
    setDraft("");
    props.onDraftChange?.("");
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
    // IME composition in progress — never submit.
    if (composing() || e.isComposing) return;
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
    ].join(" ");

  return (
    <div class={props.slashPaletteSlot ? "relative" : undefined}>
      <Show when={props.slashPaletteSlot}>
        <div class="absolute bottom-full left-0 right-0 mb-2">
          {props.slashPaletteSlot}
        </div>
      </Show>

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
          placeholder={props.placeholder ?? ""}
          aria-label="Message"
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
          aria-label="Send message"
          onClick={submit}
          disabled={props.disabled || draft().trim().length === 0}
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
