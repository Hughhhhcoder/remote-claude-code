import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import type { RccClient } from "./client.ts";
import type { ChatMessage, Notebook, NotebookCell } from "@rcc/protocol";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function NotebookView(props: { client: RccClient; sid: string }) {
  const [cells, setCells] = createSignal<NotebookCell[]>([]);
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [previewingId, setPreviewingId] = createSignal<string | null>(null);

  createEffect(() => {
    const sid = props.sid;
    setCells([]);
    props.client.send({ v: 1, t: "notebook.request", sid });
    props.client.send({ v: 1, t: "chat.list.request", sid });
  });

  const unsub = props.client.on((frame) => {
    if (frame.t === "notebook" && frame.sid === props.sid) {
      setCells(frame.notebook ? [...frame.notebook.cells] : []);
    }
    if (frame.t === "notebook.upserted" && frame.sid === props.sid) {
      setCells([...frame.notebook.cells]);
    }
    if (frame.t === "chat.list" && frame.sid === props.sid) {
      setMessages(frame.messages);
    }
    if (frame.t === "chat.append" && frame.sid === props.sid) {
      setMessages((ms) => {
        const idx = ms.findIndex((m) => m.id === frame.message.id);
        if (idx >= 0) {
          const next = [...ms];
          next[idx] = frame.message;
          return next;
        }
        return [...ms, frame.message];
      });
    }
  });
  onCleanup(() => unsub());

  function persist(next: NotebookCell[]) {
    setCells(next);
    props.client.send({ v: 1, t: "notebook.upsert", sid: props.sid, cells: next });
  }

  function addNote() {
    const next: NotebookCell[] = [
      ...cells(),
      { kind: "note", id: newId(), content: "" },
    ];
    persist(next);
  }

  function updateNote(id: string, content: string) {
    const next = cells().map((c) =>
      c.kind === "note" && c.id === id ? { ...c, content } : c,
    );
    persist(next);
  }

  function removeCell(id: string) {
    persist(cells().filter((c) => c.id !== id));
  }

  function moveCell(id: string, dir: -1 | 1) {
    const arr = cells();
    const idx = arr.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    const next = [...arr];
    const tmp = next[idx]!;
    next[idx] = next[target]!;
    next[target] = tmp;
    persist(next);
  }

  function clearAll() {
    if (!confirm("清空整个笔记本?不可撤销。")) return;
    props.client.send({ v: 1, t: "notebook.delete", sid: props.sid });
    setCells([]);
  }

  function exportMd() {
    const parts: string[] = [];
    parts.push(`# 笔记 · ${props.sid}\n`);
    for (const cell of cells()) {
      if (cell.kind === "note") {
        parts.push(cell.content.trim());
      } else {
        const msg = messages().find((m) => m.id === cell.messageId);
        if (!msg) {
          parts.push(`> (消息丢失: ${cell.messageId})`);
          continue;
        }
        parts.push(`> **${roleLabel(msg.role)}** · ${new Date(msg.timestamp).toLocaleString()}`);
        for (const seg of msg.segments) {
          if (seg.kind === "text" || seg.kind === "thinking") {
            parts.push(seg.content.split("\n").map((l) => `> ${l}`).join("\n"));
          } else if (seg.kind === "code") {
            parts.push("```" + (seg.lang ?? ""));
            parts.push(seg.content);
            parts.push("```");
          } else if (seg.kind === "diff") {
            parts.push("```diff");
            parts.push(seg.content);
            parts.push("```");
          } else if (seg.kind === "tool_use") {
            parts.push(`> \`⚙ ${seg.tool}\` ${seg.input.slice(0, 120)}`);
          } else if (seg.kind === "tool_result") {
            parts.push(`> ${seg.isError ? "✗" : "✓"} ${seg.content.slice(0, 240)}`);
          }
        }
      }
      parts.push("");
    }
    const blob = new Blob([parts.join("\n")], { type: "text/markdown" });
    triggerDownload(blob, `notebook-${props.sid}.md`);
  }

  function exportJson() {
    const payload: Notebook = {
      sid: props.sid,
      cells: cells(),
      updatedAt: Date.now(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    triggerDownload(blob, `notebook-${props.sid}.json`);
  }

  return (
    <div class="flex flex-col h-full bg-zinc-950">
      <div class="p-3 border-b border-zinc-900 flex items-center gap-2 shrink-0">
        <div class="text-xs font-medium text-zinc-300">📓 笔记</div>
        <div class="flex-1" />
        <button
          class="text-[11px] px-2 py-1 rounded border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700"
          onClick={addNote}
          title="追加一条空 markdown 笔记"
        >
          ➕ 笔记
        </button>
        <button
          class="text-[11px] px-2 py-1 rounded border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700"
          onClick={exportMd}
          title="导出合并后的 markdown"
        >
          ⬇ .md
        </button>
        <button
          class="text-[11px] px-2 py-1 rounded border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700"
          onClick={exportJson}
          title="导出 notebook 原始 json"
        >
          ⬇ .json
        </button>
        <button
          class="text-[11px] px-2 py-1 rounded border border-rose-700/60 bg-rose-950/30 text-rose-300 hover:border-rose-600"
          onClick={clearAll}
          title="删除整个笔记本"
        >
          🗑
        </button>
      </div>
      <div class="flex-1 overflow-y-auto scrollbar p-3 space-y-3">
        <Show
          when={cells().length > 0}
          fallback={
            <div class="text-center text-xs text-zinc-600 py-8 px-4">
              暂无笔记单元。点击 ➕ 笔记 新增手写 markdown,或在对话视图点消息右上角 📎
              钉到笔记。
            </div>
          }
        >
          <For each={cells()}>
            {(cell) => (
              <Show
                when={cell.kind === "note"}
                fallback={
                  <ChatRefCell
                    cell={cell as Extract<NotebookCell, { kind: "chatRef" }>}
                    message={messages().find(
                      (m) =>
                        m.id ===
                        (cell as Extract<NotebookCell, { kind: "chatRef" }>).messageId,
                    )}
                    onRemove={() => removeCell(cell.id)}
                    onMoveUp={() => moveCell(cell.id, -1)}
                    onMoveDown={() => moveCell(cell.id, 1)}
                  />
                }
              >
                <NoteCell
                  cell={cell as Extract<NotebookCell, { kind: "note" }>}
                  previewing={previewingId() === cell.id}
                  onTogglePreview={() =>
                    setPreviewingId((p) => (p === cell.id ? null : cell.id))
                  }
                  onChange={(v) =>
                    updateNote(
                      (cell as Extract<NotebookCell, { kind: "note" }>).id,
                      v,
                    )
                  }
                  onRemove={() => removeCell(cell.id)}
                  onMoveUp={() => moveCell(cell.id, -1)}
                  onMoveDown={() => moveCell(cell.id, 1)}
                />
              </Show>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

function NoteCell(props: {
  cell: Extract<NotebookCell, { kind: "note" }>;
  previewing: boolean;
  onTogglePreview: () => void;
  onChange: (v: string) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div class="border border-zinc-800 rounded bg-zinc-900/60">
      <div class="flex items-center gap-1 px-2 py-1 border-b border-zinc-800 text-[10px] text-zinc-500">
        <span class="font-mono">📝 note</span>
        <div class="flex-1" />
        <IconBtn label="↑" onClick={props.onMoveUp} />
        <IconBtn label="↓" onClick={props.onMoveDown} />
        <IconBtn
          label={props.previewing ? "编辑" : "预览"}
          onClick={props.onTogglePreview}
        />
        <IconBtn label="✕" onClick={props.onRemove} tone="danger" />
      </div>
      <Show
        when={!props.previewing}
        fallback={
          <pre class="p-2 text-xs text-zinc-200 whitespace-pre-wrap break-words font-sans min-h-[3rem]">
            {props.cell.content || <span class="text-zinc-600">(空)</span>}
          </pre>
        }
      >
        <textarea
          class="w-full bg-transparent p-2 text-xs text-zinc-200 resize-y focus:outline-none font-mono"
          rows={4}
          value={props.cell.content}
          placeholder="在这里写 markdown…"
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />
      </Show>
    </div>
  );
}

function ChatRefCell(props: {
  cell: Extract<NotebookCell, { kind: "chatRef" }>;
  message: ChatMessage | undefined;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div class="border border-zinc-800 rounded bg-zinc-900/40">
      <div class="flex items-center gap-1 px-2 py-1 border-b border-zinc-800 text-[10px] text-zinc-500">
        <span class="font-mono">📎 chatRef</span>
        <Show when={props.message}>
          <span class="text-zinc-600">·</span>
          <span class="text-zinc-400">{roleLabel(props.message!.role)}</span>
        </Show>
        <div class="flex-1" />
        <IconBtn label="↑" onClick={props.onMoveUp} />
        <IconBtn label="↓" onClick={props.onMoveDown} />
        <IconBtn label="✕" onClick={props.onRemove} tone="danger" />
      </div>
      <div class="p-2 text-xs text-zinc-300">
        <Show
          when={props.message}
          fallback={
            <div class="text-zinc-600 italic">
              引用消息不在当前加载范围内 · id {props.cell.messageId.slice(0, 8)}…
            </div>
          }
        >
          <div class="space-y-1">
            <For each={props.message!.segments}>
              {(seg) => (
                <Show
                  when={seg.kind === "text" || seg.kind === "thinking"}
                  fallback={
                    <pre class="bg-zinc-950 border border-zinc-800 rounded p-1 text-[11px] overflow-x-auto">
                      <code>
                        {seg.kind === "code"
                          ? seg.content
                          : seg.kind === "diff"
                            ? seg.content
                            : seg.kind === "tool_use"
                              ? `⚙ ${seg.tool} ${seg.input.slice(0, 200)}`
                              : seg.kind === "tool_result"
                                ? `${seg.isError ? "✗" : "✓"} ${seg.content.slice(0, 400)}`
                                : ""}
                      </code>
                    </pre>
                  }
                >
                  <div class="whitespace-pre-wrap break-words">
                    {(seg as { content: string }).content}
                  </div>
                </Show>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

function IconBtn(props: { label: string; onClick: () => void; tone?: "danger" }) {
  return (
    <button
      class={`px-1.5 py-0.5 rounded border text-[10px] transition ${
        props.tone === "danger"
          ? "border-rose-700/50 text-rose-400 hover:border-rose-600 hover:text-rose-300"
          : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
      }`}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

function roleLabel(role: ChatMessage["role"]): string {
  if (role === "user") return "👤 用户";
  if (role === "assistant") return "🤖 助手";
  return "⚙ 系统";
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
