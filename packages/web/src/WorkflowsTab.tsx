import { createSignal, createMemo, For, Show, onCleanup, onMount } from "solid-js";
import type { Workflow, WorkflowStep } from "@rcc/protocol";
import type { RccClient } from "./client.ts";
import type { WorkflowRunRequest } from "./workflow-runner.ts";

interface Props {
  client: RccClient;
  activeSid: string | null;
  onRun: (req: WorkflowRunRequest) => void;
}

type StepKind = WorkflowStep["kind"];

const STEP_KIND_LABEL: Record<StepKind, string> = {
  prompt: "Prompt",
  slash: "Slash",
  git: "Git",
  wait: "Wait",
};

interface EditorState {
  mode: "create" | "edit";
  id?: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  /**
   * [B25-C] Per-workflow variable map as an ordered pair list so the UI can
   * render stable rows even while the user edits a key. Serialized to
   * Record<string,string> on save (last-write wins for duplicate keys).
   */
  variables: Array<{ key: string; value: string }>;
  error?: string;
}

function cloneSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((s) => {
    if (s.kind === "git") return { kind: "git", args: [...s.args], condition: s.condition };
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

function stepSummary(s: WorkflowStep): string {
  switch (s.kind) {
    case "prompt":
      return s.text.length > 60 ? s.text.slice(0, 60) + "…" : s.text;
    case "slash":
      return `/${s.name}`;
    case "git":
      return `git ${s.args.join(" ")}`;
    case "wait":
      return `等待 ${s.seconds}s`;
  }
}

export function WorkflowsTab(props: Props) {
  const [workflows, setWorkflows] = createSignal<Workflow[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [editor, setEditor] = createSignal<EditorState | null>(null);

  const unsub = props.client.on((frame) => {
    if (frame.t === "workflow.list") {
      setWorkflows(frame.workflows);
      setLoaded(true);
    }
    if (frame.t === "workflow.saved") {
      const cur = editor();
      if (cur && (cur.id === frame.workflow.id || cur.mode === "create")) {
        setEditor(null);
      }
    }
  });
  onCleanup(unsub);

  onMount(() => {
    props.client.send({ v: 1, t: "workflow.list.request" });
  });

  function openCreate() {
    setEditor({
      mode: "create",
      name: "",
      description: "",
      steps: [blankStep("prompt")],
      variables: [],
    });
  }

  function openEdit(w: Workflow) {
    setEditor({
      mode: "edit",
      id: w.id,
      name: w.name,
      description: w.description ?? "",
      steps: cloneSteps(w.steps),
      variables: Object.entries(w.variables ?? {}).map(([key, value]) => ({
        key,
        value,
      })),
    });
  }

  function saveEditor() {
    const e = editor();
    if (!e) return;
    const name = e.name.trim();
    if (!name) {
      setEditor({ ...e, error: "请填写工作流名" });
      return;
    }
    if (!e.steps.length) {
      setEditor({ ...e, error: "至少需要一步" });
      return;
    }
    for (const [idx, s] of e.steps.entries()) {
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
    // [B25-C] serialize variables; drop empty keys, cap at 32, last-key-wins
    const varMap: Record<string, string> = {};
    for (const { key, value } of e.variables) {
      const k = key.trim();
      if (!k) continue;
      if (k.length > 64) {
        setEditor({ ...e, error: `变量名 "${k.slice(0, 16)}…" 过长 (>64)` });
        return;
      }
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) {
        setEditor({ ...e, error: `变量名 "${k}" 不合法 (字母/数字/下划线)` });
        return;
      }
      varMap[k] = value;
    }
    if (Object.keys(varMap).length > 32) {
      setEditor({ ...e, error: "变量数量超过 32" });
      return;
    }
    props.client.send({
      v: 1,
      t: "workflow.save",
      id: e.id,
      name,
      description: e.description.trim() || undefined,
      steps: e.steps,
      variables: Object.keys(varMap).length ? varMap : undefined,
    });
  }

  function removeWorkflow(w: Workflow) {
    if (!confirm(`删除工作流 "${w.name}"?`)) return;
    props.client.send({ v: 1, t: "workflow.remove", id: w.id });
  }

  function runWorkflow(w: Workflow) {
    const sid = props.activeSid;
    if (!sid) {
      alert("请先选中一个会话再运行");
      return;
    }
    props.onRun({ workflow: w, sid });
  }

  const list = createMemo(() => workflows());

  return (
    <div>
      <div class="flex items-start justify-between mb-6">
        <div>
          <div class="flex items-center gap-2 mb-2">
            <h1 class="text-2xl font-semibold">Workflows 工作流</h1>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-300 border border-teal-500/20">
              {list().length}
            </span>
          </div>
          <p class="text-sm text-zinc-400 max-w-2xl">
            把常用的 prompt / slash / git 串起来一键运行。
            每步按 <code class="font-mono bg-zinc-900 text-xs px-1.5 py-0.5 rounded text-teal-300">500ms</code> 间隔发出(或 wait step 指定秒数),
            <strong class="text-amber-300">不会等上一步完成</strong> — 长任务请插入 wait step。
          </p>
        </div>
        <button
          onClick={openCreate}
          class="px-3 py-1.5 rounded-lg bg-gradient-to-r from-teal-500 to-cyan-500 text-white text-xs font-medium hover:opacity-90"
        >
          + 新建工作流
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
                还没有工作流。点击右上角 “+ 新建” 开始。
              </div>
            }
          >
            <For each={list()}>
              {(w) => (
                <div class="px-4 py-3 border-b border-zinc-800 last:border-b-0 hover:bg-zinc-900/60 flex items-start gap-4">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="font-mono text-sm text-zinc-100 truncate">{w.name}</span>
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        {w.steps.length} 步
                      </span>
                    </div>
                    <Show when={w.description}>
                      <div class="text-xs text-zinc-400 mb-1.5">{w.description}</div>
                    </Show>
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <For each={w.steps}>
                        {(s, i) => (
                          <span
                            class={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                              s.kind === "prompt"
                                ? "bg-sky-500/10 border-sky-500/30 text-sky-300"
                                : s.kind === "slash"
                                ? "bg-violet-500/10 border-violet-500/30 text-violet-300"
                                : s.kind === "git"
                                ? "bg-orange-500/10 border-orange-500/30 text-orange-300"
                                : "bg-zinc-800 border-zinc-700 text-zinc-400"
                            }`}
                            title={stepSummary(s)}
                          >
                            {i() + 1}. {STEP_KIND_LABEL[s.kind]}
                          </span>
                        )}
                      </For>
                    </div>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => runWorkflow(w)}
                      class="text-xs px-2.5 py-1 rounded bg-teal-500/15 border border-teal-500/40 text-teal-300 hover:bg-teal-500/25"
                      title={props.activeSid ? "在当前会话运行" : "请先选中会话"}
                    >
                      ▶ 运行
                    </button>
                    <button
                      onClick={() => openEdit(w)}
                      class="text-xs px-2 py-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                      title="编辑"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => removeWorkflow(w)}
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

      <WorkflowEditor
        state={editor()}
        onChange={(s) => setEditor(s)}
        onSave={saveEditor}
        onCancel={() => setEditor(null)}
      />
    </div>
  );
}

function WorkflowEditor(props: {
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
                  {s().mode === "create" ? "新建工作流" : `编辑 ${s().name || "工作流"}`}
                </div>
                <div class="text-xs text-zinc-500 mt-0.5">
                  步骤按顺序发出,每步间隔 500ms(wait 步骤可自定义)。
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
                  placeholder="deploy-staging"
                  class="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm font-mono outline-none focus:border-zinc-700"
                />

                <label class="text-xs text-zinc-400">描述</label>
                <input
                  value={s().description}
                  onInput={(ev) => props.onChange({ ...s(), description: ev.currentTarget.value })}
                  placeholder="可选,描述这个工作流做什么"
                  class="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm outline-none focus:border-zinc-700"
                />
              </div>

              <VariablesEditor
                variables={s().variables}
                onChange={(next) => props.onChange({ ...s(), variables: next })}
              />

              <div>
                <div class="flex items-center justify-between mb-2">
                  <label class="text-xs text-zinc-400">步骤 ({s().steps.length})</label>
                  <div class="flex gap-1">
                    <AddStepButton kind="prompt" onAdd={(step) => props.onChange({ ...s(), steps: [...s().steps, step] })} />
                    <AddStepButton kind="slash" onAdd={(step) => props.onChange({ ...s(), steps: [...s().steps, step] })} />
                    <AddStepButton kind="git" onAdd={(step) => props.onChange({ ...s(), steps: [...s().steps, step] })} />
                    <AddStepButton kind="wait" onAdd={(step) => props.onChange({ ...s(), steps: [...s().steps, step] })} />
                  </div>
                </div>

                <div class="space-y-2">
                  <For each={s().steps}>
                    {(step, idx) => (
                      <StepRow
                        index={idx()}
                        step={step}
                        onChange={(next) => {
                          const copy = [...s().steps];
                          copy[idx()] = next;
                          props.onChange({ ...s(), steps: copy });
                        }}
                        onRemove={() => {
                          const copy = s().steps.filter((_, i) => i !== idx());
                          props.onChange({ ...s(), steps: copy });
                        }}
                        onMove={(dir) => {
                          const copy = [...s().steps];
                          const target = idx() + dir;
                          if (target < 0 || target >= copy.length) return;
                          const [moved] = copy.splice(idx(), 1);
                          copy.splice(target, 0, moved!);
                          props.onChange({ ...s(), steps: copy });
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
                class="text-sm px-3 py-1.5 rounded bg-gradient-to-r from-teal-500 to-cyan-500 text-white font-medium hover:opacity-90 disabled:opacity-50"
                onClick={props.onSave}
                disabled={!s().name.trim() || s().steps.length === 0}
              >
                {s().mode === "create" ? "创建" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}

function AddStepButton(props: { kind: StepKind; onAdd: (s: WorkflowStep) => void }) {
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
  // [B25-C] condition is optional on every step; preserve it through onChange
  // for the kind-specific editors by wrapping them with setField.
  function patchStep(next: WorkflowStep): void {
    const cond = props.step.condition;
    props.onChange(cond ? ({ ...next, condition: cond } as WorkflowStep) : next);
  }
  function setCondition(cond: string): void {
    const trimmed = cond.trim();
    const base = { ...props.step } as WorkflowStep;
    if (!trimmed) {
      delete (base as { condition?: string }).condition;
    } else {
      (base as { condition?: string }).condition = trimmed;
    }
    props.onChange(base);
  }
  return (
    <div class="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 flex items-start gap-3">
      <div class="w-6 text-center text-xs text-zinc-500 pt-1.5 font-mono shrink-0">
        {props.index + 1}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-1.5 flex items-center gap-2">
          <span>{STEP_KIND_LABEL[props.step.kind]}</span>
          <Show when={props.step.condition}>
            <span
              class="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 normal-case tracking-normal"
              title={`条件: ${props.step.condition}`}
            >
              if
            </span>
          </Show>
        </div>
        <Show when={props.step.kind === "prompt"}>
          <textarea
            value={(props.step as Extract<WorkflowStep, { kind: "prompt" }>).text}
            onInput={(ev) =>
              patchStep({ kind: "prompt", text: ev.currentTarget.value })
            }
            placeholder="发送给 Claude 的 prompt 文本 (支持 {{var}})"
            rows={3}
            class="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono outline-none focus:border-zinc-700 resize-y"
          />
        </Show>
        <Show when={props.step.kind === "slash"}>
          <div class="flex items-center gap-1.5">
            <span class="font-mono text-sm text-zinc-500">/</span>
            <input
              value={(props.step as Extract<WorkflowStep, { kind: "slash" }>).name}
              onInput={(ev) => patchStep({ kind: "slash", name: ev.currentTarget.value })}
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
                patchStep({
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
                patchStep({
                  kind: "wait",
                  seconds: Math.max(0, Math.min(600, Number(ev.currentTarget.value) || 0)),
                })
              }
              class="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs font-mono outline-none focus:border-zinc-700"
            />
            <span class="text-xs text-zinc-500">秒</span>
          </div>
        </Show>
        <div class="mt-2 flex items-center gap-1.5">
          <span
            class="text-[10px] text-zinc-500 font-mono shrink-0"
            title="可选:条件表达式。支持 == / != / contains / !contains,例如 ${env} == 'prod'"
          >
            if
          </span>
          <input
            value={props.step.condition ?? ""}
            onInput={(ev) => setCondition(ev.currentTarget.value)}
            placeholder="${env} == 'prod'  (留空=始终执行)"
            class="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-0.5 text-[11px] font-mono outline-none focus:border-zinc-700 text-amber-200 placeholder-zinc-600"
          />
        </div>
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

// [B25-C] Workflow-level variable map editor. Renders an ordered list of
// {key, value} rows so editing a key doesn't lose focus on every keystroke.
// Empty-key rows are allowed in-memory and filtered out at save time.
function VariablesEditor(props: {
  variables: Array<{ key: string; value: string }>;
  onChange: (next: Array<{ key: string; value: string }>) => void;
}) {
  function patchRow(idx: number, patch: Partial<{ key: string; value: string }>): void {
    const next = props.variables.map((row, i) => (i === idx ? { ...row, ...patch } : row));
    props.onChange(next);
  }
  function addRow(): void {
    props.onChange([...props.variables, { key: "", value: "" }]);
  }
  function removeRow(idx: number): void {
    props.onChange(props.variables.filter((_, i) => i !== idx));
  }
  return (
    <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <label class="text-xs text-zinc-400">变量 ({props.variables.length})</label>
          <span
            class="text-[10px] text-zinc-500"
            title="在步骤内用 {{name}} 引用;条件表达式内用 ${name}"
          >
            {`{{name}}`} / {"${name}"}
          </span>
        </div>
        <button
          onClick={addRow}
          class="text-[11px] px-2 py-1 rounded border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
        >
          + 变量
        </button>
      </div>
      <Show
        when={props.variables.length > 0}
        fallback={
          <div class="text-[11px] text-zinc-500 italic">
            可选:添加 key=value 以便在 prompt/slash/git/条件中替换。
          </div>
        }
      >
        <div class="space-y-1.5">
          <For each={props.variables}>
            {(row, idx) => (
              <div class="flex items-center gap-1.5">
                <input
                  value={row.key}
                  onInput={(ev) => patchRow(idx(), { key: ev.currentTarget.value })}
                  placeholder="name"
                  class="w-40 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs font-mono outline-none focus:border-zinc-700"
                />
                <span class="text-zinc-600 text-xs font-mono">=</span>
                <input
                  value={row.value}
                  onInput={(ev) => patchRow(idx(), { value: ev.currentTarget.value })}
                  placeholder="value"
                  class="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs font-mono outline-none focus:border-zinc-700"
                />
                <button
                  onClick={() => removeRow(idx())}
                  class="text-[11px] px-1.5 py-0.5 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10"
                  title="删除变量"
                >
                  ✕
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
