import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import type { ChatMessage, NotebookCell } from "@rcc/protocol";
import type { RccClient } from "../client.ts";
import { Button } from "../primitives/Button.tsx";
import { IconButton } from "../primitives/IconButton.tsx";
import { Textarea } from "../primitives/Textarea.tsx";
import { EmptyState } from "../primitives/EmptyState.tsx";
import { NotebookEntry } from "./NotebookEntry.tsx";

/**
 * NotebookPane — responsive pane for the per-session notebook (P5-E).
 *
 * Wire frames (packages/protocol/src/index.ts ~2059-2103):
 *   out: notebook.request, notebook.upsert, notebook.delete, chat.list.request
 *   in : notebook, notebook.upserted, notebook.deleted,
 *        chat.list, chat.append
 *
 * The protocol has no per-cell update/remove frames — every mutation is a
 * bulk replace via `notebook.upsert`. chat.list is pulled so chatRef cells
 * can resolve to a ChatMessage excerpt.
 */

export interface NotebookPaneProps {
  client: RccClient;
  sid: string;
  onClose?: () => void;
  onJumpToMessage?: (sid: string, messageId: string) => void;
}

function newCellId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
const shortSid = (sid: string): string => (sid.length > 8 ? sid.slice(0, 8) : sid);

const CLOSE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M18 6L6 18" /><path d="M6 6l12 12" />
  </svg>
);

export function NotebookPane(props: NotebookPaneProps): JSX.Element {
  const [cells, setCells] = createSignal<NotebookCell[]>([]);
  const [updatedAt, setUpdatedAt] = createSignal<number | null>(null);
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [adding, setAdding] = createSignal(false);
  const [draft, setDraft] = createSignal("");

  createEffect(() => {
    const sid = props.sid;
    setCells([]); setMessages([]); setUpdatedAt(null);
    setAdding(false); setDraft("");
    props.client.send({ v: 1, t: "notebook.request", sid });
    props.client.send({ v: 1, t: "chat.list.request", sid });
  });

  const unsub = props.client.on((frame) => {
    if (frame.t === "notebook" && frame.sid === props.sid) {
      setCells(frame.notebook ? [...frame.notebook.cells] : []);
      setUpdatedAt(frame.notebook ? frame.notebook.updatedAt : null);
    } else if (frame.t === "notebook.upserted" && frame.sid === props.sid) {
      setCells([...frame.notebook.cells]);
      setUpdatedAt(frame.notebook.updatedAt);
    } else if (frame.t === "notebook.deleted" && frame.sid === props.sid) {
      setCells([]); setUpdatedAt(null);
    } else if (frame.t === "chat.list" && frame.sid === props.sid) {
      setMessages(frame.messages);
    } else if (frame.t === "chat.append" && frame.sid === props.sid) {
      setMessages((ms) => {
        const i = ms.findIndex((m) => m.id === frame.message.id);
        if (i >= 0) { const n = [...ms]; n[i] = frame.message; return n; }
        return [...ms, frame.message];
      });
    }
  });
  onCleanup(() => unsub());

  function persist(next: NotebookCell[]) {
    setCells(next);
    props.client.send({ v: 1, t: "notebook.upsert", sid: props.sid, cells: next });
  }
  function addNote(content: string) {
    const trimmed = content.trimEnd();
    if (trimmed.length === 0) { setAdding(false); setDraft(""); return; }
    persist([...cells(), { kind: "note", id: newCellId(), content: trimmed }]);
    setAdding(false); setDraft("");
  }
  const deleteCell = (cellId: string) => persist(cells().filter((c) => c.id !== cellId));
  const updateNote = (cellId: string, content: string) =>
    persist(cells().map((c) => c.kind === "note" && c.id === cellId ? { ...c, content } : c));
  function clearAll() {
    if (cells().length === 0) return;
    if (!confirm("清空整个笔记本?此操作不可撤销。")) return;
    props.client.send({ v: 1, t: "notebook.delete", sid: props.sid });
    setCells([]); setUpdatedAt(null);
  }

  const messageIndex = createMemo(() => {
    const m = new Map<string, ChatMessage>();
    for (const msg of messages()) m.set(msg.id, msg);
    return m;
  });
  const resolveMessage = (sid: string, messageId: string): ChatMessage | undefined =>
    sid === props.sid ? messageIndex().get(messageId) : undefined;

  const lastUpdatedLabel = () => {
    const ts = updatedAt();
    return ts ? new Date(ts).toLocaleString() : null;
  };

  const onAddKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); setAdding(false); setDraft(""); }
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote(draft()); }
  };

  return (
    <div class="flex flex-col h-full bg-bg-page">
      <header class="sticky top-0 z-20 bg-bg-page border-b border-border-subtle">
        <div class="flex items-center gap-2 px-4 pt-3 pb-2 min-w-0">
          <h2 class="font-serif text-[15px] text-text-primary m-0 truncate">笔记本</h2>
          <span class="font-mono text-[11px] text-text-muted">· {shortSid(props.sid)}</span>
          <div class="flex-1" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { setAdding(true); setDraft(""); }}
            disabled={adding()}
          >
            + 新增笔记
          </Button>
          <Show when={cells().length > 0}>
            <Button variant="ghost" size="sm" onClick={clearAll}>清空</Button>
          </Show>
          <Show when={props.onClose}>
            <IconButton aria-label="关闭" size="sm" onClick={props.onClose}>{CLOSE_ICON}</IconButton>
          </Show>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto overflow-x-hidden px-4">
        <Show when={adding()}>
          <div class="rounded-md border border-border-subtle bg-bg-surface px-4 py-3 my-3 flex flex-col gap-2">
            <Textarea
              value={draft()}
              onInput={setDraft}
              rows={3}
              maxRows={12}
              placeholder="新增一条 markdown 笔记。Ctrl/⌘+Enter 保存,Esc 取消。"
              onKeyDown={onAddKey}
            />
            <div class="flex items-center gap-2 justify-end">
              <Button variant="ghost" size="sm"
                onClick={() => { setAdding(false); setDraft(""); }}>
                取消
              </Button>
              <Button variant="primary" size="sm"
                onClick={() => addNote(draft())}
                disabled={draft().trim().length === 0}>
                保存
              </Button>
            </div>
          </div>
        </Show>

        <Show
          when={cells().length > 0}
          fallback={
            <Show when={!adding()}>
              <EmptyState
                icon="📓"
                title="笔记本为空"
                description="在对话中钉消息,或点击右上角新增 markdown。"
              />
            </Show>
          }
        >
          <For each={cells()}>
            {(cell) => (
              <NotebookEntry
                cell={cell}
                sid={props.sid}
                resolveMessage={resolveMessage}
                onDelete={deleteCell}
                onUpdate={updateNote}
                onJumpToMessage={props.onJumpToMessage}
              />
            )}
          </For>
        </Show>
      </div>

      <Show when={cells().length > 0}>
        <footer class="shrink-0 border-t border-border-subtle px-4 py-2 bg-bg-page">
          <div class="flex items-center gap-2 font-sans text-[11px] text-text-muted">
            <span>{cells().length} 条记录</span>
            <Show when={lastUpdatedLabel()}>
              <span>·</span>
              <span>最后更新 {lastUpdatedLabel()}</span>
            </Show>
          </div>
        </footer>
      </Show>
    </div>
  );
}

export default NotebookPane;
