import { createSignal, createMemo, For, onCleanup, onMount, Show } from "solid-js";
import type { PluginInfo } from "@rcc/protocol";
import type { RccClient } from "./client.ts";
import { loadToken } from "./auth.ts";

interface Props {
  client: RccClient;
}

export function PluginsTab(props: Props) {
  const [plugins, setPlugins] = createSignal<PluginInfo[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [openId, setOpenId] = createSignal<string | null>(null);

  const unsub = props.client.on((frame) => {
    if (frame.t === "plugin.list") {
      setPlugins(frame.plugins);
      setLoaded(true);
    }
  });
  onCleanup(unsub);

  onMount(() => {
    props.client.send({ v: 1, t: "plugin.list.request" });
  });

  const activePlugin = createMemo(() => {
    const id = openId();
    if (!id) return null;
    return plugins().find((p) => p.id === id) ?? null;
  });

  function iframeSrc(id: string): string {
    const tok = loadToken();
    const qs = tok ? `?token=${encodeURIComponent(tok)}` : "";
    return `/plugins/${encodeURIComponent(id)}/index.html${qs}`;
  }

  return (
    <div>
      <div class="mb-6">
        <h2 class="text-lg font-semibold text-zinc-100 mb-1">Plugins</h2>
        <p class="text-sm text-zinc-500">
          用户插件位于 <code class="text-zinc-300">~/.rcc/plugins/&lt;id&gt;/</code>。每个目录需 <code>manifest.json</code> + 入口 .ts/.js，host 启动时 dynamic import。插件跑在 host 信任域内，只安装可信源。
        </p>
      </div>

      <Show
        when={loaded() && plugins().length > 0}
        fallback={
          <Show
            when={loaded()}
            fallback={<div class="text-sm text-zinc-500">加载中…</div>}
          >
            <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-8 text-center text-sm text-zinc-500">
              未发现插件。创建 <code class="text-zinc-300">~/.rcc/plugins/&lt;id&gt;/manifest.json</code> 后重启 host。
            </div>
          </Show>
        }
      >
        <div class="space-y-3">
          <For each={plugins()}>
            {(p) => (
              <div
                class={`rounded-lg border p-4 ${
                  p.enabled
                    ? "border-zinc-800 bg-zinc-900/40"
                    : "border-rose-900/50 bg-rose-950/20"
                }`}
              >
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="font-semibold text-zinc-100">{p.name}</span>
                      <span class="text-xs text-zinc-500">v{p.version}</span>
                      <span class="text-xs text-zinc-600 font-mono">{p.id}</span>
                      <Show when={!p.enabled}>
                        <span class="px-1.5 py-0.5 rounded text-[10px] bg-rose-900/60 text-rose-200">
                          disabled
                        </span>
                      </Show>
                      <Show when={p.enabled}>
                        <span class="px-1.5 py-0.5 rounded text-[10px] bg-emerald-900/60 text-emerald-200">
                          loaded
                        </span>
                      </Show>
                    </div>
                    <div class="mt-2 flex gap-1.5 flex-wrap">
                      <For each={p.permissions}>
                        {(perm) => (
                          <span class="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-300 font-mono">
                            {perm}
                          </span>
                        )}
                      </For>
                      <Show when={p.permissions.length === 0}>
                        <span class="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-500">
                          no permissions
                        </span>
                      </Show>
                    </div>
                    <Show when={p.error}>
                      <div class="mt-2 text-xs text-rose-300 font-mono">{p.error}</div>
                    </Show>
                  </div>
                  <Show when={p.hasUi && p.enabled}>
                    <button
                      onClick={() => setOpenId(p.id)}
                      class="shrink-0 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-100"
                    >
                      打开
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={activePlugin()}>
        {(p) => (
          <div
            class="fixed inset-0 z-[60] bg-black/80 backdrop-blur grid place-items-center p-6"
            onClick={(e) => e.target === e.currentTarget && setOpenId(null)}
          >
            <div class="w-full max-w-4xl h-[75vh] bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden flex flex-col">
              <div class="h-10 px-4 flex items-center justify-between border-b border-zinc-900 shrink-0">
                <div class="text-sm text-zinc-100 font-semibold">
                  {p().name}{" "}
                  <span class="text-xs text-zinc-500 ml-2">v{p().version}</span>
                </div>
                <button
                  onClick={() => setOpenId(null)}
                  class="text-zinc-400 hover:text-zinc-100 text-sm"
                >
                  ✕ 关闭
                </button>
              </div>
              <iframe
                src={iframeSrc(p().id)}
                class="flex-1 w-full bg-white"
                sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
                title={`plugin-${p().id}`}
              />
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
