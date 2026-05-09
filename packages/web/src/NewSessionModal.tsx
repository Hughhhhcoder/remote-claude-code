import { createSignal, For, Show } from "solid-js";
import {
  PERMISSION_MODES,
  PERMISSION_MODE_INFO,
  type PermissionMode,
} from "@rcc/protocol";

interface Props {
  open: boolean;
  defaultCwd: string;
  defaultMode: PermissionMode;
  onCancel: () => void;
  onConfirm: (opts: { cwd: string; permissionMode: PermissionMode }) => void;
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

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center"
        onClick={(e) => e.target === e.currentTarget && props.onCancel()}
      >
        <div class="w-[560px] max-w-[calc(100vw-32px)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
          <div class="px-5 py-4 border-b border-zinc-900">
            <div class="text-sm font-semibold">新建会话</div>
            <div class="text-xs text-zinc-500 mt-0.5">工作目录 + 权限模式</div>
          </div>

          <div class="p-5 space-y-4">
            <div>
              <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
                工作目录 (cwd)
              </label>
              <input
                value={cwd()}
                onInput={(e) => setCwd(e.currentTarget.value)}
                placeholder="/Users/you/project"
                class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 outline-none focus:border-zinc-700"
              />
              <div class="text-[11px] text-zinc-500 mt-1">留空使用 host 的默认 cwd</div>
            </div>

            <div>
              <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
                权限模式
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
              取消
            </button>
            <button
              type="button"
              onClick={() => props.onConfirm({ cwd: cwd().trim(), permissionMode: mode() })}
              class="px-4 py-1.5 rounded-lg bg-gradient-to-r from-orange-500 to-rose-500 text-white text-xs font-medium"
            >
              创建会话
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
