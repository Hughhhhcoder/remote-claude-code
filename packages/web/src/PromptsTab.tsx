import { createSignal, createMemo, For, Show, onCleanup, onMount } from "solid-js";
import type { PromptTemplate } from "@rcc/protocol";
import type { RccClient } from "./client.ts";

interface Props {
  client: RccClient;
}

interface EditorState {
  mode: "create" | "edit";
  id?: string;
  name: string;
  template: string;
  description: string;
  error?: string;
}

const PARAM_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

function previewParams(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  PARAM_RE.lastIndex = 0;
  while ((m = PARAM_RE.exec(template))) {
    const k = m[1]!;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

export function PromptsTab(props: Props) {
  const [prompts, setPrompts] = createSignal<PromptTemplate[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [editor, setEditor] = createSignal<EditorState | null>(null);

  const unsub = props.client.on((frame) => {
    if (frame.t === "prompt.list") {
      setPrompts(frame.prompts);
      setLoaded(true);
    }
    if (frame.t === "prompt.saved") {
      const cur = editor();
      if (cur && (cur.id === frame.prompt.id || cur.mode === "create")) {
        setEditor(null);
      }
    }
  });
  onCleanup(unsub);

  onMount(() => {
    props.client.send({ v: 1, t: "prompt.list.request" });
  });

  function openCreate() {
    setEditor({
      mode: "create",
      name: "",
      template: "",
      description: "",
    });
  }

  function openEdit(p: PromptTemplate) {
    setEditor({
      mode: "edit",
      id: p.id,
      name: p.name,
      template: p.template,
      description: p.description ?? "",
    });
  }

  function saveEditor() {
    const e = editor();
    if (!e) return;
    const name = e.name.trim();
    if (!name) {
      setEditor({ ...e, error: "请填写名称" });
      return;
    }
    if (!/^[A-Za-z0-9._-][A-Za-z0-9._:-]{0,63}$/.test(name)) {
      setEditor({ ...e, error: "名称只能含字母/数字/. _ - :" });
      return;
    }
    if (!e.template.trim()) {
      setEditor({ ...e, error: "模板内容不能为空" });
      return;
    }
    if (new Blob([e.template]).size > 8 * 1024) {
      setEditor({ ...e, error: "模板超过 8KB" });
      return;
    }
    if (previewParams(e.template).length > 20) {
      setEditor({ ...e, error: "参数不能超过 20 个" });
      return;
    }
    props.client.send({
      v: 1,
      t: "prompt.save",
      id: e.id,
      name,
      template: e.template,
      description: e.description.trim() || undefined,
    });
  }

  function removePrompt(p: PromptTemplate) {
    if (!confirm(`删除模板 "${p.name}"?`)) return;
    props.client.send({ v: 1, t: "prompt.remove", id: p.id });
  }

  const list = createMemo(() => prompts());

  return (
    <div>
      <div class="flex items-start justify-between mb-6">
        <div>
          <div class="flex items-center gap-2 mb-2">
            <h1 class="text-2xl font-semibold">Prompts 提示模板</h1>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
              {list().length}
            </span>
          </div>
          <p class="text-sm text-zinc-400 max-w-2xl">
            自定义 snippet,支持 <code class="font-mono bg-zinc-900 text-xs px-1.5 py-0.5 rounded text-amber-300">{"{{param}}"}</code> 占位。
            在会话输入框敲 <code class="font-mono bg-zinc-900 text-xs px-1.5 py-0.5 rounded text-amber-300">/p:名称</code> 即可本地展开
            (有参数会弹出填值面板)。<strong class="text-zinc-300">不会自动发送</strong>,由你手动确认。
          </p>
        </div>
        <button
          onClick={openCreate}
          class="px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-medium hover:opacity-90"
        >
          + 新建模板
        </button>
      </div>

      <div class="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden mb-8">
        <Show
          when={loaded()}
          fallback={
            <div class="px-4 py-10 text-center text-sm text-zinc-500">加载中…</div>
          }
        >
          <Show
            when={list().length > 0}
            fallback={
              <div class="px-4 py-10 text-center text-sm text-zinc-500">
                还没有模板。点击右上角 "+ 新建" 开始。
              </div>
            }
          >
            <For each={list()}>
              {(p) => (
                <div class="px-4 py-3 border-b border-zinc-800 last:border-b-0 hover:bg-zinc-900/60 flex items-start gap-4">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="font-mono text-sm text-zinc-100 truncate">
                        /p:{p.name}
                      </span>
                      <Show when={p.params.length > 0}>
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                          {p.params.length} 参数
                        </span>
                      </Show>
                    </div>
                    <Show when={p.description}>
                      <div class="text-xs text-zinc-400 mb-1.5">{p.description}</div>
                    </Show>
                    <div class="text-[11px] font-mono text-zinc-500 whitespace-pre-wrap break-words line-clamp-3 bg-zinc-950/50 rounded border border-zinc-900 px-2 py-1.5">
                      {p.template.length > 240 ? p.template.slice(0, 240) + "…" : p.template}
                    </div>
                    <Show when={p.params.length > 0}>
                      <div class="flex items-center gap-1 flex-wrap mt-1.5">
                        <For each={p.params}>
                          {(name) => (
                            <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">
                              {"{{"}{name}{"}}"}
                            </span>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => openEdit(p)}
                      class="text-xs px-2 py-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                      title="编辑"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => removePrompt(p)}
                      class="text-xs px-2 py-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10"
                      title="删除"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>

      <PromptEditor
        state={editor()}
        onChange={(s) => setEditor(s)}
        onSave={saveEditor}
        onCancel={() => setEditor(null)}
      />
    </div>
  );
}

function PromptEditor(props: {
  state: EditorState | null;
  onChange: (s: EditorState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Show when={props.state}>
      {(s) => {
        const params = createMemo(() => previewParams(s().template));
        const bytes = createMemo(() => new Blob([s().template]).size);
        return (
          <div
            class="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm grid place-items-center"
            onClick={(ev) => ev.target === ev.currentTarget && props.onCancel()}
          >
            <div class="w-[680px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-64px)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col">
              <div class="px-5 py-4 border-b border-zinc-900 flex items-center justify-between">
                <div>
                  <div class="text-sm font-semibold">
                    {s().mode === "create" ? "新建提示模板" : `编辑 ${s().name || "模板"}`}
                  </div>
                  <div class="text-xs text-zinc-500 mt-0.5">
                    用 <code class="font-mono text-amber-300">{"{{name}}"}</code> 表示占位参数,保存时自动提取。
                  </div>
                </div>
                <button class="text-zinc-500 hover:text-zinc-200 text-sm px-2" onClick={props.onCancel}>
                  ✕
                </button>
              </div>

              <div class="p-5 overflow-y-auto flex-1 space-y-4">
                <div class="grid grid-cols-[auto_1fr] gap-3 items-center">
                  <label class="text-xs text-zinc-400">名称</label>
                  <input
                    value={s().name}
                    onInput={(ev) => props.onChange({ ...s(), name: ev.currentTarget.value, error: undefined })}
                    placeholder="fix-bug"
                    class="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm font-mono outline-none focus:border-zinc-700"
                  />

                  <label class="text-xs text-zinc-400">描述</label>
                  <input
                    value={s().description}
                    onInput={(ev) => props.onChange({ ...s(), description: ev.currentTarget.value })}
                    placeholder="可选,简要说明用途"
                    class="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm outline-none focus:border-zinc-700"
                  />
                </div>

                <div>
                  <div class="flex items-center justify-between mb-1.5">
                    <label class="text-xs text-zinc-400">模板内容</label>
                    <span class={`text-[10px] font-mono ${bytes() > 8 * 1024 ? "text-rose-400" : "text-zinc-500"}`}>
                      {bytes()} / 8192 B
                    </span>
                  </div>
                  <textarea
                    value={s().template}
                    onInput={(ev) =>
                      props.onChange({ ...s(), template: ev.currentTarget.value, error: undefined })
                    }
                    placeholder={"修复 {{file}} 里的 bug:{{desc}}"}
                    rows={8}
                    class="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs font-mono outline-none focus:border-zinc-700 resize-y"
                  />
                  <Show when={params().length > 0}>
                    <div class="flex items-center gap-1.5 flex-wrap mt-2">
                      <span class="text-[10px] text-zinc-500 uppercase tracking-widest">识别到</span>
                      <For each={params()}>
                        {(name) => (
                          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">
                            {name}
                          </span>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>

                <Show when={s().error}>
                  <div class="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">
                    {s().error}
                  </div>
                </Show>
              </div>

              <div class="px-5 py-3 border-t border-zinc-900 flex items-center justify-end gap-2">
                <button
                  class="text-sm px-3 py-1.5 rounded text-zinc-400 hover:text-zinc-200"
                  onClick={props.onCancel}
                >
                  取消
                </button>
                <button
                  class="text-sm px-3 py-1.5 rounded bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium hover:opacity-90 disabled:opacity-50"
                  onClick={props.onSave}
                  disabled={!s().name.trim() || !s().template.trim()}
                >
                  {s().mode === "create" ? "创建" : "保存"}
                </button>
              </div>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
