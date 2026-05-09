import { createSignal, createMemo, For, Show, onCleanup, onMount } from "solid-js";
import type { SkillSummary, SkillScope } from "@rcc/protocol";
import type { RccClient } from "./client.ts";
import { MarketplaceView } from "./MarketplaceView.tsx";

interface Props {
  client: RccClient;
  /** Active session id for the "try run" button, if any. */
  activeSid: string | null;
}

type Filter = "all" | "enabled" | "disabled" | "project" | "user";

const SCOPE_CHIP: Record<SkillScope, { label: string; cls: string }> = {
  user: {
    label: "用户",
    cls: "bg-sky-500/10 text-sky-400 border border-sky-500/20",
  },
  project: {
    label: "项目",
    cls: "bg-orange-500/20 text-orange-400 border border-orange-500/30",
  },
};

const ICONS = ["✨", "🔒", "🔍", "📝", "🎨", "📚", "⚙", "🧪", "🚀", "🧠", "📦"];

function iconFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ICONS[h % ICONS.length]!;
}

export function SkillsTab(props: Props) {
  const [skills, setSkills] = createSignal<SkillSummary[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [filter, setFilter] = createSignal<Filter>("all");
  const [editorOpen, setEditorOpen] = createSignal<null | {
    mode: "view" | "create";
    id?: string;
    scope: SkillScope;
    name: string;
    content: string;
    loading?: boolean;
  }>(null);
  const [marketOpen, setMarketOpen] = createSignal(false);

  const unsub = props.client.on((frame) => {
    if (frame.t === "skill.list") {
      setSkills(frame.skills);
      setLoaded(true);
    }
    if (frame.t === "skill.read") {
      const current = editorOpen();
      if (current && current.id === frame.id) {
        setEditorOpen({ ...current, content: frame.content, loading: false });
      }
    }
  });
  onCleanup(unsub);

  onMount(() => {
    props.client.send({ v: 1, t: "skill.list.request" });
  });

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const f = filter();
    return skills().filter((s) => {
      if (f === "enabled" && !s.enabled) return false;
      if (f === "disabled" && s.enabled) return false;
      if (f === "project" && s.scope !== "project") return false;
      if (f === "user" && s.scope !== "user") return false;
      if (q) {
        const blob = `${s.name} ${s.description} ${s.tags.join(" ")}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  });

  const counts = createMemo(() => {
    const all = skills();
    return {
      all: all.length,
      enabled: all.filter((s) => s.enabled).length,
      disabled: all.filter((s) => !s.enabled).length,
      project: all.filter((s) => s.scope === "project").length,
      user: all.filter((s) => s.scope === "user").length,
    };
  });

  function toggle(s: SkillSummary) {
    props.client.send({ v: 1, t: "skill.toggle", id: s.id, enabled: !s.enabled });
    // optimistic
    setSkills((list) =>
      list.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)),
    );
  }

  function openViewer(s: SkillSummary) {
    setEditorOpen({
      mode: "view",
      id: s.id,
      scope: s.scope,
      name: s.name,
      content: "",
      loading: true,
    });
    props.client.send({ v: 1, t: "skill.read.request", id: s.id });
  }

  function openCreate() {
    setEditorOpen({
      mode: "create",
      scope: "project",
      name: "",
      content:
        "---\nname: new-skill\ndescription: One-line description of what this skill does\n---\n\n# New Skill\n\nMarkdown body that Claude reads when the skill is invoked.\n",
    });
  }

  function tryRun(s: SkillSummary) {
    const sid = props.activeSid;
    if (!sid) {
      alert("没有活跃会话。请先在主界面创建或选择一个会话。");
      return;
    }
    // Send a natural-language nudge to claude to use the skill.
    props.client.write(sid, `请使用 skill: ${s.name}\n`);
  }

  function deleteSkill(s: SkillSummary) {
    if (!confirm(`删除 skill "${s.name}"？此操作不可撤销。`)) return;
    props.client.send({ v: 1, t: "skill.delete", id: s.id });
  }

  return (
    <div>
      <div class="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div class="flex items-center gap-2 mb-2">
            <h1 class="text-2xl font-semibold">Skills</h1>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">
              {counts().enabled} 启用
            </span>
          </div>
          <p class="text-sm text-zinc-400 max-w-2xl">
            Skills 是 Claude Code 的能力模块。启用后 Claude 会在合适的时机自动调用，你也能在聊天里手动触发。
            读取自 <span class="font-mono text-zinc-500">~/.claude/skills</span> 和项目 <span class="font-mono text-zinc-500">.claude/skills</span>。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs">
            <span class="text-zinc-600">⌕</span>
            <input
              placeholder="搜索 skills…"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              class="bg-transparent outline-none w-32 text-zinc-300 placeholder-zinc-600"
            />
          </div>
          <button
            onClick={() => setMarketOpen(true)}
            class="px-3 py-1.5 rounded-lg border border-zinc-800 text-xs text-zinc-300 hover:border-orange-500/40 hover:text-orange-300"
            title="浏览 skills + MCP marketplace"
          >
            📥 Marketplace
          </button>
          <button
            onClick={openCreate}
            class="px-3 py-1.5 rounded-lg bg-gradient-to-r from-orange-500 to-rose-500 text-white text-xs font-medium"
          >
            + 新建 Skill
          </button>
        </div>
      </div>

      <div class="flex items-center gap-2 mb-5 text-xs">
        <For
          each={
            [
              ["all", `全部 ${counts().all}`],
              ["enabled", `已启用 ${counts().enabled}`],
              ["disabled", `已禁用 ${counts().disabled}`],
              ["project", `项目 ${counts().project}`],
              ["user", `用户 ${counts().user}`],
            ] as const
          }
        >
          {([key, label]) => (
            <button
              onClick={() => setFilter(key)}
              class={`px-3 py-1 rounded-full ${
                filter() === key
                  ? "bg-zinc-800 text-zinc-200"
                  : "border border-zinc-800 text-zinc-400 hover:bg-zinc-900"
              }`}
            >
              {label}
            </button>
          )}
        </For>
        <button
          onClick={() => props.client.send({ v: 1, t: "skill.list.request" })}
          class="ml-auto text-zinc-500 hover:text-zinc-200"
          title="刷新"
        >
          ⟳
        </button>
      </div>

      <Show
        when={loaded()}
        fallback={
          <div class="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-10 text-center text-sm text-zinc-500">
            载入中…
          </div>
        }
      >
        <Show
          when={filtered().length > 0}
          fallback={
            <div class="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-10 text-center">
              <div class="text-sm text-zinc-400 mb-1">
                {skills().length === 0 ? "还没有任何 skill" : "没有匹配的 skill"}
              </div>
              <div class="text-xs text-zinc-600">
                点击右上角「+ 新建 Skill」创建一个，或把 SKILL.md 放入 ~/.claude/skills/&lt;name&gt;/
              </div>
            </div>
          }
        >
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
            <For each={filtered()}>{(s) => renderCard(s)}</For>
          </div>
        </Show>
      </Show>

      <button
        onClick={() => setMarketOpen(true)}
        class="w-full rounded-xl border border-dashed border-zinc-800 hover:border-orange-500/40 bg-zinc-950/40 hover:bg-zinc-900/40 p-4 grid place-items-center text-center md:col-span-2 mb-8 transition"
      >
        <div class="py-2">
          <div class="text-3xl mb-2">📥</div>
          <div class="text-sm font-medium text-zinc-300 mb-1">浏览 Marketplace</div>
          <div class="text-xs text-zinc-500">
            社区共享的 skills + MCP servers · 一键安装
          </div>
        </div>
      </button>

      <MarketplaceView
        open={marketOpen()}
        client={props.client}
        onClose={() => setMarketOpen(false)}
      />

      {renderEditor()}
    </div>
  );

  function renderCard(s: SkillSummary) {
    const chip = SCOPE_CHIP[s.scope];
    return (
      <div
        class={`rounded-xl border bg-zinc-900/40 p-4 transition ${
          s.enabled
            ? "border-zinc-800 hover:border-zinc-700"
            : "border-zinc-800 bg-zinc-900/20 opacity-60"
        }`}
      >
        <div class="flex items-start justify-between gap-3 mb-2">
          <div class="flex items-start gap-3 min-w-0 flex-1">
            <div class="w-9 h-9 rounded-lg bg-zinc-800 text-zinc-300 grid place-items-center shrink-0 text-lg">
              {iconFor(s.name)}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class={`font-medium text-sm truncate ${s.enabled ? "" : "text-zinc-400"}`}>
                  {s.name}
                </span>
                <span class={`text-[10px] px-1.5 py-0.5 rounded ${chip.cls}`}>
                  {chip.label}
                </span>
                <Show when={!s.enabled}>
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                    禁用
                  </span>
                </Show>
              </div>
              <div class="text-[11px] text-zinc-500 font-mono mt-0.5 truncate" title={s.dir}>
                {s.displayPath}
              </div>
            </div>
          </div>
          <button
            onClick={() => toggle(s)}
            class={`shrink-0 w-10 h-5 rounded-full relative transition ${
              s.enabled ? "bg-orange-500" : "bg-zinc-700"
            }`}
            title={s.enabled ? "点击禁用" : "点击启用"}
          >
            <span
              class={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                s.enabled ? "left-5" : "left-0.5"
              }`}
            />
          </button>
        </div>
        <p class="text-[12px] text-zinc-400 leading-relaxed mb-3 line-clamp-2">
          {s.description || <span class="text-zinc-600 italic">（无描述）</span>}
        </p>
        <div class="flex items-center justify-between gap-2">
          <div class="flex gap-1 flex-wrap min-w-0">
            <For each={s.tags.slice(0, 4)}>
              {(t) => (
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                  {t}
                </span>
              )}
            </For>
          </div>
          <div class="flex gap-1 shrink-0">
            <button
              onClick={() => openViewer(s)}
              class="text-[11px] px-2 py-1 rounded text-zinc-400 hover:bg-zinc-800"
              title="查看 / 编辑 SKILL.md"
            >
              ⚙ 配置
            </button>
            <button
              onClick={() => tryRun(s)}
              disabled={!s.enabled}
              class="text-[11px] px-2 py-1 rounded text-zinc-400 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
              title={s.enabled ? "在当前会话中试运行" : "先启用才能运行"}
            >
              ▶ 试运行
            </button>
            <button
              onClick={() => deleteSkill(s)}
              class="text-[11px] px-2 py-1 rounded text-rose-400 hover:bg-rose-500/10"
              title="删除"
            >
              🗑
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderEditor() {
    const data = editorOpen();
    if (!data) return null;
    const isCreate = data.mode === "create";
    return (
      <Show when={editorOpen()}>
        <div
          class="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm grid place-items-center"
          onClick={(e) => e.target === e.currentTarget && setEditorOpen(null)}
        >
          <div class="w-[820px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-48px)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col overflow-hidden">
            <div class="px-5 py-4 border-b border-zinc-900 flex items-center justify-between">
              <div>
                <div class="text-sm font-semibold">
                  {isCreate ? "新建 Skill" : `Skill: ${data.name}`}
                </div>
                <div class="text-xs text-zinc-500 mt-0.5">
                  {isCreate ? "编辑 SKILL.md 并保存" : "SKILL.md 源文件"}
                </div>
              </div>
              <button
                onClick={() => setEditorOpen(null)}
                class="text-zinc-500 hover:text-zinc-200 text-sm px-2"
              >
                ✕
              </button>
            </div>
            <Show when={isCreate}>
              <div class="px-5 py-3 border-b border-zinc-900 flex items-center gap-3 text-xs">
                <label class="text-zinc-400">作用域</label>
                <select
                  value={data.scope}
                  onChange={(e) => {
                    const curr = editorOpen();
                    if (curr)
                      setEditorOpen({ ...curr, scope: e.currentTarget.value as SkillScope });
                  }}
                  class="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-200 outline-none"
                >
                  <option value="project">项目 (.claude/skills)</option>
                  <option value="user">用户 (~/.claude/skills)</option>
                </select>
                <label class="text-zinc-400 ml-3">名称</label>
                <input
                  placeholder="e.g. my-skill"
                  value={data.name}
                  onInput={(e) => {
                    const curr = editorOpen();
                    if (curr) setEditorOpen({ ...curr, name: e.currentTarget.value });
                  }}
                  class="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-100 outline-none flex-1 font-mono"
                />
              </div>
            </Show>
            <div class="flex-1 overflow-hidden p-5 min-h-0">
              <Show
                when={!data.loading}
                fallback={<div class="text-sm text-zinc-500">读取中…</div>}
              >
                <textarea
                  readOnly={!isCreate}
                  value={data.content}
                  onInput={(e) => {
                    const curr = editorOpen();
                    if (curr) setEditorOpen({ ...curr, content: e.currentTarget.value });
                  }}
                  class="w-full h-full min-h-[360px] bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-xs font-mono text-zinc-200 outline-none resize-none"
                />
              </Show>
            </div>
            <div class="px-5 py-3 border-t border-zinc-900 flex items-center justify-between">
              <div class="text-[11px] text-zinc-500">
                {isCreate ? "保存后自动刷新列表" : "只读视图。直接编辑请用编辑器打开 SKILL.md"}
              </div>
              <div class="flex gap-2">
                <button
                  onClick={() => setEditorOpen(null)}
                  class="px-3 py-1.5 rounded text-xs text-zinc-400 hover:bg-zinc-900"
                >
                  关闭
                </button>
                <Show when={isCreate}>
                  <button
                    onClick={() => saveCreate()}
                    class="px-3 py-1.5 rounded bg-gradient-to-r from-orange-500 to-rose-500 text-white text-xs font-medium"
                  >
                    保存
                  </button>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>
    );
  }

  function saveCreate() {
    const data = editorOpen();
    if (!data || data.mode !== "create") return;
    const name = data.name.trim();
    if (!name) {
      alert("请输入 skill 名称");
      return;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      alert("名称只能包含字母、数字、点、下划线、短横线");
      return;
    }
    const parsed = extractFrontmatter(data.content);
    props.client.send({
      v: 1,
      t: "skill.save",
      scope: data.scope,
      name,
      description: parsed.description,
      body: parsed.body,
      tags: parsed.tags,
    });
    setEditorOpen(null);
  }
}

/** Lightweight frontmatter extractor for the editor — description/tags optional. */
function extractFrontmatter(raw: string): {
  description: string;
  tags?: string[];
  body: string;
} {
  if (!raw.startsWith("---")) return { description: "", body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { description: "", body: raw };
  const fm = raw.slice(3, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  let description = "";
  let tags: string[] | undefined;
  for (const line of fm.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1]!;
    let v = (m[2] ?? "").trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k === "description") description = v;
    if (k === "tags") {
      tags = v
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
  }
  return { description, tags, body };
}
