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
  /**
   * Fired when the user taps "使用此 starter" on a card. The caller (ConfigView
   * or App) is expected to close the config view and open NewSessionModal
   * with this starter pre-selected. If omitted, the component falls back to
   * dispatching a `rcc:use-starter` CustomEvent on window so App.tsx can
   * listen without a direct prop wiring.
   */
  onUseStarter?: (starterId: string) => void;
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

function stepSummary(step: WorkflowStep): string {
  switch (step.kind) {
    case "prompt":
      return step.text.length > 80 ? step.text.slice(0, 80) + "…" : step.text;
    case "slash":
      return "/" + step.name;
    case "git":
      return "git " + step.args.join(" ");
    case "wait":
      return `wait ${step.seconds}s`;
  }
}

export function StartersTab(props: Props) {
  const [starters, setStarters] = createSignal<Starter[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [editor, setEditor] = createSignal<EditorState | null>(null);
  const [previewId, setPreviewId] = createSignal<string | null>(null);

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

  function useStarter(s: Starter) {
    if (props.onUseStarter) {
      props.onUseStarter(s.id);
      return;
    }
    // Fallback: fire a window event so App.tsx (or any ancestor) can wire
    // the NewSessionModal open + starter pre-selection without a prop drill.
    try {
      window.dispatchEvent(
        new CustomEvent("rcc:use-starter", { detail: { starterId: s.id } }),
      );
    } catch {
      /* ignore */
    }
  }

  function togglePreview(id: string) {
    setPreviewId((cur) => (cur === id ? null : id));
  }

  const list = createMemo(() => starters());

  return (
    <div>
      <div class="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div class="min-w-0">
          <div class="flex items-center gap-2 mb-2">
            <h1 class="text-2xl font-semibold text-text-primary">Session Starter Kits</h1>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-accent-bg text-accent border border-accent/20">
              {list().length}
            </span>
          </div>
          <p class="text-sm text-text-secondary max-w-2xl">
            新建会话时选一个 starter，自动注入 system prompt、启用所需 skills、并运行首步指令。
            内置 3 条 (
            <span class="font-mono text-accent">Code Review</span> /
            <span class="font-mono text-accent"> Debug</span> /
            <span class="font-mono text-accent"> Plan</span>
            ) 不可删除，可复制为用户版再改。
          </p>
        </div>
        <button
          onClick={openCreate}
          class="min-h-[44px] px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition"
        >
          + 新建 Starter
        </button>
      </div>

      <Show
        when={loaded()}
        fallback={
          <div class="rounded-xl border border-border-subtle bg-bg-surface px-4 py-10 text-center text-sm text-text-muted">
            加载中…
          </div>
        }
      >
        <Show
          when={list().length > 0}
          fallback={
            <div class="rounded-xl border border-border-subtle bg-bg-surface px-4 py-10 text-center text-sm text-text-muted">
              暂无 starter。点击右上角 + 新建一个。
            </div>
          }
        >
          <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            <For each={list()}>
              {(s) => (
                <StarterCard
                  starter={s}
                  expanded={previewId() === s.id}
                  onTogglePreview={() => togglePreview(s.id)}
                  onUse={() => useStarter(s)}
                  onEdit={() => openEdit(s)}
                  onDuplicate={() => openDuplicate(s)}
                  onRemove={() => removeStarter(s)}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>

      <StarterEditor
        state={editor()}
        onChange={(s) => setEditor(s)}
        onSave={saveEditor}
        onCancel={() => setEditor(null)}
      />
    </div>
  );
}

function StarterCard(props: {
  starter: Starter;
  expanded: boolean;
  onTogglePreview: () => void;
  onUse: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const s = () => props.starter;
  const hasSystemPrompt = () => !!s().systemPrompt && s().systemPrompt!.trim().length > 0;
  const skills = () => s().enableSkills ?? [];
  const steps = () => s().firstSteps ?? [];

  return (
    <div
      class="rounded-xl border border-border-subtle bg-bg-surface hover:border-border-strong transition flex flex-col"
      classList={{
        "border-accent/40 shadow-[0_0_0_1px_rgb(var(--accent)/0.2)]": props.expanded,
      }}
    >
      {/* Header: icon + name + builtin */}
      <div class="flex items-start gap-3 p-4 pb-3">
        <div class="w-10 h-10 shrink-0 rounded-lg bg-bg-surfaceStrong border border-border-subtle grid place-items-center text-lg">
          {s().icon || (s().builtin ? "🔒" : "✨")}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-semibold text-sm text-text-primary truncate">{s().name}</span>
            <Show when={s().builtin}>
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-bg-surfaceStrong text-text-muted border border-border-subtle">
                内置
              </span>
            </Show>
          </div>
          <Show when={s().description}>
            <div class="text-xs text-text-secondary mt-1 line-clamp-2">{s().description}</div>
          </Show>
        </div>
      </div>

      {/* Chip row */}
      <div class="px-4 pb-3 flex flex-wrap gap-1.5">
        <Show when={hasSystemPrompt()}>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-accent-bg text-accent border border-accent/30">
            system prompt
          </span>
        </Show>
        <Show when={skills().length > 0}>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-warn/10 text-warn border border-warn/30">
            {skills().length} skills
          </span>
        </Show>
        <Show when={steps().length > 0}>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success border border-success/30">
            {steps().length} first steps
          </span>
        </Show>
        <Show when={s().permissionMode}>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-warn/10 text-warn border border-warn/30 font-mono">
            {s().permissionMode}
          </span>
        </Show>
        <Show when={!hasSystemPrompt() && skills().length === 0 && steps().length === 0 && !s().permissionMode}>
          <span class="text-[10px] text-text-muted italic">仅元数据</span>
        </Show>
      </div>

      {/* Inline preview */}
      <Show when={props.expanded}>
        <div class="mx-4 mb-3 rounded-lg border border-border-subtle bg-bg-page p-3 space-y-3">
          <Show when={hasSystemPrompt()}>
            <div>
              <div class="text-[10px] uppercase tracking-widest text-text-muted mb-1.5">
                system prompt
              </div>
              <div class="text-[11px] text-text-primary whitespace-pre-wrap break-words font-mono bg-bg-surface rounded border border-border-subtle px-2 py-1.5 max-h-40 overflow-y-auto">
                {s().systemPrompt}
              </div>
            </div>
          </Show>
          <Show when={skills().length > 0}>
            <div>
              <div class="text-[10px] uppercase tracking-widest text-text-muted mb-1.5">
                enabled skills ({skills().length})
              </div>
              <div class="flex flex-wrap gap-1.5">
                <For each={skills()}>
                  {(sk) => (
                    <span class="text-[11px] font-mono px-1.5 py-0.5 rounded bg-bg-surface border border-border-subtle text-text-secondary">
                      {sk}
                    </span>
                  )}
                </For>
              </div>
            </div>
          </Show>
          <Show when={steps().length > 0}>
            <div>
              <div class="text-[10px] uppercase tracking-widest text-text-muted mb-1.5">
                first steps ({steps().length})
              </div>
              <ol class="space-y-1.5">
                <For each={steps()}>
                  {(step, idx) => (
                    <li class="flex items-start gap-2 text-[11px]">
                      <span class="shrink-0 w-5 h-5 rounded-full bg-bg-surfaceStrong border border-border-subtle grid place-items-center text-[10px] font-mono text-text-muted">
                        {idx() + 1}
                      </span>
                      <div class="flex-1 min-w-0">
                        <span class="text-[9px] uppercase tracking-widest text-text-muted mr-1.5">
                          {STEP_KIND_LABEL[step.kind]}
                        </span>
                        <span class="font-mono text-text-primary break-words">
                          {stepSummary(step)}
                        </span>
                      </div>
                    </li>
                  )}
                </For>
              </ol>
            </div>
          </Show>
          <Show when={!hasSystemPrompt() && skills().length === 0 && steps().length === 0}>
            <div class="text-[11px] text-text-muted italic text-center py-2">
              该 starter 不注入任何 prompt/skill/步骤，仅改会话默认值。
            </div>
          </Show>
        </div>
      </Show>

      {/* Actions footer */}
      <div class="mt-auto px-3 py-2.5 border-t border-border-subtle flex items-center gap-1.5">
        <button
          onClick={props.onUse}
          class="flex-1 min-h-[44px] px-3 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-hover transition"
          title="用此 starter 开新会话"
        >
          使用此 starter
        </button>
        <button
          onClick={props.onTogglePreview}
          class="min-h-[44px] min-w-[44px] px-3 py-2 rounded-lg border border-border-subtle text-xs text-text-secondary hover:text-text-primary hover:border-border-strong transition"
          title={props.expanded ? "收起预览" : "预览内容"}
          aria-expanded={props.expanded}
        >
          {props.expanded ? "收起" : "预览"}
        </button>
        <Show when={s().builtin}>
          <button
            onClick={props.onDuplicate}
            class="min-h-[44px] min-w-[44px] px-2 py-2 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-border-strong transition"
            title="复制为用户版"
            aria-label="复制"
          >
            ⎘
          </button>
        </Show>
        <Show when={!s().builtin}>
          <button
            onClick={props.onEdit}
            class="min-h-[44px] min-w-[44px] px-2 py-2 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-border-strong transition"
            title="编辑"
            aria-label="编辑"
          >
            ✎
          </button>
          <button
            onClick={props.onRemove}
            class="min-h-[44px] min-w-[44px] px-2 py-2 rounded-lg border border-border-subtle text-text-muted hover:text-danger hover:border-danger/40 transition"
            title="删除"
            aria-label="删除"
          >
            🗑
          </button>
        </Show>
      </div>
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
          class="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm grid place-items-center p-2"
          onClick={(ev) => ev.target === ev.currentTarget && props.onCancel()}
        >
          <div class="w-[760px] max-w-[calc(100vw-16px)] max-h-[calc(100svh-16px)] rounded-2xl border border-border-subtle bg-bg-surface shadow-2xl overflow-hidden flex flex-col">
            <div class="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-text-primary">
                  {s().mode === "create"
                    ? "新建 Starter"
                    : s().mode === "duplicate"
                    ? "复制 Starter"
                    : `编辑 ${s().name || "Starter"}`}
                </div>
                <div class="text-xs text-text-muted mt-0.5">
                  打包 systemPrompt + skills + 首步指令一键开会话
                </div>
              </div>
              <button
                class="min-h-[44px] min-w-[44px] text-text-muted hover:text-text-primary text-sm px-2 rounded-lg"
                onClick={props.onCancel}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <div class="p-5 overflow-y-auto flex-1 space-y-4">
              <div class="grid gap-3 sm:grid-cols-[auto_1fr_auto_1fr] sm:items-center">
                <label class="text-xs text-text-secondary sm:text-right">名称</label>
                <input
                  value={s().name}
                  onInput={(ev) => props.onChange({ ...s(), name: ev.currentTarget.value, error: undefined })}
                  placeholder="My Starter"
                  class="bg-bg-surfaceStrong border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                />
                <label class="text-xs text-text-secondary sm:text-right">图标</label>
                <input
                  value={s().icon}
                  onInput={(ev) => props.onChange({ ...s(), icon: ev.currentTarget.value })}
                  placeholder="🚀"
                  maxLength={4}
                  class="bg-bg-surfaceStrong border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent sm:w-24"
                />

                <label class="text-xs text-text-secondary sm:text-right">描述</label>
                <input
                  value={s().description}
                  onInput={(ev) => props.onChange({ ...s(), description: ev.currentTarget.value })}
                  placeholder="一句话说明这个 starter 是干嘛的"
                  class="sm:col-span-3 bg-bg-surfaceStrong border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                />
              </div>

              <div>
                <label class="block text-xs text-text-secondary mb-1.5">System Prompt (可选)</label>
                <textarea
                  value={s().systemPrompt}
                  onInput={(ev) => props.onChange({ ...s(), systemPrompt: ev.currentTarget.value })}
                  placeholder="你是严格的代码审查者..."
                  rows={4}
                  class="w-full bg-bg-surfaceStrong border border-border-subtle rounded-lg px-3 py-2 text-xs font-mono text-text-primary outline-none focus:border-accent resize-y"
                />
                <div class="text-[10px] text-text-muted mt-1">
                  Session 创建后，客户端会把这段文字作为第一条消息发给 Claude
                </div>
              </div>

              <div>
                <label class="block text-xs text-text-secondary mb-1.5">启用的 Skills (可选)</label>
                <input
                  value={s().enableSkills}
                  onInput={(ev) => props.onChange({ ...s(), enableSkills: ev.currentTarget.value })}
                  placeholder="user:geo-audit, project:my-skill (逗号分隔)"
                  class="w-full bg-bg-surfaceStrong border border-border-subtle rounded-lg px-3 py-2 text-xs font-mono text-text-primary outline-none focus:border-accent"
                />
                <div class="text-[10px] text-text-muted mt-1">若当前禁用，客户端会自动开启</div>
              </div>

              <div>
                <label class="block text-xs text-text-secondary mb-1.5">Permission Mode (可选)</label>
                <select
                  value={s().permissionMode}
                  onChange={(ev) =>
                    props.onChange({
                      ...s(),
                      permissionMode: ev.currentTarget.value as PermissionMode | "",
                    })
                  }
                  class="bg-bg-surfaceStrong border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary outline-none focus:border-accent"
                >
                  <option value="">(不覆盖)</option>
                  <For each={PERMISSION_MODES}>
                    {(m) => <option value={m}>{PERMISSION_MODE_INFO[m].label} — {m}</option>}
                  </For>
                </select>
              </div>

              <div>
                <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <label class="text-xs text-text-secondary">First Steps ({s().firstSteps.length})</label>
                  <div class="flex gap-1 flex-wrap">
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
                <div class="text-xs text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
                  {s().error}
                </div>
              </Show>
            </div>

            <div class="px-5 py-3 border-t border-border-subtle flex items-center justify-end gap-2">
              <button
                class="min-h-[44px] text-sm px-4 py-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surfaceStrong transition"
                onClick={props.onCancel}
              >
                取消
              </button>
              <button
                class="min-h-[44px] text-sm px-4 py-2 rounded-lg bg-accent text-white font-medium hover:bg-accent-hover transition disabled:opacity-50"
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
      class="text-[11px] min-h-[32px] px-2 py-1 rounded-lg border border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong transition"
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
    <div class="rounded-lg border border-border-subtle bg-bg-surfaceStrong p-3 flex items-start gap-3">
      <div class="w-6 text-center text-xs text-text-muted pt-1.5 font-mono shrink-0">
        {props.index + 1}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[10px] uppercase tracking-widest text-text-muted mb-1.5">
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
            class="w-full bg-bg-surface border border-border-subtle rounded-lg px-2 py-1.5 text-xs font-mono text-text-primary outline-none focus:border-accent resize-y"
          />
        </Show>
        <Show when={props.step.kind === "slash"}>
          <div class="flex items-center gap-1.5">
            <span class="font-mono text-sm text-text-muted">/</span>
            <input
              value={(props.step as Extract<WorkflowStep, { kind: "slash" }>).name}
              onInput={(ev) => props.onChange({ kind: "slash", name: ev.currentTarget.value })}
              placeholder="review"
              class="flex-1 bg-bg-surface border border-border-subtle rounded-lg px-2 py-1.5 text-xs font-mono text-text-primary outline-none focus:border-accent"
            />
          </div>
        </Show>
        <Show when={props.step.kind === "git"}>
          <div class="flex items-center gap-1.5">
            <span class="font-mono text-sm text-text-muted">git</span>
            <input
              value={(props.step as Extract<WorkflowStep, { kind: "git" }>).args.join(" ")}
              onInput={(ev) =>
                props.onChange({
                  kind: "git",
                  args: ev.currentTarget.value.split(/\s+/).filter(Boolean),
                })
              }
              placeholder="status --short"
              class="flex-1 bg-bg-surface border border-border-subtle rounded-lg px-2 py-1.5 text-xs font-mono text-text-primary outline-none focus:border-accent"
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
              class="w-24 bg-bg-surface border border-border-subtle rounded-lg px-2 py-1.5 text-xs font-mono text-text-primary outline-none focus:border-accent"
            />
            <span class="text-xs text-text-muted">秒</span>
          </div>
        </Show>
      </div>
      <div class="flex flex-col gap-1 shrink-0">
        <button
          onClick={() => props.onMove(-1)}
          class="text-[11px] min-w-[28px] min-h-[28px] px-1.5 py-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-surface transition"
          title="上移"
          aria-label="上移"
        >
          ↑
        </button>
        <button
          onClick={() => props.onMove(1)}
          class="text-[11px] min-w-[28px] min-h-[28px] px-1.5 py-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-surface transition"
          title="下移"
          aria-label="下移"
        >
          ↓
        </button>
        <button
          onClick={props.onRemove}
          class="text-[11px] min-w-[28px] min-h-[28px] px-1.5 py-0.5 rounded text-text-muted hover:text-danger hover:bg-danger/10 transition"
          title="删除"
          aria-label="删除"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
