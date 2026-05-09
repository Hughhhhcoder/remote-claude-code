import { createEffect, createSignal, For, Show } from "solid-js";
import { PROJECT_COLORS, type ProjectColor, type ProjectMeta } from "@rcc/protocol";
import type { RccClient } from "./client.ts";
import { PROJECT_DOT_CLS } from "./NewProjectModal.tsx";

interface Props {
  open: boolean;
  client: RccClient;
  projects: ProjectMeta[];
  onClose: () => void;
}

interface EditState {
  id: string;
  name: string;
  cwd: string;
  color: ProjectColor | null;
}

export function ProjectsModal(props: Props) {
  const [editing, setEditing] = createSignal<EditState | null>(null);

  createEffect(() => {
    if (props.open) {
      props.client.send({ v: 1, t: "project.list.request" });
      setEditing(null);
    }
  });

  function startEdit(p: ProjectMeta) {
    setEditing({
      id: p.id,
      name: p.name,
      cwd: p.cwd,
      color: p.color ?? null,
    });
  }

  function commitEdit() {
    const e = editing();
    if (!e) return;
    const original = props.projects.find((p) => p.id === e.id);
    if (!original) {
      setEditing(null);
      return;
    }
    const name = e.name.trim();
    if (name && name !== original.name) {
      props.client.send({ v: 1, t: "project.rename", id: e.id, name });
    }
    const cwd = e.cwd.trim();
    const colorChanged = (e.color ?? undefined) !== original.color;
    const cwdChanged = cwd && cwd !== original.cwd;
    if (cwdChanged || colorChanged) {
      props.client.send({
        v: 1,
        t: "project.update",
        id: e.id,
        cwd: cwdChanged ? cwd : undefined,
        color: colorChanged ? e.color : undefined,
      });
    }
    setEditing(null);
  }

  function removeProject(p: ProjectMeta) {
    if (p.isDefault) {
      alert("默认项目不可删除。");
      return;
    }
    if (!confirm(`删除项目 "${p.name}"？旧会话仍会运行，但会被归到默认项目。`)) return;
    props.client.send({ v: 1, t: "project.remove", id: p.id });
  }

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center"
        onClick={(e) => e.target === e.currentTarget && props.onClose()}
      >
        <div class="w-[640px] max-w-[calc(100vw-32px)] max-h-[80vh] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col">
          <div class="px-5 py-4 border-b border-zinc-900 flex items-center justify-between">
            <div>
              <div class="text-sm font-semibold">项目</div>
              <div class="text-xs text-zinc-500 mt-0.5">
                ~/.rcc/config.json · 新增 / 改名 / 改 cwd / 删除
              </div>
            </div>
            <button
              onClick={props.onClose}
              class="text-zinc-500 hover:text-zinc-200 text-lg leading-none px-2"
              title="关闭"
            >
              ×
            </button>
          </div>

          <div class="flex-1 overflow-y-auto scrollbar p-3 space-y-2">
            <Show
              when={props.projects.length > 0}
              fallback={<div class="text-xs text-zinc-500 px-2 py-6 text-center">暂无项目</div>}
            >
              <For each={props.projects}>
                {(p) => {
                  const e = () => {
                    const cur = editing();
                    return cur && cur.id === p.id ? cur : null;
                  };
                  return (
                    <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                      <Show
                        when={e()}
                        fallback={
                          <div class="flex items-start gap-3">
                            <span
                              class={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
                                PROJECT_DOT_CLS[(p.color ?? "orange") as ProjectColor]
                              }`}
                            />
                            <div class="min-w-0 flex-1">
                              <div class="flex items-center gap-2">
                                <div class="text-sm text-zinc-100 truncate">{p.name}</div>
                                <Show when={p.isDefault}>
                                  <span class="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-500">
                                    默认
                                  </span>
                                </Show>
                              </div>
                              <div class="text-[11px] text-zinc-500 font-mono truncate mt-0.5">
                                {p.cwd}
                              </div>
                            </div>
                            <div class="flex items-center gap-1 shrink-0">
                              <button
                                class="text-xs text-zinc-400 hover:text-zinc-100 px-2 py-1 rounded hover:bg-zinc-800"
                                onClick={() => startEdit(p)}
                              >
                                编辑
                              </button>
                              <button
                                class="text-xs text-rose-400 hover:text-rose-200 px-2 py-1 rounded hover:bg-rose-500/10 disabled:opacity-30 disabled:hover:bg-transparent"
                                disabled={!!p.isDefault}
                                onClick={() => removeProject(p)}
                                title={p.isDefault ? "默认项目不可删除" : "删除"}
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        }
                      >
                        <div class="space-y-2">
                          <div>
                            <label class="block text-[10px] uppercase tracking-widest text-zinc-500 mb-1">
                              名称
                            </label>
                            <input
                              value={e()!.name}
                              onInput={(ev) =>
                                setEditing({ ...e()!, name: ev.currentTarget.value })
                              }
                              class="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                            />
                          </div>
                          <div>
                            <label class="block text-[10px] uppercase tracking-widest text-zinc-500 mb-1">
                              cwd
                            </label>
                            <input
                              value={e()!.cwd}
                              onInput={(ev) =>
                                setEditing({ ...e()!, cwd: ev.currentTarget.value })
                              }
                              class="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm font-mono text-zinc-100 outline-none focus:border-zinc-600"
                            />
                          </div>
                          <div>
                            <label class="block text-[10px] uppercase tracking-widest text-zinc-500 mb-1">
                              颜色
                            </label>
                            <div class="flex items-center gap-1.5">
                              <For each={PROJECT_COLORS}>
                                {(c) => (
                                  <button
                                    type="button"
                                    onClick={() => setEditing({ ...e()!, color: c })}
                                    class={`w-6 h-6 rounded-full grid place-items-center border ${
                                      e()!.color === c
                                        ? "border-zinc-300"
                                        : "border-zinc-800 hover:border-zinc-600"
                                    }`}
                                    title={c}
                                  >
                                    <span class={`w-3 h-3 rounded-full ${PROJECT_DOT_CLS[c]}`} />
                                  </button>
                                )}
                              </For>
                            </div>
                          </div>
                          <div class="flex items-center justify-end gap-2 pt-1">
                            <button
                              onClick={() => setEditing(null)}
                              class="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded hover:bg-zinc-800"
                            >
                              取消
                            </button>
                            <button
                              onClick={commitEdit}
                              class="text-xs px-3 py-1 rounded bg-gradient-to-r from-orange-500 to-rose-500 text-white font-medium"
                            >
                              保存
                            </button>
                          </div>
                        </div>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
