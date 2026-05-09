import { createSignal, createMemo, For, Show, onCleanup, onMount } from "solid-js";
import type { SubagentSummary, SubagentScope } from "@rcc/protocol";
import type { RccClient } from "./client.ts";

interface Props {
  client: RccClient;
}

const ICONS = ["🔎", "🏗", "🎨", "⚡", "🧪", "📚", "🧠", "🔐", "🚀", "📦", "🛠"];

function iconFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ICONS[h % ICONS.length]!;
}

const MODEL_OPTIONS = ["", "opus", "sonnet", "haiku", "inherit"] as const;

export function SubagentsTab(props: Props) {
  const [agents, setAgents] = createSignal<SubagentSummary[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [editor, setEditor] = createSignal<null | {
    mode: "create" | "edit";
    id?: string;
    scope: SubagentScope;
    name: string;
    description: string;
    model: string;
    tools: string;
    body: string;
    originalId?: string;
    loading?: boolean;
    error?: string;
  }>(null);

  const unsub = props.client.on((frame) => {
    if (frame.t === "subagent.list") {
      setAgents(frame.agents);
      setLoaded(true);
    }
    if (frame.t === "subagent.read") {
      const cur = editor();
      if (cur && cur.id === frame.id && cur.loading) {
        setEditor({
          ...cur,
          description: frame.meta.description,
          model: frame.meta.model ?? "",
          tools: frame.meta.tools ?? "",
          body: frame.content,
          loading: false,
        });
      }
    }
    if (frame.t === "subagent.saved") {
      const cur = editor();
      if (cur && (cur.id === frame.agent.id || cur.originalId === frame.agent.id)) {
        setEditor(null);
      }
    }
    if (frame.t === "subagent.deleted") {
      const cur = editor();
      if (cur && cur.id === frame.id) setEditor(null);
    }
  });
  onCleanup(unsub);

  onMount(() => {
    props.client.send({ v: 1, t: "subagent.list.request" });
  });

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return agents();
    return agents().filter((a) => {
      const blob = `${a.name} ${a.description} ${a.model ?? ""} ${a.tools ?? ""}`.toLowerCase();
      return blob.includes(q);
    });
  });

  function openCreate() {
    setEditor({
      mode: "create",
      scope: "project",
      name: "",
      description: "",
      model: "",
      tools: "",
      body: "",
    });
  }

  function openEdit(a: SubagentSummary) {
    setEditor({
      mode: "edit",
      id: a.id,
      originalId: a.id,
      scope: a.scope,
      name: a.name,
      description: a.description,
      model: a.model ?? "",
      tools: a.tools ?? "",
      body: "",
      loading: true,
    });
    props.client.send({ v: 1, t: "subagent.read.request", id: a.id });
  }

  function saveEditor() {
    const e = editor();
    if (!e) return;
    const name = e.name.trim();
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
      setEditor({ ...e, error: "名称只能包含字母、数字、下划线和中划线" });
      return;
    }
    props.client.send({
      v: 1,
      t: "subagent.save",
      scope: e.scope,
      name,
      description: e.description.trim() || undefined,
      model: e.model.trim() || undefined,
      tools: e.tools.trim() || undefined,
      body: e.body,
      originalId: e.originalId,
    });
  }

  function deleteAgent(a: SubagentSummary) {
    if (!confirm(`删除 subagent "${a.name}"?`)) return;
    props.client.send({ v: 1, t: "subagent.delete", id: a.id });
  }

  return (
    <div>
      <div class="flex items-start justify-between mb-6">
        <div>
          <div class="flex items-center gap-2 mb-2">
            <h1 class="text-2xl font-semibold">Subagents</h1>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              {agents().length} agents
            </span>
          </div>
          <p class="text-sm text-zinc-400 max-w-2xl">
            专项能力的子智能体。Claude 自动判断何时调用，你也可以明确指名。
            文件来自 <code class="font-mono text-[11px] text-zinc-500">~/.claude/agents</code> 和
            <code class="font-mono text-[11px] text-zinc-500"> .claude/agents</code>。
          </p>
        </div>
        <button
          onClick={openCreate}
          class="px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-xs font-medium hover:opacity-90"
        >
          + 新建 Subagent
        </button>
      </div>

      <div class="flex items-center gap-2 mb-4">
        <input
          type="text"
          placeholder="搜索 subagent..."
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          class="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-700 w-64"
        />
      </div>

      <Show
        when={loaded()}
        fallback={
          <div class="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-10 text-center text-sm text-zinc-500">
            加载中…
          </div>
        }
      >
        <Show
          when={filtered().length > 0}
          fallback={
            <div class="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-10 text-center">
              <div class="text-sm text-zinc-400">还没有自定义 subagent</div>
              <div class="text-xs text-zinc-600 mt-1">
                新建一个，或者在 <code class="font-mono">~/.claude/agents/</code> 里放 .md 文件
              </div>
            </div>
          }
        >
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
            <For each={filtered()}>
              {(a) => (
                <AgentCard a={a} onEdit={() => openEdit(a)} onDelete={() => deleteAgent(a)} />
              )}
            </For>
          </div>
        </Show>
      </Show>

      <AgentEditor
        editor={editor()}
        onChange={(next) => setEditor(next)}
        onSave={saveEditor}
        onCancel={() => setEditor(null)}
      />
    </div>
  );
}

function AgentCard(props: {
  a: SubagentSummary;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isProject = () => props.a.scope === "project";
  return (
    <div
      class={`rounded-xl border p-4 ${
        isProject()
          ? "border-orange-500/40 bg-gradient-to-br from-orange-500/10 to-transparent"
          : "border-zinc-800 bg-zinc-900/40"
      }`}
    >
      <div class="flex items-start justify-between gap-3 mb-2">
        <div class="flex items-start gap-3 min-w-0 flex-1">
          <div
            class={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${
              isProject()
                ? "bg-orange-500/20 text-orange-400"
                : "bg-emerald-500/15 text-emerald-400"
            }`}
          >
            {iconFor(props.a.name)}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <button
                class="font-medium text-sm truncate hover:text-emerald-300 text-left"
                onClick={props.onEdit}
                title="编辑"
              >
                {props.a.name}
              </button>
              <span
                class={`text-[10px] px-1.5 py-0.5 rounded border ${
                  isProject()
                    ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                    : "bg-sky-500/10 text-sky-400 border-sky-500/20"
                }`}
              >
                {isProject() ? "项目" : "用户"}
              </span>
            </div>
            <div class="text-[11px] text-zinc-500 mt-0.5 line-clamp-2" title={props.a.description}>
              {props.a.description || "—"}
            </div>
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button
            onClick={props.onEdit}
            class="text-[11px] px-1.5 py-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
            title="编辑"
          >
            ✎
          </button>
          <button
            onClick={props.onDelete}
            class="text-[11px] px-1.5 py-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10"
            title="删除"
          >
            🗑
          </button>
        </div>
      </div>
      <div
        class={`mt-3 pt-3 border-t grid grid-cols-3 gap-2 text-[11px] ${
          isProject() ? "border-orange-500/20" : "border-zinc-800"
        }`}
      >
        <div>
          <div class="text-zinc-500">模型</div>
          <div class="text-zinc-300 mt-0.5 truncate" title={props.a.model ?? ""}>
            {props.a.model || "继承"}
          </div>
        </div>
        <div>
          <div class="text-zinc-500">工具</div>
          <div class="text-zinc-300 mt-0.5 truncate" title={props.a.tools ?? ""}>
            {props.a.tools || "全部"}
          </div>
        </div>
        <div>
          <div class="text-zinc-500">调用次数</div>
          <div class="text-zinc-600 mt-0.5">—</div>
        </div>
      </div>
    </div>
  );
}

function AgentEditor(props: {
  editor: null | {
    mode: "create" | "edit";
    id?: string;
    scope: SubagentScope;
    name: string;
    description: string;
    model: string;
    tools: string;
    body: string;
    originalId?: string;
    loading?: boolean;
    error?: string;
  };
  onChange: (next: NonNullable<typeof props.editor>) => void;
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
          <div class="w-[760px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-64px)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col">
            <div class="px-5 py-4 border-b border-zinc-900 flex items-center justify-between">
              <div>
                <div class="text-sm font-semibold">
                  {e().mode === "create" ? "新建 Subagent" : `编辑 ${e().name}`}
                </div>
                <div class="text-xs text-zinc-500 mt-0.5">
                  写入 <code class="font-mono">.claude/agents/{e().name || "<name>"}.md</code>
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

                <label class="text-xs text-zinc-400">名称</label>
                <input
                  value={e().name}
                  onInput={(ev) => props.onChange({ ...e(), name: ev.currentTarget.value, error: undefined })}
                  placeholder="ui-reviewer"
                  disabled={e().mode === "edit"}
                  class="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm font-mono outline-none focus:border-zinc-700 disabled:opacity-50"
                />

                <label class="text-xs text-zinc-400">描述</label>
                <input
                  value={e().description}
                  onInput={(ev) => props.onChange({ ...e(), description: ev.currentTarget.value })}
                  placeholder="Claude 依此决定何时调用此 agent"
                  class="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm outline-none focus:border-zinc-700"
                />

                <label class="text-xs text-zinc-400">模型</label>
                <select
                  value={e().model}
                  onChange={(ev) => props.onChange({ ...e(), model: ev.currentTarget.value })}
                  class="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm outline-none focus:border-zinc-700"
                >
                  <For each={MODEL_OPTIONS}>
                    {(m) => <option value={m}>{m || "（继承会话模型）"}</option>}
                  </For>
                </select>

                <label class="text-xs text-zinc-400">工具</label>
                <input
                  value={e().tools}
                  onInput={(ev) => props.onChange({ ...e(), tools: ev.currentTarget.value })}
                  placeholder="Read, Grep, Glob"
                  class="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm font-mono outline-none focus:border-zinc-700"
                />
              </div>

              <div>
                <label class="text-xs text-zinc-400 mb-1.5 block">System prompt</label>
                <textarea
                  value={e().body}
                  onInput={(ev) => props.onChange({ ...e(), body: ev.currentTarget.value })}
                  disabled={e().loading}
                  placeholder="这个 subagent 的 system prompt。支持 markdown。"
                  rows={14}
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
                class="text-sm px-3 py-1.5 rounded bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-medium hover:opacity-90 disabled:opacity-50"
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
