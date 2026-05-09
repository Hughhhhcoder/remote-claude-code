import { createSignal, createMemo, For, Show, onCleanup, onMount } from "solid-js";
import type {
  HookConfig,
  HookScope,
  HookEventName,
  HookAction,
} from "@rcc/protocol";
import { HOOK_EVENT_NAMES } from "@rcc/protocol";
import type { RccClient } from "./client.ts";

interface Props {
  client: RccClient;
}

type ScopeFilter = "all" | "user" | "project";

interface TestResult {
  scope: HookScope;
  event: HookEventName;
  index: number;
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated?: boolean;
}

const EVENT_COLOR: Record<HookEventName, { chip: string; dot: string }> = {
  PreToolUse: {
    chip: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
    dot: "bg-amber-400",
  },
  PostToolUse: {
    chip: "bg-rose-500/15 text-rose-400 border border-rose-500/20",
    dot: "bg-rose-400",
  },
  UserPromptSubmit: {
    chip: "bg-violet-500/15 text-violet-400 border border-violet-500/20",
    dot: "bg-violet-400",
  },
  Notification: {
    chip: "bg-sky-500/15 text-sky-400 border border-sky-500/20",
    dot: "bg-sky-400",
  },
  Stop: {
    chip: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
    dot: "bg-emerald-400",
  },
  SubagentStop: {
    chip: "bg-teal-500/15 text-teal-400 border border-teal-500/20",
    dot: "bg-teal-400",
  },
  SessionStart: {
    chip: "bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/20",
    dot: "bg-fuchsia-400",
  },
  SessionEnd: {
    chip: "bg-pink-500/15 text-pink-400 border border-pink-500/20",
    dot: "bg-pink-400",
  },
  PreCompact: {
    chip: "bg-zinc-600/25 text-zinc-300 border border-zinc-600/40",
    dot: "bg-zinc-400",
  },
};

const SCOPE_LABEL: Record<HookScope, string> = {
  user: "用户",
  project: "项目",
};

const SCOPE_CHIP: Record<HookScope, string> = {
  user: "bg-sky-500/10 text-sky-400 border border-sky-500/20",
  project: "bg-orange-500/20 text-orange-400 border border-orange-500/30",
};

export function HooksTab(props: Props) {
  const [configs, setConfigs] = createSignal<HookConfig[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [scopeFilter, setScopeFilter] = createSignal<ScopeFilter>("all");
  const [error, setError] = createSignal<string | null>(null);
  const [editorOpen, setEditorOpen] = createSignal<EditorState | null>(null);
  const [testResult, setTestResult] = createSignal<TestResult | null>(null);
  const [testing, setTesting] = createSignal<string | null>(null);
  const [expandedKey, setExpandedKey] = createSignal<string | null>(null);

  const unsub = props.client.on((frame) => {
    if (frame.t === "hook.list") {
      setConfigs(frame.configs);
      setLoaded(true);
    } else if (frame.t === "hook.written") {
      // list is broadcast separately
    } else if (frame.t === "hook.tested") {
      setTesting(null);
      setTestResult({
        scope: frame.scope,
        event: frame.event,
        index: frame.index,
        ok: frame.ok,
        stdout: frame.stdout,
        stderr: frame.stderr,
        exitCode: frame.exitCode,
        truncated: frame.truncated,
      });
    } else if (frame.t === "error" && frame.code?.startsWith("hook_")) {
      setError(frame.message);
      setTesting(null);
    }
  });
  onCleanup(unsub);

  onMount(() => {
    props.client.send({ v: 1, t: "hook.list.request", scope: "all" });
  });

  const filtered = createMemo(() => {
    const f = scopeFilter();
    if (f === "all") return configs();
    return configs().filter((c) => c.scope === f);
  });

  const byEvent = createMemo(() => {
    const map = new Map<HookEventName, HookConfig[]>();
    for (const ev of HOOK_EVENT_NAMES) map.set(ev, []);
    for (const c of filtered()) {
      map.get(c.event)!.push(c);
    }
    return map;
  });

  function refresh() {
    props.client.send({ v: 1, t: "hook.list.request", scope: "all" });
  }

  function keyOf(c: HookConfig): string {
    return `${c.scope}:${c.event}:${c.index}`;
  }

  function remove(c: HookConfig) {
    if (!confirm(`确认删除 ${c.event} [${c.matcher ?? "all"}] (${SCOPE_LABEL[c.scope]})？`)) return;
    props.client.send({
      v: 1,
      t: "hook.delete",
      scope: c.scope,
      event: c.event,
      index: c.index,
    });
  }

  function test(c: HookConfig, subIndex: number) {
    setTesting(`${keyOf(c)}:${subIndex}`);
    setTestResult(null);
    props.client.send({
      v: 1,
      t: "hook.test",
      scope: c.scope,
      event: c.event,
      index: c.index,
      hookIndex: subIndex,
    });
  }

  function openEditor(mode: "create" | "edit", existing?: HookConfig) {
    setError(null);
    if (mode === "create") {
      setEditorOpen({
        mode,
        scope: "user",
        event: "PreToolUse",
        originalIndex: -1,
        originalScope: "user",
        originalEvent: "PreToolUse",
        matcher: "",
        commands: [{ command: "", timeout: "" }],
      });
    } else if (existing) {
      setEditorOpen({
        mode,
        scope: existing.scope,
        event: existing.event,
        originalIndex: existing.index,
        originalScope: existing.scope,
        originalEvent: existing.event,
        matcher: existing.matcher ?? "",
        commands: existing.hooks.map((h) => ({
          command: h.command,
          timeout: h.timeout ? String(h.timeout) : "",
        })),
      });
    }
  }

  function submitEditor(state: EditorState) {
    const cleaned: HookAction[] = [];
    for (const row of state.commands) {
      const cmd = row.command.trim();
      if (!cmd) continue;
      const a: HookAction = { type: "command", command: cmd };
      const t = row.timeout.trim();
      if (t) {
        const n = Number(t);
        if (Number.isFinite(n) && n > 0) a.timeout = Math.floor(n);
      }
      cleaned.push(a);
    }
    if (cleaned.length === 0) {
      alert("至少需要一条命令");
      return;
    }
    // If scope or event changed in edit mode, delete from old location first, then append new.
    const movingEdit =
      state.mode === "edit" &&
      (state.scope !== state.originalScope || state.event !== state.originalEvent);

    if (movingEdit) {
      props.client.send({
        v: 1,
        t: "hook.delete",
        scope: state.originalScope,
        event: state.originalEvent,
        index: state.originalIndex,
      });
    }
    props.client.send({
      v: 1,
      t: "hook.write",
      scope: state.scope,
      event: state.event,
      index: state.mode === "edit" && !movingEdit ? state.originalIndex : -1,
      matcher: state.matcher.trim() || undefined,
      hooks: cleaned,
    });
    setEditorOpen(null);
  }

  const totalCount = createMemo(() => configs().length);

  return (
    <div>
      <div class="flex items-start justify-between mb-6">
        <div>
          <div class="flex items-center gap-2 mb-2">
            <h1 class="text-2xl font-semibold">Hooks</h1>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
              {totalCount()} hooks
            </span>
          </div>
          <p class="text-sm text-zinc-400 max-w-2xl">
            在 Claude 生命周期事件前后执行命令。改动写入
            <code class="mono text-xs px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-300 mx-1">~/.claude/settings.json</code>
            或项目目录下的 <code class="mono text-xs px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-300">.claude/settings.json</code>。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            onClick={refresh}
            class="px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 text-xs"
          >
            ⟳ 刷新
          </button>
          <button
            onClick={() => openEditor("create")}
            class="px-3 py-1.5 rounded-lg bg-gradient-to-r from-rose-500 to-pink-500 text-white text-xs font-medium"
          >
            + 新建 Hook
          </button>
        </div>
      </div>

      <div class="flex items-center gap-2 mb-5">
        <div class="flex rounded-lg bg-zinc-900 border border-zinc-800 p-0.5">
          <For each={["all", "user", "project"] as ScopeFilter[]}>
            {(s) => (
              <button
                onClick={() => setScopeFilter(s)}
                class={`px-3 py-1 text-[11px] rounded-md ${
                  scopeFilter() === s
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {s === "all" ? "全部" : SCOPE_LABEL[s as HookScope]}
              </button>
            )}
          </For>
        </div>
      </div>

      <Show when={error()}>
        <div class="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 px-4 py-2 text-xs flex items-center justify-between">
          <span class="font-mono truncate">{error()}</span>
          <button class="text-rose-200 hover:text-white ml-3" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      </Show>

      <Show when={testResult()}>
        {(r) => (
          <div class="mb-5 rounded-xl border border-zinc-800 bg-zinc-950/70 overflow-hidden">
            <div class="flex items-center justify-between px-4 py-2 border-b border-zinc-900">
              <div class="flex items-center gap-2 text-xs">
                <span
                  class={`w-1.5 h-1.5 rounded-full ${r().ok ? "bg-emerald-400" : "bg-rose-400"}`}
                ></span>
                <span class={r().ok ? "text-emerald-400" : "text-rose-400"}>
                  {r().ok ? "成功" : "失败"}
                </span>
                <span class="text-zinc-500">exit {r().exitCode ?? "—"}</span>
                <span class="text-zinc-600 mono">
                  {r().event}[{r().index}] · {SCOPE_LABEL[r().scope]}
                </span>
                <Show when={r().truncated}>
                  <span class="text-[10px] text-amber-400">(输出已截断)</span>
                </Show>
              </div>
              <button
                class="text-zinc-500 hover:text-zinc-200 text-xs"
                onClick={() => setTestResult(null)}
              >
                ✕
              </button>
            </div>
            <Show when={r().stdout}>
              <div class="px-4 py-2 border-b border-zinc-900">
                <div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">stdout</div>
                <pre class="mono text-[11px] text-zinc-300 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">{r().stdout}</pre>
              </div>
            </Show>
            <Show when={r().stderr}>
              <div class="px-4 py-2">
                <div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">stderr</div>
                <pre class="mono text-[11px] text-rose-300 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">{r().stderr}</pre>
              </div>
            </Show>
          </div>
        )}
      </Show>

      <Show
        when={loaded() && totalCount() > 0}
        fallback={
          <Show when={loaded()} fallback={<div class="text-xs text-zinc-500">加载中…</div>}>
            <div class="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-10 text-center">
              <div class="text-sm text-zinc-400">还没有配置任何 hook</div>
              <div class="text-xs text-zinc-600 mt-1">点击右上角 "+ 新建 Hook" 新建一个</div>
            </div>
          </Show>
        }
      >
        <div class="space-y-6 mb-12">
          <For each={HOOK_EVENT_NAMES}>
            {(ev) => {
              const items = () => byEvent().get(ev) ?? [];
              return (
                <Show when={items().length > 0}>
                  <section>
                    <div class="flex items-center gap-2 mb-2 px-1">
                      <span
                        class={`text-[10px] font-mono px-2 py-1 rounded ${EVENT_COLOR[ev].chip}`}
                      >
                        {ev}
                      </span>
                      <span class="text-[11px] text-zinc-500">{items().length} 条</span>
                    </div>
                    <div class="space-y-2">
                      <For each={items()}>
                        {(c) => {
                          const k = keyOf(c);
                          const isExpanded = () => expandedKey() === k;
                          return (
                            <div class="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
                              <div
                                class="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-zinc-900/60"
                                onClick={() => setExpandedKey(isExpanded() ? null : k)}
                              >
                                <div class="flex items-center gap-3 min-w-0">
                                  <span
                                    class={`text-[10px] px-1.5 py-0.5 rounded ${SCOPE_CHIP[c.scope]}`}
                                  >
                                    {SCOPE_LABEL[c.scope]}
                                  </span>
                                  <span class="text-[10px] mono text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800">
                                    {c.matcher || "all"}
                                  </span>
                                  <span class="text-xs text-zinc-500">
                                    {c.hooks.length} 条命令
                                  </span>
                                </div>
                                <div
                                  class="flex items-center gap-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    class="text-[11px] px-2 py-1 rounded text-zinc-400 hover:bg-zinc-800"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openEditor("edit", c);
                                    }}
                                  >
                                    ✎ 编辑
                                  </button>
                                  <button
                                    class="text-[11px] px-2 py-1 rounded text-rose-400 hover:bg-rose-500/10"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      remove(c);
                                    }}
                                    title="删除"
                                  >
                                    🗑
                                  </button>
                                  <button
                                    class="text-[11px] px-2 py-1 rounded text-zinc-400 hover:bg-zinc-800"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedKey(isExpanded() ? null : k);
                                    }}
                                  >
                                    {isExpanded() ? "收起" : "展开"}
                                  </button>
                                </div>
                              </div>
                              <Show when={isExpanded()}>
                                <div class="border-t border-zinc-800 bg-zinc-950/50">
                                  <For each={c.hooks}>
                                    {(h, i) => {
                                      const tk = `${k}:${i()}`;
                                      return (
                                        <div class="px-4 py-3 border-b border-zinc-900 last:border-b-0 flex items-start gap-3">
                                          <div class="flex-1 min-w-0">
                                            <div class="mono text-[11px] text-zinc-300 whitespace-pre-wrap break-all">
                                              <span class="text-zinc-600">$ </span>
                                              {h.command}
                                              <Show when={h.truncated}>
                                                <span class="text-amber-400 text-[10px] ml-2">(已截断)</span>
                                              </Show>
                                            </div>
                                            <Show when={h.timeout}>
                                              <div class="text-[10px] text-zinc-600 mt-1">
                                                timeout: {h.timeout}ms
                                              </div>
                                            </Show>
                                          </div>
                                          <button
                                            onClick={() => test(c, i())}
                                            disabled={testing() === tk}
                                            class="text-[11px] px-2 py-1 rounded text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                                            title="试运行一次"
                                          >
                                            🧪 {testing() === tk ? "运行中…" : "测试"}
                                          </button>
                                        </div>
                                      );
                                    }}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </section>
                </Show>
              );
            }}
          </For>
        </div>
      </Show>

      <details class="rounded-xl border border-zinc-800 bg-zinc-950/40 overflow-hidden">
        <summary class="px-4 py-3 flex items-center justify-between hover:bg-zinc-900/60 cursor-pointer">
          <div class="flex items-center gap-2 text-sm text-zinc-400">
            <span>▸</span> 可用的 Hook 事件类型
          </div>
          <span class="text-[11px] text-zinc-500">{HOOK_EVENT_NAMES.length} 种</span>
        </summary>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-2 p-4 border-t border-zinc-800 text-[11px]">
          <For each={HOOK_EVENT_NAMES}>
            {(ev) => (
              <div class={`px-2 py-1.5 rounded mono ${EVENT_COLOR[ev].chip}`}>{ev}</div>
            )}
          </For>
        </div>
      </details>

      <Show when={editorOpen()}>
        {(state) => (
          <HookEditor
            state={state()}
            onCancel={() => setEditorOpen(null)}
            onSubmit={submitEditor}
          />
        )}
      </Show>
    </div>
  );
}

interface CommandRow {
  command: string;
  timeout: string;
}

interface EditorState {
  mode: "create" | "edit";
  scope: HookScope;
  event: HookEventName;
  originalScope: HookScope;
  originalEvent: HookEventName;
  originalIndex: number;
  matcher: string;
  commands: CommandRow[];
}

function HookEditor(props: {
  state: EditorState;
  onCancel: () => void;
  onSubmit: (state: EditorState) => void;
}) {
  const [scope, setScope] = createSignal<HookScope>(props.state.scope);
  const [event, setEvent] = createSignal<HookEventName>(props.state.event);
  const [matcher, setMatcher] = createSignal(props.state.matcher);
  const [commands, setCommands] = createSignal<CommandRow[]>(props.state.commands);

  function setRow(i: number, field: keyof CommandRow, v: string) {
    setCommands((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
  }
  function addRow() {
    setCommands((prev) => [...prev, { command: "", timeout: "" }]);
  }
  function removeRow(i: number) {
    setCommands((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  function submit() {
    props.onSubmit({
      ...props.state,
      scope: scope(),
      event: event(),
      matcher: matcher(),
      commands: commands(),
    });
  }

  return (
    <div
      class="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm grid place-items-center"
      onClick={(e) => e.target === e.currentTarget && props.onCancel()}
    >
      <div class="w-[680px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-80px)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col">
        <div class="px-5 py-4 border-b border-zinc-900 flex items-center justify-between">
          <div>
            <div class="text-sm font-semibold">
              {props.state.mode === "create" ? "新建 Hook" : "编辑 Hook"}
            </div>
            <div class="text-xs text-zinc-500 mt-0.5">
              写入 <code class="mono">settings.json</code> 的 <code class="mono">hooks.{event()}</code>
            </div>
          </div>
          <button
            class="text-zinc-500 hover:text-zinc-200 text-sm px-2"
            onClick={props.onCancel}
          >
            ✕
          </button>
        </div>

        <div class="p-5 overflow-y-auto flex-1 space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
                Scope
              </label>
              <div class="flex rounded-lg bg-zinc-900 border border-zinc-800 p-0.5">
                <For each={["user", "project"] as HookScope[]}>
                  {(s) => (
                    <button
                      onClick={() => setScope(s)}
                      class={`flex-1 px-3 py-1 text-[11px] rounded-md ${
                        scope() === s
                          ? "bg-zinc-800 text-zinc-100"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {SCOPE_LABEL[s]}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <div>
              <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
                Event
              </label>
              <select
                value={event()}
                onChange={(e) => setEvent(e.currentTarget.value as HookEventName)}
                class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 outline-none focus:border-zinc-700"
              >
                <For each={HOOK_EVENT_NAMES}>
                  {(ev) => <option value={ev}>{ev}</option>}
                </For>
              </select>
            </div>
          </div>

          <div>
            <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
              Matcher（可选，regex / 工具名；PreToolUse / PostToolUse 才有意义）
            </label>
            <input
              value={matcher()}
              onInput={(e) => setMatcher(e.currentTarget.value)}
              placeholder="Bash | Edit|Write"
              class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 outline-none focus:border-zinc-700"
            />
          </div>

          <div>
            <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
              命令（每条会用 <code class="mono">sh -c</code> 执行）
            </label>
            <div class="space-y-2">
              <For each={commands()}>
                {(r, i) => (
                  <div class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2 space-y-1.5">
                    <div class="flex items-start gap-1">
                      <textarea
                        value={r.command}
                        onInput={(e) => setRow(i(), "command", e.currentTarget.value)}
                        placeholder="pnpm prettier --write &quot;$CLAUDE_FILE_PATHS&quot;"
                        rows={2}
                        class="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-zinc-100 outline-none resize-y min-h-[40px]"
                      />
                      <button
                        onClick={() => removeRow(i())}
                        disabled={commands().length <= 1}
                        class="px-2 py-1 text-zinc-500 hover:text-rose-400 disabled:opacity-30"
                        title="移除"
                      >
                        🗑
                      </button>
                    </div>
                    <div class="flex items-center gap-2 text-[11px]">
                      <label class="text-zinc-500">timeout (ms)</label>
                      <input
                        type="text"
                        inputmode="numeric"
                        value={r.timeout}
                        onInput={(e) => setRow(i(), "timeout", e.currentTarget.value)}
                        placeholder="10000"
                        class="w-28 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 mono text-zinc-100 outline-none"
                      />
                    </div>
                  </div>
                )}
              </For>
              <button onClick={addRow} class="text-[11px] text-sky-400 hover:underline">
                + 添加命令
              </button>
            </div>
          </div>
        </div>

        <div class="px-5 py-3 border-t border-zinc-900 flex items-center justify-end gap-2">
          <button
            onClick={props.onCancel}
            class="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200"
          >
            取消
          </button>
          <button
            onClick={submit}
            class="px-3 py-1.5 rounded-lg bg-gradient-to-r from-rose-500 to-pink-500 text-white text-xs font-medium"
          >
            {props.state.mode === "create" ? "创建" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
