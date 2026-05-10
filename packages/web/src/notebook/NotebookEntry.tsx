import { createSignal, Show, type JSX } from "solid-js";
import type { ChatMessage, NotebookCell } from "@rcc/protocol";
import { IconButton } from "../primitives/IconButton.tsx";
import { Chip } from "../primitives/Chip.tsx";
import { Textarea } from "../primitives/Textarea.tsx";
import { Button } from "../primitives/Button.tsx";
import { TextBlock } from "../chat/blocks/TextBlock.tsx";

/**
 * NotebookEntry — renders one notebook cell as a card.
 *
 * Cell kinds (discriminator from packages/protocol/src/index.ts ~2036):
 *   - `note`    user-authored markdown, click-to-edit → textarea
 *   - `chatRef` pointer to a ChatMessage; shows excerpt if resolver is
 *               provided, otherwise just the id chip.
 *
 * Task brief used "markdown" but the wire discriminator is "note"; we
 * follow the wire so zod validation passes.
 *
 * Presentational only — persistence is delegated via onUpdate / onDelete,
 * which the parent pane turns into `notebook.upsert`.
 */

export interface NotebookEntryProps {
  cell: NotebookCell;
  onDelete?: (cellId: string) => void;
  onUpdate?: (cellId: string, nextContent: string) => void;
  onJumpToMessage?: (sid: string, messageId: string) => void;
  sid: string;
  resolveMessage?: (sid: string, messageId: string) => ChatMessage | undefined;
}

const shortId = (id: string): string => (id.length > 8 ? id.slice(0, 8) : id);
const roleLabel = (r: ChatMessage["role"]): string =>
  r === "user" ? "用户" : r === "assistant" ? "助手" : "系统";

function excerptOf(msg: ChatMessage, max = 240): string {
  const parts: string[] = [];
  for (const seg of msg.segments) {
    if (seg.kind === "text" || seg.kind === "thinking") parts.push(seg.content);
    else if (seg.kind === "code" || seg.kind === "diff") parts.push(seg.content);
    else if (seg.kind === "tool_use") parts.push(`⚙ ${seg.tool} ${seg.input}`);
    else if (seg.kind === "tool_result") parts.push(seg.content);
    if (parts.join(" ").length > max) break;
  }
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  return joined.length > max ? joined.slice(0, max - 1) + "…" : joined;
}

const TRASH_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
);

export function NotebookEntry(props: NotebookEntryProps): JSX.Element {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");

  const isNote = () => props.cell.kind === "note";
  const noteCell = () => props.cell as Extract<NotebookCell, { kind: "note" }>;
  const refCell = () => props.cell as Extract<NotebookCell, { kind: "chatRef" }>;
  const refMsg = () =>
    props.resolveMessage?.(props.sid, refCell().messageId);

  const beginEdit = () => {
    if (!isNote()) return;
    setDraft(noteCell().content);
    setEditing(true);
  };
  const commitEdit = () => {
    if (!isNote()) return setEditing(false);
    const next = draft();
    if (next !== noteCell().content) props.onUpdate?.(noteCell().id, next);
    setEditing(false);
  };
  const cancelEdit = () => { setDraft(""); setEditing(false); };

  const noteEmpty = () => isNote() && noteCell().content.trim().length === 0;
  const onEditKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault(); commitEdit();
    }
  };

  return (
    <article class="group relative rounded-md border border-border-subtle bg-bg-surface px-4 py-3 my-3 transition duration-fast ease-rcc hover:border-border-strong">
      <header class="flex items-center gap-2 mb-2">
        <Show when={isNote()} fallback={<Chip size="xs" tone="info">引用消息</Chip>}>
          <Chip size="xs" tone="neutral">笔记</Chip>
        </Show>
        <span class="font-mono text-[11px] text-text-muted">{shortId(props.cell.id)}</span>
        <div class="flex-1" />
        <IconButton
          aria-label="删除"
          size="sm"
          tone="danger"
          class="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => props.onDelete?.(props.cell.id)}
        >{TRASH_ICON}</IconButton>
      </header>

      <Show when={isNote()}>
        <Show
          when={editing()}
          fallback={
            <div
              class={`font-serif text-[15px] text-text-primary leading-relaxed cursor-text select-text ${noteEmpty() ? "text-text-muted italic" : ""}`}
              onClick={beginEdit}
            >
              <Show when={!noteEmpty()} fallback={<span>点击以添加 markdown…</span>}>
                <TextBlock content={noteCell().content} />
              </Show>
            </div>
          }
        >
          <div class="flex flex-col gap-2">
            <Textarea
              value={draft()}
              onInput={setDraft}
              rows={3}
              maxRows={12}
              placeholder="在此书写 markdown。Ctrl/⌘+Enter 保存,Esc 取消。"
              onKeyDown={onEditKey}
            />
            <div class="flex items-center gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={cancelEdit}>取消</Button>
              <Button variant="primary" size="sm" onClick={commitEdit}>保存</Button>
            </div>
          </div>
        </Show>
      </Show>

      <Show when={!isNote()}>
        <div class="flex flex-col gap-2">
          <Show
            when={refMsg()}
            fallback={
              <p class="font-sans text-[13px] text-text-muted italic m-0">
                引用消息不在当前加载范围内 · id {shortId(refCell().messageId)}…
              </p>
            }
          >
            {(m) => (
              <>
                <div class="flex items-center gap-2 font-sans text-[11px] text-text-muted">
                  <span>{roleLabel(m().role)}</span>
                  <span>·</span>
                  <span>{new Date(m().timestamp).toLocaleString()}</span>
                </div>
                <blockquote class="font-serif text-[14px] text-text-secondary leading-relaxed border-l-2 border-border-subtle pl-3 m-0">
                  {excerptOf(m())}
                </blockquote>
              </>
            )}
          </Show>
          <div class="flex items-center gap-2 justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => props.onJumpToMessage?.(props.sid, refCell().messageId)}
            >跳转到对话</Button>
          </div>
        </div>
      </Show>
    </article>
  );
}

export default NotebookEntry;
