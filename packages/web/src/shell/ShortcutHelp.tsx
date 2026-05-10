import { createMemo, For, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { useShortcuts, type Shortcut, type ShortcutCategory } from "../hooks/useKeyboardShortcuts.ts";
import { useIsMobile } from "../useIsMobile.ts";

/**
 * ShortcutHelp — overlay showing every registered keyboard shortcut (B17-A).
 *
 * Dialog-style overlay, Portal-mounted. Reuses semantic tokens and respects
 * `prefers-reduced-motion` via `motion-safe:` utilities. The parent owns
 * `open` / `onClose`; the `?` binding lives in App.tsx.
 *
 * Mobile: full-width bottom sheet.
 * Desktop: centered modal (~640px).
 */

export interface ShortcutHelpProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_LABEL: Record<ShortcutCategory, string> = {
  nav: "导航",
  session: "会话",
  chat: "对话",
  app: "应用",
};

const CATEGORY_ORDER: ShortcutCategory[] = ["nav", "session", "chat", "app"];

function keyDisplay(k: string): string {
  if (k === " ") return "Space";
  if (k === "Escape") return "Esc";
  if (k === "ArrowUp") return "↑";
  if (k === "ArrowDown") return "↓";
  if (k === "ArrowLeft") return "←";
  if (k === "ArrowRight") return "→";
  return k;
}

function Kbd(props: { children: JSX.Element }): JSX.Element {
  return (
    <kbd class="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded border border-border-subtle bg-bg-surface text-[11px] font-mono text-text-primary shadow-sm">
      {props.children}
    </kbd>
  );
}

function ShortcutRow(props: { shortcut: Shortcut }): JSX.Element {
  return (
    <div class="flex items-center justify-between gap-4 px-4 h-10 hover:bg-bg-surfaceStrong/50 transition-colors">
      <span class="text-sm text-text-primary font-sans truncate">
        {props.shortcut.label}
      </span>
      <div class="flex items-center gap-1 shrink-0">
        <For each={props.shortcut.keys}>
          {(k, i) => (
            <>
              <Show when={i() > 0}>
                <span class="text-[10px] text-text-muted mx-0.5">then</span>
              </Show>
              <Kbd>{keyDisplay(k)}</Kbd>
            </>
          )}
        </For>
      </div>
    </div>
  );
}

export function ShortcutHelp(props: ShortcutHelpProps): JSX.Element {
  const { shortcuts } = useShortcuts();
  const isMobile = useIsMobile();

  const grouped = createMemo(() => {
    const m = new Map<ShortcutCategory, Shortcut[]>();
    for (const cat of CATEGORY_ORDER) m.set(cat, []);
    for (const s of shortcuts()) {
      const arr = m.get(s.category);
      if (arr) arr.push(s);
    }
    return m;
  });

  const panelClass = (): string =>
    isMobile()
      ? "fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-bg-surface border-t border-border-subtle shadow-[0_-4px_32px_rgba(0,0,0,0.25)] flex flex-col max-h-[80vh] animate-slide-up"
      : "fixed z-50 left-1/2 -translate-x-1/2 top-[12vh] w-[640px] max-w-[calc(100vw-32px)] bg-bg-surface border border-border-subtle rounded-lg shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)] flex flex-col overflow-hidden animate-fade-in";

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm animate-fade-in"
          onClick={() => props.onClose()}
          aria-hidden="true"
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="键盘快捷键"
          class={panelClass()}
          style={isMobile() ? { "padding-bottom": "env(safe-area-inset-bottom)" } : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          <Show when={isMobile()}>
            <div
              class="w-12 h-1 bg-border-strong rounded-full mx-auto my-3 shrink-0"
              aria-hidden="true"
            />
          </Show>

          <div class="flex items-center justify-between gap-3 px-5 py-4 border-b border-border-subtle shrink-0">
            <h2 class="font-serif text-lg font-medium text-text-primary m-0">
              键盘快捷键
            </h2>
            <button
              type="button"
              class="text-text-muted hover:text-text-primary text-sm px-2 py-1 rounded"
              aria-label="关闭"
              onClick={() => props.onClose()}
            >
              ✕
            </button>
          </div>

          <div class="overflow-y-auto scrollbar flex-1">
            <For each={CATEGORY_ORDER}>
              {(cat) => (
                <Show when={(grouped().get(cat) ?? []).length > 0}>
                  <div class="py-1">
                    <div class="sticky top-0 z-10 px-4 pt-2 pb-1 text-[10px] uppercase tracking-widest text-text-muted font-sans bg-bg-surface">
                      {CATEGORY_LABEL[cat]}
                    </div>
                    <For each={grouped().get(cat)!}>
                      {(s) => <ShortcutRow shortcut={s} />}
                    </For>
                  </div>
                </Show>
              )}
            </For>
            <Show when={shortcuts().length === 0}>
              <div class="p-6 text-center text-xs text-text-muted">
                暂无已注册的快捷键
              </div>
            </Show>
          </div>

          <div class="px-4 py-2 border-t border-border-subtle flex items-center gap-3 font-mono text-[11px] text-text-muted shrink-0">
            <span>按 Esc 关闭</span>
            <span class="ml-auto">按 ? 再按一次关闭</span>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

export default ShortcutHelp;
