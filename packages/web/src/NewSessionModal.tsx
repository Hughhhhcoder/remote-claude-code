import { createEffect, createSignal, For, Show } from "solid-js";
import {
  PERMISSION_MODES,
  PERMISSION_MODE_INFO,
  type PermissionMode,
  type ProjectMeta,
  type SessionDriver,
  type Starter,
} from "@rcc/protocol";
import { t } from "./i18n/index.ts";

interface Props {
  open: boolean;
  defaultCwd: string;
  defaultMode: PermissionMode;
  projects: ProjectMeta[];
  defaultProjectId: string | null;
  starters: Starter[];
  onCancel: () => void;
  onConfirm: (opts: {
    cwd: string;
    permissionMode: PermissionMode;
    projectId: string | null;
    driver: SessionDriver;
    starterId: string | null;
  }) => void;
}

const TONE_CLASSES: Record<string, string> = {
  safe: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
  neutral: "border-sky-500/30 bg-sky-500/5 text-sky-300",
  warn: "border-amber-500/30 bg-amber-500/5 text-amber-300",
  danger: "border-rose-500/30 bg-rose-500/5 text-rose-300",
};

const TONE_ACTIVE: Record<string, string> = {
  safe: "border-emerald-400 bg-emerald-500/20 text-emerald-200",
  neutral: "border-sky-400 bg-sky-500/20 text-sky-200",
  warn: "border-amber-400 bg-amber-500/20 text-amber-200",
  danger: "border-rose-400 bg-rose-500/20 text-rose-200",
};

export function NewSessionModal(props: Props) {
  const [cwd, setCwd] = createSignal(props.defaultCwd);
  const [mode, setMode] = createSignal<PermissionMode>(props.defaultMode);
  const [projectId, setProjectId] = createSignal<string | null>(props.defaultProjectId);
  const [driver, setDriver] = createSignal<SessionDriver>("cli");
  const [starterId, setStarterId] = createSignal<string | null>(null);
  // Track whether the user manually edited cwd, so switching projects doesn't
  // clobber an intentional override.
  const [cwdDirty, setCwdDirty] = createSignal(false);

  createEffect(() => {
    if (props.open) {
      setProjectId(props.defaultProjectId);
      setCwdDirty(false);
      setCwd("");
      setDriver("cli");
      setStarterId(null);
      setMode(props.defaultMode);
    }
  });

  function pickProject(id: string) {
    setProjectId(id);
    setCwdDirty(false);
    setCwd("");
  }

  function pickStarter(id: string) {
    setStarterId(id || null);
    if (!id) return;
    const s = props.starters.find((x) => x.id === id);
    // Starter.permissionMode flips the mode picker so the user sees what's
    // about to happen; they can still override.
    if (s?.permissionMode) setMode(s.permissionMode);
  }

  const activeProject = () => props.projects.find((p) => p.id === projectId()) ?? null;
  const activeStarter = () => props.starters.find((s) => s.id === starterId()) ?? null;

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center"
        onClick={(e) => e.target === e.currentTarget && props.onCancel()}
      >
        <div class="w-[560px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col">
          <div class="px-5 py-4 border-b border-zinc-900">
            <div class="text-sm font-semibold">{t("newSession.title")}</div>
            <div class="text-xs text-zinc-500 mt-0.5">{t("newSession.subtitle")}</div>
          </div>

          <div class="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
            <Show when={props.starters.length > 0}>
              <div>
                <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
                  {t("newSession.starter")}
                </label>
                <select
                  value={starterId() ?? ""}
                  onChange={(e) => pickStarter(e.currentTarget.value)}
                  class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-700"
                >
                  <option value="">{t("newSession.noStarter")}</option>
                  <For each={props.starters}>
                    {(s) => (
                      <option value={s.id}>
                        {s.icon ? `${s.icon} ` : ""}
                        {s.name}
                        {s.builtin ? t("newSession.builtinSuffix") : ""}
                      </option>
                    )}
                  </For>
                </select>
                <Show when={activeStarter()}>
                  <div class="mt-1.5 px-3 py-2 rounded-lg border border-indigo-500/30 bg-indigo-500/5 text-[11px] text-indigo-200/80 leading-relaxed">
                    <Show when={activeStarter()!.description}>
                      <div class="mb-1">{activeStarter()!.description}</div>
                    </Show>
                    <div class="flex flex-wrap gap-1.5 text-[10px]">
                      <Show when={activeStarter()!.systemPrompt}>
                        <span class="px-1.5 py-0.5 rounded bg-indigo-500/20 border border-indigo-500/30">
                          system prompt
                        </span>
                      </Show>
                      <Show when={activeStarter()!.enableSkills?.length}>
                        <span class="px-1.5 py-0.5 rounded bg-orange-500/20 border border-orange-500/30 text-orange-200">
                          {activeStarter()!.enableSkills!.length} skills
                        </span>
                      </Show>
                      <Show when={activeStarter()!.firstSteps?.length}>
                        <span class="px-1.5 py-0.5 rounded bg-teal-500/20 border border-teal-500/30 text-teal-200">
                          {activeStarter()!.firstSteps!.length} first steps
                        </span>
                      </Show>
                      <Show when={activeStarter()!.permissionMode}>
                        <span class="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-200">
                          → {activeStarter()!.permissionMode}
                        </span>
                      </Show>
                    </div>
                  </div>
                </Show>
              </div>
            </Show>

            <Show when={props.projects.length > 0}>
              <div>
                <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
                  {t("newSession.project")}
                </label>
                <select
                  value={projectId() ?? ""}
                  onChange={(e) => pickProject(e.currentTarget.value)}
                  class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-700"
                >
                  <For each={props.projects}>
                    {(p) => (
                      <option value={p.id}>
                        {p.name}
                        {p.isDefault ? ` (${t("newSession.default")})` : ""}
                      </option>
                    )}
                  </For>
                </select>
                <Show when={activeProject()}>
                  <div class="text-[11px] text-zinc-500 mt-1 font-mono truncate">
                    {activeProject()!.cwd}
                  </div>
                </Show>
              </div>
            </Show>

            <div>
              <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
                {t("newSession.cwd")}
              </label>
              <input
                value={cwd()}
                onInput={(e) => {
                  setCwd(e.currentTarget.value);
                  setCwdDirty(true);
                }}
                placeholder={activeProject()?.cwd ?? "/Users/you/project"}
                class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 outline-none focus:border-zinc-700"
              />
              <div class="text-[11px] text-zinc-500 mt-1">{t("newSession.cwdHint")}</div>
            </div>

            <div>
              <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
                {t("newSession.driver")}
              </label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDriver("cli")}
                  class={`text-left p-3 rounded-lg border transition ${
                    driver() === "cli"
                      ? "border-sky-400 bg-sky-500/20 text-sky-200"
                      : "border-sky-500/30 bg-sky-500/5 text-sky-300 hover:brightness-125"
                  }`}
                >
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-semibold">⌨ CLI</span>
                    <span class="text-[10px] font-mono opacity-60">pty</span>
                    <Show when={driver() === "cli"}>
                      <span class="ml-auto text-xs">✓</span>
                    </Show>
                  </div>
                  <div class="text-[11px] mt-1 opacity-80 leading-relaxed">
                    传统：spawn claude CLI，xterm 终端 + 启发式对话视图。
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setDriver("sdk")}
                  class={`text-left p-3 rounded-lg border transition ${
                    driver() === "sdk"
                      ? "border-violet-400 bg-violet-500/20 text-violet-200"
                      : "border-violet-500/30 bg-violet-500/5 text-violet-300 hover:brightness-125"
                  }`}
                >
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-semibold">🧠 SDK</span>
                    <span class="text-[10px] font-mono opacity-60">agent-sdk</span>
                    <Show when={driver() === "sdk"}>
                      <span class="ml-auto text-xs">✓</span>
                    </Show>
                  </div>
                  <div class="text-[11px] mt-1 opacity-80 leading-relaxed">
                    结构化：直接消费 Claude Agent SDK 事件，真实 tool_use / thinking。
                  </div>
                </button>
              </div>
              <Show when={driver() === "sdk"}>
                <div class="mt-2 px-3 py-2 rounded-lg border border-violet-500/30 bg-violet-500/5 text-[11px] text-violet-200/80 leading-relaxed">
                  需要 <span class="font-mono">ANTHROPIC_API_KEY</span> 环境变量,
                  或 <span class="font-mono">~/.rcc/config.json</span> 中
                  <span class="font-mono"> anthropic.apiKey</span>。SDK 会话没有终端。
                </div>
              </Show>
            </div>

            <div>
              <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
                {t("newSession.permissionMode")}
              </label>
              <div class="grid grid-cols-2 gap-2">
                <For each={PERMISSION_MODES}>
                  {(m) => {
                    const info = PERMISSION_MODE_INFO[m];
                    const active = () => mode() === m;
                    return (
                      <button
                        type="button"
                        onClick={() => setMode(m)}
                        class={`text-left p-3 rounded-lg border transition ${
                          active() ? TONE_ACTIVE[info.tone] : TONE_CLASSES[info.tone]
                        } ${active() ? "" : "hover:brightness-125"}`}
                      >
                        <div class="flex items-center gap-2">
                          <span class="text-xs font-semibold">{info.label}</span>
                          <span class="text-[10px] font-mono opacity-60">{m}</span>
                          <Show when={active()}>
                            <span class="ml-auto text-xs">✓</span>
                          </Show>
                        </div>
                        <div class="text-[11px] mt-1 opacity-80 leading-relaxed">
                          {info.description}
                        </div>
                      </button>
                    );
                  }}
                </For>
              </div>
              <Show when={mode() === "bypassPermissions"}>
                <div class="mt-3 px-3 py-2 rounded-lg border border-rose-500/40 bg-rose-500/10 text-[11px] text-rose-300 leading-relaxed">
                  ⚠ <span class="font-semibold">Bypass Permissions</span>{" "}
                  会让 Claude 自动执行所有操作，包括 <span class="font-mono">rm</span>、
                  <span class="font-mono">git push --force</span> 等。仅推荐用于隔离的沙盒环境。
                </div>
              </Show>
            </div>
          </div>

          <div class="px-5 py-3 border-t border-zinc-900 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={props.onCancel}
              class="px-3 py-1.5 rounded-lg border border-zinc-800 text-xs text-zinc-300 hover:border-zinc-700"
            >
              {t("newSession.cancel")}
            </button>
            <button
              type="button"
              onClick={() =>
                props.onConfirm({
                  cwd: cwdDirty() ? cwd().trim() : "",
                  permissionMode: mode(),
                  projectId: projectId(),
                  driver: driver(),
                  starterId: starterId(),
                })
              }
              class="px-4 py-1.5 rounded-lg bg-gradient-to-r from-orange-500 to-rose-500 text-white text-xs font-medium"
            >
              {t("newSession.create")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

export function permissionChip(mode: PermissionMode) {
  const info = PERMISSION_MODE_INFO[mode];
  return { info, cls: TONE_CLASSES[info.tone] };
}
