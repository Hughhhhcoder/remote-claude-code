import { createSignal, createMemo, For, Show, onCleanup, onMount } from "solid-js";
import {
  PERMISSION_MODES,
  PERMISSION_MODE_INFO,
  type PermissionMode,
  type Starter,
  type WorkflowStep,
} from "@rcc/protocol";
import type { RccClient } from "./client.ts";

interface Props {
  client: RccClient;
}

type StepKind = WorkflowStep["kind"];

const STEP_KIND_LABEL: Record<StepKind, string> = {
  prompt: "Prompt",
  slash: "Slash",
  git: "Git",
  wait: "Wait",
};

interface EditorState {
  mode: "create" | "edit" | "duplicate";
  id?: string;
  name: string;
  description: string;
  systemPrompt: string;
  enableSkills: string;
  firstSteps: WorkflowStep[];
  permissionMode: PermissionMode | "";
  icon: string;
  color: string;
  error?: string;
}

function cloneSteps(steps: WorkflowStep[] | undefined): WorkflowStep[] {
  if (!steps) return [];
  return steps.map((s) => {
    if (s.kind === "git") return { kind: "git", args: [...s.args] };
    return { ...s } as WorkflowStep;
  });
}

function blankStep(kind: StepKind): WorkflowStep {
  switch (kind) {
    case "prompt":
      return { kind: "prompt", text: "" };
    case "slash":
      return { kind: "slash", name: "" };
    case "git":
      return { kind: "git", args: ["status"] };
    case "wait":
      return { kind: "wait", seconds: 2 };
  }
}

export function StartersTab(props: Props) {
  const [starters, setStarters] = createSignal<Starter[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [editor, setEditor] = createSignal<EditorState | null>(null);

  const unsub = props.client.on((frame) => {
    if (frame.t === "starter.list") {
      setStarters(frame.starters);
      setLoaded(true);
    }
    if (frame.t === "starter.saved") {
      setEditor(null);
    }
  });
  onCleanup(unsub);

  onMount(() => {
    props.client.send({ v: 1, t: "starter.list.request" });
  });

  function openCreate() {
    setEditor({
      mode: "create",
      name: "",
      description: "",
      systemPrompt: "",
      enableSkills: "",
      firstSteps: [],
      permissionMode: "",
      icon: "",
      color: "",
    });
  }

  function openEdit(s: Starter) {
    setEditor({
      mode: "edit",
      id: s.id,
      name: s.name,
      description: s.description ?? "",
      systemPrompt: s.systemPrompt ?? "",
      enableSkills: (s.enableSkills ?? []).join(", "),
      firstSteps: cloneSteps(s.firstSteps),
      permissionMode: s.permissionMode ?? "",
      icon: s.icon ?? "",
      color: s.color ?? "",
    });
  }

  function openDuplicate(s: Starter) {
    setEditor({
      mode: "duplicate",
      name: s.name + " (copy)",
      description: s.description ?? "",
      systemPrompt: s.systemPrompt ?? "",
      enableSkills: (s.enableSkills ?? []).join(", "),
      firstSteps: cloneSteps(s.firstSteps),
      permissionMode: s.permissionMode ?? "",
      icon: s.icon ?? "",
      color: s.color ?? "",
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
    const skills = e.enableSkills
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const [idx, s] of e.firstSteps.entries()) {
      if (s.kind === "prompt" && !s.text.trim()) {
        setEditor({ ...e, error: `第 ${idx + 1} 步 prompt 为空` });
        return;
      }
      if (s.kind === "slash" && !/^[a-z0-9][a-z0-9:_-]*$/i.test(s.name.trim())) {
        setEditor({ ...e, error: `第 ${idx + 1} 步 slash 命令名无效` });
        return;
      }
      if (s.kind === "git" && (!s.args.length || !s.args[0]!.trim())) {
        setEditor({ ...e, error: `第 ${idx + 1} 步 git 参数为空` });
        return;
      }
    }
    props.client.send({
      v: 1,
      t: "starter.save",
      id: e.mode === "edit" ? e.id : undefined,
      name,
      description: e.description.trim() || undefined,
      systemPrompt: e.systemPrompt.trim() || undefined,
      enableSkills: skills.length ? skills : undefined,
      firstSteps: e.firstSteps.length ? e.firstSteps : undefined,
      permissionMode: e.permissionMode || undefined,
      icon: e.icon.trim() || undefined,
      color: e.color.trim() || undefined,
    });
  }

  function removeStarter(s: Starter) {
    if (s.builtin) return;
    if (!confirm(`删除 starter "${s.name}"?`)) return;
    props.client.send({ v: 1, t: "starter.remove", id: s.id });
  }

  const list = createMemo(() => starters());

  return (
    <div>
      <div class="flex items-start justify-between mb-6">
        <div>
          <div class="flex items-center gap-2 mb-2">
            <h1 class="text-2xl font-semibold">Session Starter Kits</h1>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
              {list().length}
            </span>
          </div>
          <p class="text-sm text-zinc-400 max-w-2xl">
            新建会话时选一个 starter,自动注入 system prompt、启用所需 skills、并运行首步指令。
            内置 3 条 (
            <span class="font-mono text-indigo-300">Code Review</span> /
            <span class="font-mono text-indigo-300"> Debug</span> /
            <span class="font-mono text-indigo-300"> Plan</span>
            ) 不可删除,可复制为用户版再改。
          </p>
        </div>
        <button
          onClick={openCreate}
          class="px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-xs font-medium hover:opacity-90"
        >
          + 新建 Starter
        </button>
      </div>

      <div class="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden mb-8">
        <Show
          when={loaded()}
          fallback={<div class="px-4 py-10 text-center text-sm text-zinc-500">加载中…</div>}
        >
          <For each={list()}>
            {(s) => (
              <div class="px-4 py-3 border-b border-zinc-800 last:border-b-0 hover:bg-zinc-900/60 flex items-start gap-4">
                <div class="w-8 h-8 shrink-0 rounded-lg bg-zinc-800 grid place-items-center text-base">
                  {s.icon || (s.builtin ? "🔒" : "✨")}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1 flex-wrap">
                    <span class="font-mono text-sm text-zinc-100 truncate">{s.name}</span>
                    <Show when={s.builtin}>
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                        内置
                      </span>
                    </Show>
                    <Show when={s.permissionMode}>
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 font-mono">
                        {s.permissionMode}
                      </span>
                    </Show>
                    <Show when={s.enableSkills && s.enableSkills.length > 0}>
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-300 border border-orange-500/30">
                        {s.enableSkills!.length} skills
                      </span>
                    </Show>
                    <Show when={s.firstSteps && s.firstSteps.length > 0}>
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-300 border border-teal-500/30">
                        {s.firstSteps!.length} steps
                      </span>
                    </Show>
                  </div>
                  <Show when={s.description}>
                    <div class="text-xs text-zinc-400 mb-1.5">{s.description}</div>
                  </Show>
                  <Show when={s.systemPrompt}>
                    <div class="text-[11px] text-zinc-500 whitespace-pre-wrap break-words line-clamp-2 bg-zinc-950/50 rounded border border-zinc-900 px-2 py-1.5 font-mono">
                      {s.systemPrompt!.length > 180 ? s.systemPrompt!.slice(0, 180) + "…" : s.systemPrompt}
                    </div>
                  </Show>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <Show when={s.builtin}>
                    <button
                      onClick={() => openDuplicate(s)}
                      class="text-xs px-2 py-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                      title="复制为用户版"
                    >
                      ⎘
                    </button>
                  </Show>
                  <Show when={!s.builtin}>
                    <button
                      onClick={() => openEdit(s)}
                      class="text-xs px-2 py-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                      title="编辑"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => removeStarter(s)}
                      class="text-xs px-2 py-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10"
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
      </div>

      <StarterEditor
        state={editor()}
        onChange={(s) => setEditor(s)}
        onSave={saveEditor}
        onCancel={() => setEditor(null)}
      />
    </div>
  );
}

function StarterEditor(props: {
  state: EditorState | null;
  onChange: (s: EditorState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Show when={props.state}>
      {(s) => (
        <div
          class="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm grid place-items-center"
          onClick={(ev) => ev.target === ev.currentTarget && props.onCancel()}
        >
          <div class="w-[760px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-64px)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col">
            <div class="px-5 py-4 border-b border-zinc-900 flex items-center justify-between">
              <div>
                <div class="text-sm font-semibold">
                  {s().mode === "create"
                    ? "新建 Starter"
                    : s().mode === "duplicate"
                    ? "复制 Starter"
                    : `编辑 ${s().name || "Starter"}`}
                </div>
                <div class="text-xs text-zinc-500 mt-0.5">
                  打包 systemPrompt + skills + 首步指令一键开会话
                </div>
              </div>
              <button class="text-zinc-500 hover:text-zinc-200 text-sm px-2" onClick={props.onCancel}>
                ✕
              </button>
            </div>

            <div class="p-5 overflow-y-auto flex-1 space-y-4">
              <div class="grid grid-cols-[auto_1fr_auto_1fr] gap-3 items-center">
                <label class="text-xs text-zinc-400">名称</label>
                <input
                  value={s().name}
                  onInput={(ev) => props.onChange({ ...s(), name: ev.currentTarget.value, error: undefined })}
                  placeholder="My Starter"
                  class="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm outline-none focus:border-zinc-700"
                />
                <label class="text-xs text-zinc-400">图标</label>
                <input
                  value={s().icon}
                  onInput={(ev) => props.onChange({ ...s(), icon: ev.currentTarget.value })}
                  placeholder="🚀"
                  maxLength={4}
                  class="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm outline-none focus:border-zinc-700 w-20"
                />

                <label class="text-xs text-zinc-400">描述</label>
                <input
                  value={s().description}
                  onInput={(ev) => props.onChange({ ...s(), description: ev.currentTarget.value })}
                  placeholder="一句话说明这个 starter 是干嘛的"
                  class="col-span-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm outline-none focus:border-zinc-700"
                />
              </div>

              <div>
                <label class="block text-xs text-zinc-400 mb-1.5">System Prompt (可选)</label>
                <textarea
                  value={s().systemPrompt}
                  onInput={(ev) => props.onChange({ ...s(), systemPrompt: ev.currentTarget.value })}
                  placeholder="你是严格的代码审查者..."
                  rows={4}
                  class="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs font-mono outline-none focus:border-zinc-700 resize-y"
                />
                <div class="text-[10px] text-zinc-500 mt-1">
                  Session 创建后,客户端会把这段文字作为第一条消息发给 Claude
                </div>
              </div>

              <div>
                <label class="block text-xs text-zinc-400 mb-1.5">启用的 Skills (可选)</label>
                <input
                  value={s().enableSkills}
                  onInput={(ev) => props.onChange({ ...s(), enableSkills: ev.currentTarget.value })}
                  placeholder="user:geo-audit, project:my-skill (逗号分隔)"
                  class="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-xs font-mono outline-none focus:border-zinc-700"
                />
                <div class="text-[10px] text-zinc-500 mt-1">
                  若当前禁用,客户端会自动开启
                </div>
              </div>

              <div>
                <label class="block text-xs text-zinc-400 mb-1.5">Permission Mode (可选)</label>
                <select
                  value={s().permissionMode}
                  onChange={(ev) =>
                    props.onChange({
                      ...s(),
                      permissionMode: ev.currentTarget.value as PermissionMode | "",
                    })
                  }
                  class="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-xs outline-none focus:border-zinc-700"
                >
                  <option value="">(不覆盖)</option>
                  <For each={PERMISSION_MODES}>
                    {(m) => <option value={m}>{PERMISSION_MODE_INFO[m].label} — {m}</option>}
                  </For>
                </select>
              </div>

              <div>
                <div class="flex items-center justify-between mb-2">
                  <label class="text-xs text-zinc-400">First Steps ({s().firstSteps.length})</label>
                  <div class="flex gap-1">
                    <AddStepBtn kind="prompt" onAdd={(step) => props.onChange({ ...s(), firstSteps: [...s().firstSteps, step] })} />
                    <AddStepBtn kind="slash" onAdd={(step) => props.onChange({ ...s(), firstSteps: [...s().firstSteps, step] })} />
                    <AddStepBtn kind="git" onAdd={(step) => props.onChange({ ...s(), firstSteps: [...s().firstSteps, step] })} />
                    <AddStepBtn kind="wait" onAdd={(step) => props.onChange({ ...s(), firstSteps: [...s().firstSteps, step] })} />
                  </div>
                </div>
                <div class="space-y-2">
                  <For each={s().firstSteps}>
                    {(step, idx) => (
                      <StepRow
                        index={idx()}
                        step={step}
                        onChange={(next) => {
                          const copy = [...s().firstSteps];
                          copy[idx()] = next;
                          props.onChange({ ...s(), firstSteps: copy });
                        }}
                        onRemove={() => {
                          const copy = s().firstSteps.filter((_, i) => i !== idx());
                          props.onChange({ ...s(), firstSteps: copy });
                        }}
                        onMove={(dir) => {
                          const copy = [...s().firstSteps];
                          const target = idx() + dir;
                          if (target < 0 || target >= copy.length) return;
                          const [moved] = copy.splice(idx(), 1);
                          copy.splice(target, 0, moved!);
                          props.onChange({ ...s(), firstSteps: copy });
                        }}
                      />
                    )}
                  </For>
                </div>
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
                class="text-sm px-3 py-1.5 rounded bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-medium hover:opacity-90 disabled:opacity-50"
                onClick={props.onSave}
                disabled={!s().name.trim()}
              >
                {s().mode === "edit" ? "保存" : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}

function AddStepBtn(props: { kind: StepKind; onAdd: (s: WorkflowStep) => void }) {
  return (
    <button
      onClick={() => props.onAdd(blankStep(props.kind))}
      class="text-[11px] px-2 py-1 rounded border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
    >
      + {STEP_KIND_LABEL[props.kind]}
    </button>
  );
}

function StepRow(props: {
  index: number;
  step: WorkflowStep;
  onChange: (s: WorkflowStep) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div class="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 flex items-start gap-3">
      <div class="w-6 text-center text-xs text-zinc-500 pt-1.5 font-mono shrink-0">
        {props.index + 1}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-1.5">
          {STEP_KIND_LABEL[props.step.kind]}
        </div>
        <Show when={props.step.kind === "prompt"}>
          <textarea
            value={(props.step as Extract<WorkflowStep, { kind: "prompt" }>).text}
            onInput={(ev) =>
              props.onChange({ kind: "prompt", text: ev.currentTarget.value })
            }
            placeholder="发送给 Claude 的 prompt 文本"
            rows={2}
            class="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono outline-none focus:border-zinc-700 resize-y"
          />
        </Show>
        <Show when={props.step.kind === "slash"}>
          <div class="flex items-center gap-1.5">
            <span class="font-mono text-sm text-zinc-500">/</span>
            <input
              value={(props.step as Extract<WorkflowStep, { kind: "slash" }>).name}
              onInput={(ev) => props.onChange({ kind: "slash", name: ev.currentTarget.value })}
              placeholder="review"
              class="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs font-mono outline-none focus:border-zinc-700"
            />
          </div>
        </Show>
        <Show when={props.step.kind === "git"}>
          <div class="flex items-center gap-1.5">
            <span class="font-mono text-sm text-zinc-500">git</span>
            <input
              value={(props.step as Extract<WorkflowStep, { kind: "git" }>).args.join(" ")}
              onInput={(ev) =>
                props.onChange({
                  kind: "git",
                  args: ev.currentTarget.value.split(/\s+/).filter(Boolean),
                })
              }
              placeholder="status --short"
              class="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs font-mono outline-none focus:border-zinc-700"
            />
          </div>
        </Show>
        <Show when={props.step.kind === "wait"}>
          <div class="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="600"
              step="0.5"
              value={(props.step as Extract<WorkflowStep, { kind: "wait" }>).seconds}
              onInput={(ev) =>
                props.onChange({
                  kind: "wait",
                  seconds: Math.max(0, Math.min(600, Number(ev.currentTarget.value) || 0)),
                })
              }
              class="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs font-mono outline-none focus:border-zinc-700"
            />
            <span class="text-xs text-zinc-500">秒</span>
          </div>
        </Show>
      </div>
      <div class="flex flex-col gap-1 shrink-0">
        <button
          onClick={() => props.onMove(-1)}
          class="text-[11px] px-1.5 py-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
          title="上移"
        >
          ↑
        </button>
        <button
          onClick={() => props.onMove(1)}
          class="text-[11px] px-1.5 py-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
          title="下移"
        >
          ↓
        </button>
        <button
          onClick={props.onRemove}
          class="text-[11px] px-1.5 py-0.5 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10"
          title="删除"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
