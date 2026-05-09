import { createSignal, createMemo, For, Show, onCleanup, onMount } from "solid-js";
import type { CommandSummary, CommandScope } from "@rcc/protocol";
import type { RccClient } from "./client.ts";

interface Props {
  client: RccClient;
}

const SCOPE_LABEL: Record<CommandScope, { label: string; cls: string }> = {
  builtin: {
    label: "内置",
    cls: "text-zinc-500",
  },
  user: {
    label: "用户",
    cls: "text-sky-400",
  },
  project: {
    label: "项目",
    cls: "text-orange-400",
  },
};

type Filter = "all" | "pinned" | "project" | "user" | "builtin";

export function CommandsTab(props: Props) {
  const [commands, setCommands] = createSignal<CommandSummary[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [filter, setFilter] = createSignal<Filter>("all");
  const [editor, setEditor] = createSignal<null | {
    mode: "create" | "edit";
    id?: string;
    scope: "user" | "project";
    name: string;
    description: string;
    body: string;
    originalId?: string;
    loading?: boolean;
    error?: string;
  }>(null);

  const unsub = props.client.on((frame) => {
    if (frame.t === "cmd.list") {
      setCommands(frame.commands);
      setLoaded(true);
    }
    if (frame.t === "cmd.read") {
      const cur = editor();
      if (cur && cur.id === frame.id && cur.loading) {
        setEditor({
          ...cur,
          description: frame.description,
          body: frame.content,
          loading: false,
        });
      }
    }
    if (frame.t === "cmd.saved") {
      // close editor if matching
      const cur = editor();
      if (cur && (cur.id === frame.command.id || cur.originalId === frame.command.id)) {
        setEditor(null);
      }
    }
    if (frame.t === "cmd.deleted") {
      const cur = editor();
      if (cur && cur.id === frame.id) setEditor(null);
    }
    if (frame.t === "cmd.pinned") {
      // cmd.list is also broadcast; but pinned can land first — patch optimistically
      const ids = new Set(frame.ids);
      setCommands((list) => list.map((c) => ({ ...c, pinned: ids.has(c.id) })));
    }
  });
  onCleanup(unsub);

  onMount(() => {
    props.client.send({ v: 1, t: "cmd.list.request" });
  });

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const f = filter();
    return commands().filter((c) => {
      if (f === "pinned" && !c.pinned) return false;
      if (f === "project" && c.scope !== "project") return false;
      if (f === "user" && c.scope !== "user") return false;
      if (f === "builtin" && c.scope !== "builtin") return false;
      if (q) {
        const blob = `${c.name} ${c.description}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  });

  const counts = createMemo(() => {
    const all = commands();
    return {
      all: all.length,
      pinned: all.filter((c) => c.pinned).length,
      project: all.filter((c) => c.scope === "project").length,
      user: all.filter((c) => c.scope === "user").length,
      builtin: all.filter((c) => c.scope === "builtin").length,
    };
  });

  function togglePin(c: CommandSummary) {
    props.client.send({ v: 1, t: "cmd.pin", id: c.id, pinned: !c.pinned });
    setCommands((list) => list.map((x) => (x.id === c.id ? { ...x, pinned: !x.pinned } : x)));
  }

  function openCreate() {
    setEditor({
      mode: "create",
      scope: "project",
      name: "",
      description: "",
      body: "",
    });
  }

  function openEdit(c: CommandSummary) {
    if (c.scope === "builtin") return;
    setEditor({
      mode: "edit",
      id: c.id,
      originalId: c.id,
      scope: c.scope,
      name: c.name,
      description: c.description,
      body: "",
      loading: true,
    });
    props.client.send({ v: 1, t: "cmd.read.request", id: c.id });
  }

  function saveEditor() {
    const e = editor();
    if (!e) return;
    const name = e.name.trim();
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
      setEditor({ ...e, error: "命令名只能包含字母、数字、下划线和中划线" });
      return;
    }
    props.client.send({
      v: 1,
      t: "cmd.save",
      scope: e.scope,
      name,
      description: e.description.trim() || undefined,
      body: e.body,
      originalId: e.originalId,
    });
  }

  function deleteCommand(c: CommandSummary) {
    if (c.scope === "builtin") return;
    if (!confirm(`删除命令 /${c.name}?`)) return;
    props.client.send({ v: 1, t: "cmd.delete", id: c.id });
  }

  return (
    <div>
      <div class="flex items-start justify-between mb-6">
        <div>
          <div class="flex items-center gap-2 mb-2">
            <h1 class="text-2xl font-semibold">Slash Commands</h1>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
              {counts().all} 命令
            </span>
          </div>
          <p class="text-sm text-zinc-400 max-w-2xl">
            在聊天框里输入 <code class="font-mono bg-zinc-900 text-xs px-1.5 py-0.5 rounded text-violet-400">/</code> 调出。
            可以把最常用的"钉"到聊天的快捷按钮条。
          </p>
        </div>
        <button
          onClick={openCreate}
          class="px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-xs font-medium hover:opacity-90"
        >
          + 新建命令
        </button>
      </div>

      {/* filter + search */}
      <div class="flex items-center gap-2 mb-4 flex-wrap">
        <FilterChip label={`全部 ${counts().all}`} active={filter() === "all"} onClick={() => setFilter("all")} />
        <FilterChip label={`已钉 ${counts().pinned}`} active={filter() === "pinned"} onClick={() => setFilter("pinned")} />
        <FilterChip label={`项目 ${counts().project}`} active={filter() === "project"} onClick={() => setFilter("project")} />
        <FilterChip label={`用户 ${counts().user}`} active={filter() === "user"} onClick={() => setFilter("user")} />
        <FilterChip label={`内置 ${counts().builtin}`} active={filter() === "builtin"} onClick={() => setFilter("builtin")} />
        <div class="flex-1" />
        <input
          type="text"
          placeholder="搜索命令..."
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          class="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-700 w-56"
        />
      </div>

      <div class="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden mb-8">
        <div class="grid grid-cols-[auto_2fr_3fr_auto_auto] gap-4 px-4 py-2.5 border-b border-zinc-800 text-[10px] uppercase tracking-widest text-zinc-500">
          <div class="w-6" />
          <div>Name</div>
          <div>Description</div>
          <div>Source</div>
          <div>钉到聊天</div>
        </div>

        <Show
          when={loaded()}
          fallback={
            <div class="px-4 py-10 text-center text-sm text-zinc-500">加载中…</div>
          }
        >
          <Show
            when={filtered().length > 0}
            fallback={
              <div class="px-4 py-10 text-center text-sm text-zinc-500">没有符合条件的命令</div>
            }
          >
            <For each={filtered()}>
              {(c) => (
                <div
                  class={`grid grid-cols-[auto_2fr_3fr_auto_auto] gap-4 px-4 py-2.5 border-b border-zinc-800 last:border-b-0 items-center hover:bg-zinc-900/60 ${
                    c.scope === "project" ? "bg-orange-500/5" : ""
                  }`}
                >
                  <div class="w-6 grid place-items-center">
                    <span
                      class={`w-5 h-5 rounded grid place-items-center text-[11px] font-mono ${
                        c.scope === "project"
                          ? "bg-orange-500/20 text-orange-400"
                          : c.scope === "user"
                          ? "bg-sky-500/15 text-sky-400"
                          : "bg-violet-500/15 text-violet-400"
                      }`}
                    >
                      /
                    </span>
                  </div>
                  <button
                    class="font-mono text-sm text-zinc-200 text-left truncate hover:text-violet-300"
                    onClick={() => openEdit(c)}
                    disabled={c.scope === "builtin"}
                    title={c.scope === "builtin" ? "内置命令不可编辑" : "编辑"}
                  >
                    /{c.name}
                  </button>
                  <div class="text-xs text-zinc-400 truncate" title={c.description}>
                    {c.description || <span class="text-zinc-600">—</span>}
                  </div>
                  <div class={`text-[11px] shrink-0 ${SCOPE_LABEL[c.scope].cls}`}>
                    {SCOPE_LABEL[c.scope].label}
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <Toggle on={c.pinned} onToggle={() => togglePin(c)} />
                    <Show when={c.scope !== "builtin"}>
                      <button
                        onClick={() => deleteCommand(c)}
                        class="text-[11px] px-1.5 py-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10"
                        title="删除"
                      >
                        🗑
                      </button>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>

      {/* pinned preview */}
      <div class="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div class="text-[11px] uppercase tracking-widest text-zinc-500 mb-3">聊天快捷按钮预览</div>
        <div class="text-xs text-zinc-400 mb-4">钉住的命令会出现在桌面和手机两端的聊天输入框上方：</div>
        <div class="flex items-center gap-1.5 flex-wrap p-3 rounded-lg bg-zinc-950 border border-zinc-800">
          <Show
            when={commands().some((c) => c.pinned)}
            fallback={
              <div class="text-[11px] text-zinc-600">还没有钉住任何命令</div>
            }
          >
            <For each={commands().filter((c) => c.pinned)}>
              {(c) => (
                <button
                  class={`text-[11px] px-2.5 py-1.5 rounded-md border flex items-center gap-1.5 font-mono ${
                    c.scope === "project"
                      ? "bg-orange-500/10 border-orange-500/30 text-orange-300"
                      : "bg-zinc-900 border-zinc-800 text-zinc-300"
                  }`}
                  onClick={() => togglePin(c)}
                  title="点击取消钉选"
                >
                  <span
                    class={`w-1 h-1 rounded-full ${
                      c.scope === "project"
                        ? "bg-orange-400"
                        : c.scope === "user"
                        ? "bg-sky-400"
                        : "bg-violet-400"
                    }`}
                  />
                  /{c.name}
                </button>
              )}
            </For>
          </Show>
        </div>
        <div class="text-[11px] text-zinc-500 mt-3 leading-relaxed">
          📌 钉住的命令会出现在桌面和手机两端的聊天界面。空间不够时会横向滚动。
        </div>
      </div>

      <CommandEditor
        editor={editor()}
        onChange={(next) => setEditor(next)}
        onSave={saveEditor}
        onCancel={() => setEditor(null)}
      />
    </div>
  );
}

function FilterChip(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      class={`text-xs px-2.5 py-1 rounded-md border transition ${
        props.active
          ? "bg-zinc-800 border-zinc-700 text-zinc-100"
          : "bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
      }`}
    >
      {props.label}
    </button>
  );
}

function Toggle(props: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={props.onToggle}
      class={`relative w-9 h-5 rounded-full transition ${
        props.on ? "bg-violet-500" : "bg-zinc-800"
      }`}
      title={props.on ? "已钉到聊天" : "未钉"}
    >
      <span
        class={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
          props.on ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

interface CommandEditorState {
  mode: "create" | "edit";
  id?: string;
  scope: "user" | "project";
  name: string;
  description: string;
  body: string;
  originalId?: string;
  loading?: boolean;
  error?: string;
}

function CommandEditor(props: {
  editor: CommandEditorState | null;
  onChange: (next: CommandEditorState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Show when={props.editor}>
      {(e) => (
        <div
          class="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm grid place-items-center"
          onClick={(ev) => ev.target === ev.currentTarget && props.onCancel()}
        >
          <div class="w-[720px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-64px)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col">
            <div class="px-5 py-4 border-b border-zinc-900 flex items-center justify-between">
              <div>
                <div class="text-sm font-semibold">
                  {e().mode === "create" ? "新建 Slash Command" : `编辑 /${e().name}`}
                </div>
                <div class="text-xs text-zinc-500 mt-0.5">
                  命令会写入对应目录下的 <code class="font-mono">.claude/commands/{e().name || "<name>"}.md</code>
                </div>
              </div>
              <button class="text-zinc-500 hover:text-zinc-200 text-sm px-2" onClick={props.onCancel}>
                ✕
              </button>
            </div>

            <div class="p-5 overflow-y-auto flex-1 space-y-4">
              <div class="grid grid-cols-[auto_1fr] gap-3 items-center">
                <label class="text-xs text-zinc-400">作用范围</label>
                <div class="flex gap-2">
                  <ScopeButton
                    label="项目"
                    active={e().scope === "project"}
                    accent="orange"
                    onClick={() => props.onChange({ ...e(), scope: "project" })}
                  />
                  <ScopeButton
                    label="用户"
                    active={e().scope === "user"}
                    accent="sky"
                    onClick={() => props.onChange({ ...e(), scope: "user" })}
                  />
                </div>

                <label class="text-xs text-zinc-400">命令名</label>
                <div class="flex items-center gap-2">
                  <span class="font-mono text-sm text-zinc-500">/</span>
                  <input
                    value={e().name}
                    onInput={(ev) => props.onChange({ ...e(), name: ev.currentTarget.value, error: undefined })}
                    placeholder="deploy-staging"
                    disabled={e().mode === "edit"}
                    class="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm font-mono outline-none focus:border-zinc-700 disabled:opacity-50"
                  />
                </div>

                <label class="text-xs text-zinc-400">描述</label>
                <input
                  value={e().description}
                  onInput={(ev) => props.onChange({ ...e(), description: ev.currentTarget.value })}
                  placeholder="这个命令做什么（可选，显示在列表里）"
                  class="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm outline-none focus:border-zinc-700"
                />
              </div>

              <div>
                <label class="text-xs text-zinc-400 mb-1.5 block">命令正文</label>
                <textarea
                  value={e().body}
                  onInput={(ev) => props.onChange({ ...e(), body: ev.currentTarget.value })}
                  disabled={e().loading}
                  placeholder="这个 slash 被触发时发送给 Claude 的 prompt。支持 markdown 和 $ARGUMENTS 占位符。"
                  rows={12}
                  class="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs font-mono outline-none focus:border-zinc-700 resize-y"
                />
                <Show when={e().loading}>
                  <div class="text-[11px] text-zinc-500 mt-1">加载中…</div>
                </Show>
              </div>

              <Show when={e().error}>
                <div class="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">
                  {e().error}
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
                class="text-sm px-3 py-1.5 rounded bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-medium hover:opacity-90 disabled:opacity-50"
                onClick={props.onSave}
                disabled={!e().name.trim() || e().loading}
              >
                {e().mode === "create" ? "创建" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}

function ScopeButton(props: {
  label: string;
  active: boolean;
  accent: "orange" | "sky";
  onClick: () => void;
}) {
  const accentCls = () =>
    props.active
      ? props.accent === "orange"
        ? "bg-orange-500/20 border-orange-500/40 text-orange-300"
        : "bg-sky-500/20 border-sky-500/40 text-sky-300"
      : "bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300";
  return (
    <button
      class={`text-xs px-3 py-1 rounded-md border ${accentCls()}`}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}
