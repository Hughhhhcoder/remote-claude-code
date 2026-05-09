import { createEffect, createSignal, For, Show } from "solid-js";
import type { PeerInfo } from "@rcc/protocol";
import type { RccClient } from "./client.ts";

interface Props {
  open: boolean;
  client: RccClient;
  peers: PeerInfo[];
  onClose: () => void;
}

const PEER_COLORS = ["violet", "teal", "orange", "pink", "cyan"] as const;

const DOT_CLS: Record<(typeof PEER_COLORS)[number], string> = {
  violet: "bg-violet-400",
  teal: "bg-teal-400",
  orange: "bg-orange-400",
  pink: "bg-pink-400",
  cyan: "bg-cyan-400",
};

export function peerDotCls(color: string | undefined): string {
  const c = (color ?? "violet") as (typeof PEER_COLORS)[number];
  return DOT_CLS[c] ?? DOT_CLS.violet;
}

export function PeersModal(props: Props) {
  const [newId, setNewId] = createSignal("");
  const [newUrl, setNewUrl] = createSignal("");
  const [newLabel, setNewLabel] = createSignal("");
  const [newToken, setNewToken] = createSignal("");
  const [newColor, setNewColor] = createSignal<(typeof PEER_COLORS)[number]>("violet");
  const [err, setErr] = createSignal<string | null>(null);

  createEffect(() => {
    if (props.open) {
      props.client.send({ v: 1, t: "peer.list.request" });
      setErr(null);
      setNewId("");
      setNewUrl("");
      setNewLabel("");
      setNewToken("");
      setNewColor("violet");
    }
  });

  function onAdd() {
    const id = newId().trim();
    const url = newUrl().trim();
    const label = newLabel().trim();
    const token = newToken().trim();
    if (!id || !url || !label || !token) {
      setErr("id / url / label / token 必填");
      return;
    }
    if (!/^(wss?:\/\/)/i.test(url)) {
      setErr("url 必须以 ws:// 或 wss:// 开头");
      return;
    }
    setErr(null);
    props.client.send({
      v: 1,
      t: "peer.add",
      id,
      url,
      token,
      label,
      color: newColor(),
    });
    setNewId("");
    setNewUrl("");
    setNewLabel("");
    setNewToken("");
  }

  function onRemove(p: PeerInfo) {
    if (!confirm(`移除 peer "${p.label}"？本地会话不受影响，远程 host 也不会知情。`)) {
      return;
    }
    props.client.send({ v: 1, t: "peer.remove", id: p.id });
  }

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center"
        onClick={(e) => e.target === e.currentTarget && props.onClose()}
      >
        <div class="w-[680px] max-w-[calc(100vw-32px)] max-h-[85vh] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col">
          <div class="px-5 py-4 border-b border-zinc-900 flex items-center justify-between">
            <div>
              <div class="text-sm font-semibold">Host Federation · Peers</div>
              <div class="text-xs text-zinc-500 mt-0.5">
                ~/.rcc/peers.json · 本机 host 连到远程 host 聚合 sessions
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

          <div class="px-5 py-3 border-b border-rose-900/40 bg-rose-950/20">
            <div class="text-[11px] text-rose-300 leading-relaxed">
              ⚠ <strong>安全提示</strong>：peer token 等于远程 host 的超级权限。你信任
              该网络 + 远程 host 才填。token 存本机 ~/.rcc/peers.json (0600)，
              在 ws 传输时仅受外层 TLS 保护（无 E2E）。
            </div>
          </div>

          <div class="flex-1 overflow-y-auto scrollbar p-3 space-y-2">
            <Show
              when={props.peers.length > 0}
              fallback={
                <div class="text-xs text-zinc-500 px-2 py-6 text-center">
                  暂无 peer · 下方添加
                </div>
              }
            >
              <For each={props.peers}>
                {(p) => (
                  <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                    <div class="flex items-start gap-3">
                      <span
                        class={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${peerDotCls(p.color)}`}
                      />
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <div class="text-sm text-zinc-100 truncate">{p.label}</div>
                          <span
                            class={`text-[10px] px-1.5 py-0.5 rounded border ${
                              p.connected
                                ? "border-emerald-700 text-emerald-300 bg-emerald-500/10"
                                : "border-zinc-700 text-zinc-500"
                            }`}
                          >
                            {p.connected ? "已连接" : "离线"}
                          </span>
                          <Show when={p.sessionCount !== undefined && p.connected}>
                            <span class="text-[10px] text-zinc-500">
                              {p.sessionCount} session{p.sessionCount === 1 ? "" : "s"}
                            </span>
                          </Show>
                        </div>
                        <div class="text-[11px] text-zinc-500 font-mono truncate mt-0.5">
                          {p.id} · {p.url}
                        </div>
                        <Show when={p.error}>
                          <div class="text-[11px] text-rose-400 mt-1 truncate">
                            {p.error}
                          </div>
                        </Show>
                      </div>
                      <button
                        onClick={() => onRemove(p)}
                        class="text-xs text-rose-400 hover:text-rose-200 px-2 py-1 rounded hover:bg-rose-500/10 shrink-0"
                      >
                        移除
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>

          <div class="p-4 border-t border-zinc-900 space-y-2 bg-zinc-950/80">
            <div class="text-[10px] uppercase tracking-widest text-zinc-500">
              新增 peer
            </div>
            <div class="grid grid-cols-2 gap-2">
              <input
                value={newId()}
                onInput={(e) => setNewId(e.currentTarget.value)}
                placeholder="id (home / work)"
                class="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-600"
              />
              <input
                value={newLabel()}
                onInput={(e) => setNewLabel(e.currentTarget.value)}
                placeholder="label (家里 / 公司)"
                class="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-600"
              />
            </div>
            <input
              value={newUrl()}
              onInput={(e) => setNewUrl(e.currentTarget.value)}
              placeholder="ws url (wss://home.example.com/ws)"
              class="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-zinc-100 outline-none focus:border-zinc-600"
            />
            <input
              value={newToken()}
              onInput={(e) => setNewToken(e.currentTarget.value)}
              placeholder="device token (从远程 host 配对得到)"
              type="password"
              class="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-zinc-100 outline-none focus:border-zinc-600"
            />
            <div class="flex items-center gap-2">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500">
                颜色
              </span>
              <For each={PEER_COLORS}>
                {(c) => (
                  <button
                    type="button"
                    onClick={() => setNewColor(c)}
                    class={`w-6 h-6 rounded-full grid place-items-center border ${
                      newColor() === c
                        ? "border-zinc-300"
                        : "border-zinc-800 hover:border-zinc-600"
                    }`}
                    title={c}
                  >
                    <span class={`w-3 h-3 rounded-full ${DOT_CLS[c]}`} />
                  </button>
                )}
              </For>
            </div>
            <Show when={err()}>
              <div class="text-xs text-rose-400">{err()}</div>
            </Show>
            <div class="flex justify-end">
              <button
                onClick={onAdd}
                class="text-xs px-3 py-1.5 rounded bg-gradient-to-r from-violet-500 to-pink-500 text-white font-medium"
              >
                添加 peer
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
