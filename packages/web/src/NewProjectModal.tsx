import { createSignal, For, Show } from "solid-js";
import { PROJECT_COLORS, type ProjectColor } from "@rcc/protocol";

interface Props {
  open: boolean;
  onCancel: () => void;
  onConfirm: (opts: { name: string; cwd: string; color: ProjectColor }) => void;
}

const COLOR_DOT: Record<ProjectColor, string> = {
  orange: "bg-orange-400",
  teal: "bg-teal-400",
  violet: "bg-violet-400",
  pink: "bg-pink-400",
  green: "bg-emerald-400",
};

export function NewProjectModal(props: Props) {
  const [name, setName] = createSignal("");
  const [cwd, setCwd] = createSignal("");
  const [color, setColor] = createSignal<ProjectColor>("orange");

  function confirm() {
    const n = name().trim();
    const c = cwd().trim();
    if (!n || !c) return;
    props.onConfirm({ name: n, cwd: c, color: color() });
    setName("");
    setCwd("");
    setColor("orange");
  }

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center"
        onClick={(e) => e.target === e.currentTarget && props.onCancel()}
      >
        <div class="w-[480px] max-w-[calc(100vw-32px)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
          <div class="px-5 py-4 border-b border-zinc-900">
            <div class="text-sm font-semibold">新建项目</div>
            <div class="text-xs text-zinc-500 mt-0.5">命名一个工作区，绑定它的 cwd</div>
          </div>

          <div class="p-5 space-y-4">
            <div>
              <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
                项目名
              </label>
              <input
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="rcc"
                class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-700"
              />
            </div>

            <div>
              <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
                工作目录 (cwd)
              </label>
              <input
                value={cwd()}
                onInput={(e) => setCwd(e.currentTarget.value)}
                placeholder="/Users/you/projects/rcc"
                class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 outline-none focus:border-zinc-700"
              />
            </div>

            <div>
              <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
                颜色
              </label>
              <div class="flex items-center gap-2">
                <For each={PROJECT_COLORS}>
                  {(c) => (
                    <button
                      type="button"
                      onClick={() => setColor(c)}
                      class={`w-8 h-8 rounded-full grid place-items-center border transition ${
                        color() === c
                          ? "border-zinc-300 scale-110"
                          : "border-zinc-800 hover:border-zinc-600"
                      }`}
                      title={c}
                    >
                      <span class={`w-4 h-4 rounded-full ${COLOR_DOT[c]}`} />
                    </button>
                  )}
                </For>
              </div>
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
              onClick={confirm}
              disabled={!name().trim() || !cwd().trim()}
              class="px-4 py-1.5 rounded-lg bg-gradient-to-r from-orange-500 to-rose-500 text-white text-xs font-medium disabled:opacity-40"
            >
              创建项目
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

export const PROJECT_DOT_CLS = COLOR_DOT;
