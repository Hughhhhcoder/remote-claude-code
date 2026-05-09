import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import type { CommandSummary, UiCustomKey } from "@rcc/protocol";
import type { RccClient } from "./client.ts";

type Props = {
  client: RccClient;
  sid: string | null;
  pinnedCommands: () => readonly CommandSummary[];
  customKeys: () => readonly UiCustomKey[];
};

function dotForScope(scope: "builtin" | "user" | "project"): string {
  if (scope === "project") return "bg-accent-400";
  if (scope === "user") return "bg-sky-400";
  return "bg-violet-400";
}

export function MobileKeyBar(props: Props) {
  const [bottomOffset, setBottomOffset] = createSignal(0);

  function syncViewport() {
    const vv = window.visualViewport;
    if (!vv) {
      setBottomOffset(0);
      return;
    }
    const gap = window.innerHeight - (vv.height + vv.offsetTop);
    setBottomOffset(gap > 1 ? gap : 0);
  }

  onMount(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    syncViewport();
    vv.addEventListener("resize", syncViewport);
    vv.addEventListener("scroll", syncViewport);
    onCleanup(() => {
      vv.removeEventListener("resize", syncViewport);
      vv.removeEventListener("scroll", syncViewport);
    });
  });

  function write(data: string) {
    const sid = props.sid;
    if (!sid) return;
    props.client.write(sid, data);
  }

  function sendCommand(name: string) {
    const sid = props.sid;
    if (!sid) return;
    props.client.write(sid, `/${name}\r`);
  }

  return (
    <div
      class="fixed left-0 right-0 z-30 bg-zinc-950/95 backdrop-blur border-t border-zinc-800 md:hidden"
      style={{
        bottom: `${bottomOffset()}px`,
        "padding-bottom": "max(env(safe-area-inset-bottom), 4px)",
      }}
    >
      <div class="px-2 pt-1.5 pb-1 flex gap-1 overflow-x-auto no-scrollbar">
        <Show
          when={props.pinnedCommands().length > 0}
          fallback={<div class="text-[10px] text-zinc-600 px-1 py-1.5">暂无钉选命令</div>}
        >
          <For each={props.pinnedCommands()}>
            {(c) => (
              <button
                type="button"
                class={`shrink-0 h-9 min-w-[36px] px-2.5 rounded-md border font-mono text-[11px] flex items-center gap-1.5 active:scale-95 active:opacity-80 transition ${
                  c.scope === "project"
                    ? "bg-accent-500/10 border-accent-500/30 text-accent-300"
                    : "bg-zinc-900 border-zinc-800 text-zinc-300"
                }`}
                onClick={() => sendCommand(c.name)}
                title={c.description || `发送 /${c.name}`}
              >
                <span class={`w-1 h-1 rounded-full ${dotForScope(c.scope)}`} />/{c.name}
              </button>
            )}
          </For>
        </Show>
      </div>

      <div class="px-2 pb-1 flex gap-1.5 overflow-x-auto no-scrollbar">
        <For each={props.customKeys()}>
          {(k) => (
            <MobileKey label={k.label} onTap={() => write(k.send)} hint={k.hint} />
          )}
        </For>
      </div>
    </div>
  );
}

function MobileKey(props: { label: string; onTap: () => void; hint?: string }) {
  return (
    <button
      type="button"
      class="shrink-0 h-9 min-w-[42px] px-3 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-200 font-mono text-[12px] active:bg-accent-500/20 active:border-accent-500/40 active:text-accent-300 transition"
      title={props.hint ?? props.label}
      onPointerDown={(e) => {
        e.preventDefault();
        props.onTap();
      }}
    >
      {props.label}
    </button>
  );
}
