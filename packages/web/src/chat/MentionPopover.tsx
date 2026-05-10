import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { t, tt } from "../i18n/index.ts";

/**
 * MentionPopover — @-mention autocomplete rendered above the Composer.
 *
 * Detection + query management lives in the parent (Composer). This component
 * renders a listbox of `MentionItem`s, auto-selects the first row, supports
 * ↑/↓ navigation and Enter/Tab to insert, Esc to cancel.
 *
 * Desktop: plain anchored card (parent wraps in a relative/absolute slot).
 * Mobile (<640px): promoted to a full-width sheet above the composer.
 *
 * Items carry an opaque `token` — the literal text the Composer will splice
 * into the draft at the `@...` fragment. Sessions use `@session:<sid>` and
 * files use `@file:<path>` — pure client-side text, no protocol change.
 */

export type MentionKind = "session" | "file" | "dir";

export interface MentionItem {
  id: string;
  kind: MentionKind;
  /** Primary label — first line, bold. */
  label: string;
  /** Optional secondary label — second line, muted (e.g. cwd or path). */
  sublabel?: string;
  /** Literal text inserted at the `@…` fragment when this item is picked. */
  token: string;
}

export interface MentionPopoverProps {
  items: MentionItem[];
  open: boolean;
  /** When true, show a spinner row (e.g. while debounced fs.ls is in-flight). */
  loading?: boolean;
  /** Called when the user confirms a pick (Enter/Tab/click). */
  onPick: (item: MentionItem) => void;
  /** Called when the user dismisses (Esc / outside click). */
  onClose: () => void;
  isMobile: boolean;
}

const KIND_ICON: Record<MentionKind, string> = {
  session: "◉",
  file: "📄",
  dir: "📁",
};

const kindLabel = (k: MentionKind): string => {
  if (k === "session") return t("mention.session");
  if (k === "file") return t("mention.file");
  return t("mention.dir");
};

export function MentionPopover(props: MentionPopoverProps): JSX.Element {
  const [selected, setSelected] = createSignal(0);

  // Reset selection on items change.
  createEffect(() => {
    props.items.length;
    props.open;
    setSelected(0);
  });

  // Clamp selection if item list shrinks.
  createEffect(() => {
    const len = props.items.length;
    if (len === 0) {
      setSelected(0);
      return;
    }
    if (selected() >= len) setSelected(len - 1);
  });

  // Window-level keyboard nav while open. Capture phase so we preempt the
  // Composer's own Enter-submit handler.
  createEffect(() => {
    if (!props.open) return;
    if (typeof window === "undefined") return;

    const handler = (e: KeyboardEvent) => {
      const list = props.items;
      if (e.key === "ArrowDown" && list.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        setSelected((i) => Math.min(list.length - 1, i + 1));
      } else if (e.key === "ArrowUp" && list.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        setSelected((i) => Math.max(0, i - 1));
      } else if ((e.key === "Enter" || e.key === "Tab") && list.length > 0) {
        const item = list[selected()];
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        props.onPick(item);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        props.onClose();
      }
    };

    window.addEventListener("keydown", handler, true);
    onCleanup(() => {
      window.removeEventListener("keydown", handler, true);
    });
  });

  const rowClass = (active: boolean) =>
    [
      "flex items-center gap-3 px-3 py-2 cursor-pointer",
      "min-h-[44px] sm:min-h-[36px]",
      active ? "bg-accent-bg" : "hover:bg-bg-surfaceStrong",
    ].join(" ");

  const header = () => (
    <div class="sticky top-0 z-10 bg-bg-surface px-3 py-2 border-b border-border-subtle flex items-center gap-2 text-[11px] text-text-muted">
      <span>{tt("mention.header", { n: props.items.length })}</span>
      <Show when={props.loading}>
        <span class="text-accent">{t("mention.loading")}</span>
      </Show>
      <span class="ml-auto font-mono text-[10px]">
        {t("mention.keyHint")}
      </span>
    </div>
  );

  const listBody = () => (
    <div class="overflow-y-auto flex-1 py-1">
      <Show
        when={props.items.length > 0}
        fallback={
          <div class="px-3 py-6 text-center text-xs text-text-muted">
            <Show when={props.loading} fallback={<span>{t("mention.noMatch")}</span>}>
              <span>{t("mention.searching")}</span>
            </Show>
          </div>
        }
      >
        <For each={props.items}>
          {(item, i) => (
            <div
              role="option"
              aria-selected={i() === selected()}
              class={rowClass(i() === selected())}
              onPointerEnter={() => setSelected(i())}
              onPointerDown={(e) => {
                // Keep composer focused; pick on click fires next.
                e.preventDefault();
              }}
              onClick={() => props.onPick(item)}
            >
              <span
                class="shrink-0 w-5 text-center text-[13px]"
                aria-hidden="true"
              >
                {KIND_ICON[item.kind]}
              </span>
              <div class="flex-1 min-w-0">
                <div class="text-[13px] text-text-primary truncate">
                  {item.label}
                </div>
                <Show when={item.sublabel}>
                  <div class="text-[11px] text-text-muted truncate font-mono">
                    {item.sublabel}
                  </div>
                </Show>
              </div>
              <span class="text-[10px] text-text-muted shrink-0">
                {kindLabel(item.kind)}
              </span>
            </div>
          )}
        </For>
      </Show>
    </div>
  );

  const desktopPanel = () => (
    <div
      role="listbox"
      aria-label={t("mention.candidatesAria")}
      class="rounded-md border border-border-subtle bg-bg-surface shadow-lg overflow-hidden max-h-[240px] flex flex-col"
    >
      {header()}
      {listBody()}
    </div>
  );

  const mobileSheet = () => (
    <>
      <div
        class="fixed inset-0 z-40 bg-black/40"
        onClick={() => props.onClose()}
        aria-hidden="true"
      />
      <div
        role="listbox"
        aria-label={t("mention.candidatesAria")}
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
      <Show when={props.isMobile} fallback={desktopPanel()}>
        <Portal>{mobileSheet()}</Portal>
      </Show>
    </Show>
  );
}

export default MentionPopover;
