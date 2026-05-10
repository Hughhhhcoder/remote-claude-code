import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { t, tt } from "../i18n/index.ts";

/**
 * SlashPalette — slash-command picker rendered above the Composer.
 *
 * Detection lives in the parent (Composer). Palette renders when `open === true`
 * and filters commands based on `draft.slice(1).toLowerCase()`. Desktop shows a
 * popover-style card (positioned by parent wrapper); mobile promotes to a
 * bottom sheet with backdrop.
 *
 * Keyboard (window-level while open):
 *   ↑ / ↓  move selection
 *   Enter  pick → onPick(name) + onOpenChange(false)
 *   Esc    close
 *   Tab    close (so user can keep typing normally)
 */

export interface SlashCommand {
  id: string;
  name: string;
  description?: string;
  category?: string;
  icon?: string;
}

export interface SlashPaletteProps {
  commands: SlashCommand[];
  draft: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (name: string) => void;
  isMobile: boolean;
}

const MAX_RESULTS = 20;

export function SlashPalette(props: SlashPaletteProps): JSX.Element {
  const [selected, setSelected] = createSignal(0);

  const query = createMemo(() => {
    const d = props.draft;
    if (!d.startsWith("/")) return "";
    return d.slice(1).toLowerCase();
  });

  const allFiltered = createMemo<SlashCommand[]>(() => {
    const q = query();
    if (q === "") return [...props.commands];
    const prefix: SlashCommand[] = [];
    const substr: SlashCommand[] = [];
    for (const c of props.commands) {
      const n = c.name.toLowerCase();
      if (n.startsWith(q)) prefix.push(c);
      else if (n.includes(q)) substr.push(c);
    }
    const cmp = (a: SlashCommand, b: SlashCommand) =>
      (a.category ?? "").localeCompare(b.category ?? "");
    prefix.sort(cmp);
    substr.sort(cmp);
    return [...prefix, ...substr];
  });

  const filtered = createMemo(() => allFiltered().slice(0, MAX_RESULTS));
  const overflow = createMemo(() =>
    Math.max(0, allFiltered().length - MAX_RESULTS),
  );

  // Reset selection when filter changes or palette opens.
  createEffect(() => {
    query();
    props.open;
    setSelected(0);
  });

  // Clamp selection if filtered list shrinks.
  createEffect(() => {
    const len = filtered().length;
    if (len === 0) {
      setSelected(0);
      return;
    }
    if (selected() >= len) setSelected(len - 1);
  });

  // Window-level keyboard nav while open.
  createEffect(() => {
    if (!props.open) return;
    if (typeof window === "undefined") return;

    const handler = (e: KeyboardEvent) => {
      const list = filtered();
      if (e.key === "ArrowDown" && list.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        setSelected((i) => Math.min(list.length - 1, i + 1));
      } else if (e.key === "ArrowUp" && list.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        setSelected((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter" && list.length > 0) {
        const cmd = list[selected()];
        if (!cmd) return;
        e.preventDefault();
        e.stopPropagation();
        props.onPick(cmd.name);
        props.onOpenChange(false);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        props.onOpenChange(false);
      } else if (e.key === "Tab") {
        // Don't preventDefault — let focus move; just close the palette.
        props.onOpenChange(false);
      }
    };

    window.addEventListener("keydown", handler, true);
    onCleanup(() => {
      window.removeEventListener("keydown", handler, true);
    });
  });

  const onPickRow = (cmd: SlashCommand) => {
    props.onPick(cmd.name);
    props.onOpenChange(false);
  };

  const rowClass = (active: boolean) =>
    [
      "flex items-center gap-3 px-3 py-2 cursor-pointer",
      "min-h-[44px] sm:min-h-[36px]",
      active ? "bg-accent-bg" : "hover:bg-bg-surfaceStrong",
    ].join(" ");

  const header = () => (
    <div class="sticky top-0 z-10 bg-bg-surface px-3 py-2 border-b border-border-subtle flex items-center gap-2 text-[11px] text-text-muted">
      <span>{tt("slash.header", { n: allFiltered().length })}</span>
      <span class="ml-auto font-mono text-[10px]">
        {t("slash.keyHint")}
      </span>
    </div>
  );

  const listBody = () => (
    <div class="overflow-y-auto flex-1 py-1">
      <Show
        when={props.commands.length > 0}
        fallback={
          <div class="px-3 py-6 text-center text-xs text-text-muted">
            {t("slash.noAvailable")}
          </div>
        }
      >
        <Show
          when={filtered().length > 0}
          fallback={
            <div class="px-3 py-6 text-center text-xs text-text-muted">
              {t("slash.noMatch")}
            </div>
          }
        >
          <For each={filtered()}>
            {(cmd, i) => (
              <div
                role="option"
                aria-selected={i() === selected()}
                class={rowClass(i() === selected())}
                onPointerEnter={() => setSelected(i())}
                onPointerDown={(e) => {
                  // Prevent focus loss from the composer textarea.
                  e.preventDefault();
                }}
                onClick={() => onPickRow(cmd)}
              >
                <span
                  class="shrink-0 w-5 text-center text-[13px]"
                  aria-hidden="true"
                >
                  {cmd.icon ?? "•"}
                </span>
                <span class="font-mono text-[13px] text-accent shrink-0">
                  /{cmd.name}
                </span>
                <Show
                  when={cmd.description}
                  fallback={<span class="flex-1" />}
                >
                  <span class="text-[12px] text-text-secondary truncate flex-1">
                    {cmd.description}
                  </span>
                </Show>
                <Show when={cmd.category}>
                  <span class="text-[10px] text-text-muted shrink-0">
                    {cmd.category}
                  </span>
                </Show>
              </div>
            )}
          </For>
          <Show when={overflow() > 0}>
            <div class="px-3 py-2 text-center text-[11px] text-text-muted border-t border-border-subtle">
              {tt("slash.overflow", { n: overflow() })}
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );

  const desktopPanel = () => (
    <div
      role="listbox"
      class="rounded-md border border-border-subtle bg-bg-surface shadow-lg overflow-hidden max-h-[320px] flex flex-col"
    >
      {header()}
      {listBody()}
    </div>
  );

  const mobileSheet = () => (
    <>
      <div
        class="fixed inset-0 z-40 bg-black/40"
        onClick={() => props.onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        role="listbox"
        class="fixed inset-x-0 bottom-0 z-50 rounded-t-xl bg-bg-surface shadow-[0_-4px_24px_rgba(0,0,0,0.15)] max-h-[70vh] flex flex-col"
        style={{ "padding-bottom": "env(safe-area-inset-bottom)" }}
      >
        <div
          class="w-12 h-1 bg-border-strong rounded-full mx-auto my-3 shrink-0"
          aria-hidden="true"
        />
        {header()}
        {listBody()}
      </div>
    </>
  );

  return (
    <Show when={props.open}>
      <Portal>
        <Show when={props.isMobile} fallback={desktopPanel()}>
          {mobileSheet()}
        </Show>
      </Portal>
    </Show>
  );
}

export default SlashPalette;
