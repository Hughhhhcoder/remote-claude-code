import { createSignal, createEffect, For, Show, onCleanup } from "solid-js";
import type { DeviceSummary } from "@rcc/protocol";
import type { RccClient } from "./client.ts";
import { registerPasskey, clearPasskey, isWebAuthnAvailable } from "./webauthn.ts";

interface Props {
  open: boolean;
  client: RccClient;
  onClose: () => void;
  currentDevice: { id: string; name: string; hasPasskey?: boolean } | null;
  onPasskeyChange?: (hasPasskey: boolean) => void;
}

function formatAge(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function DevicesModal(props: Props) {
  const [devices, setDevices] = createSignal<DeviceSummary[]>([]);
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  const [passkeyBusy, setPasskeyBusy] = createSignal(false);
  const [passkeyError, setPasskeyError] = createSignal<string | null>(null);

  const unsub = props.client.on((frame) => {
    if (frame.t === "device.list") setDevices(frame.devices);
  });
  onCleanup(unsub);

  // Request the list whenever the modal opens.
  createEffect(() => {
    if (props.open) {
      props.client.send({ v: 1, t: "device.list.request" });
    }
  });

  function revoke(d: DeviceSummary) {
    if (d.current) {
      alert("不能从此设备吊销自己。请用另一台已配对设备或 host 的 CLI 吊销。");
      return;
    }
    if (!confirm(`确认吊销设备 "${d.name}"？它将立即断开，下次连接需要重新配对。`)) return;
    props.client.send({ v: 1, t: "device.revoke", deviceId: d.id });
  }

  function startRename(d: DeviceSummary) {
    setRenamingId(d.id);
    setRenameValue(d.name);
  }

  function commitRename(d: DeviceSummary) {
    const name = renameValue().trim();
    if (name && name !== d.name) {
      props.client.send({ v: 1, t: "device.rename", deviceId: d.id, name });
    }
    setRenamingId(null);
  }

  async function upgradePasskey() {
    if (!props.currentDevice) return;
    setPasskeyBusy(true);
    setPasskeyError(null);
    try {
      await registerPasskey(props.currentDevice.id);
      props.onPasskeyChange?.(true);
      props.client.send({ v: 1, t: "device.list.request" });
    } catch (err) {
      setPasskeyError((err as Error).message || "passkey 注册失败");
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function removePasskey() {
    if (!props.currentDevice) return;
    if (!confirm("移除此设备的 Passkey？高风险审批将退回到单次点击确认。")) return;
    setPasskeyBusy(true);
    setPasskeyError(null);
    try {
      await clearPasskey(props.currentDevice.id);
      props.onPasskeyChange?.(false);
      props.client.send({ v: 1, t: "device.list.request" });
    } catch (err) {
      setPasskeyError((err as Error).message || "passkey 移除失败");
    } finally {
      setPasskeyBusy(false);
    }
  }

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center"
        onClick={(e) => e.target === e.currentTarget && props.onClose()}
      >
        <div class="w-[560px] max-w-[calc(100vw-32px)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
          <div class="px-5 py-4 border-b border-zinc-900 flex items-center justify-between">
            <div>
              <div class="text-sm font-semibold">已配对的设备</div>
              <div class="text-xs text-zinc-500 mt-0.5">
                {devices().length} 台 · 每台占用一个 passkey-like 令牌
              </div>
            </div>
            <button
              class="text-zinc-500 hover:text-zinc-200 text-sm px-2"
              onClick={props.onClose}
            >
              ✕
            </button>
          </div>

          <div class="max-h-[480px] overflow-y-auto">
            <Show when={props.currentDevice && isWebAuthnAvailable()}>
              <div class="px-5 py-3 border-b border-zinc-900 bg-zinc-900/30">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/30 grid place-items-center text-sm shrink-0">
                    🔐
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-xs font-medium text-zinc-200">
                      Passkey（本设备）
                    </div>
                    <div class="text-[11px] text-zinc-500 mt-0.5">
                      <Show
                        when={props.currentDevice?.hasPasskey}
                        fallback={
                          <span>升级后高风险审批需要 Touch ID / Face ID 二次确认</span>
                        }
                      >
                        <span class="text-violet-300">已启用 · 高风险审批走生物识别</span>
                      </Show>
                    </div>
                  </div>
                  <Show
                    when={props.currentDevice?.hasPasskey}
                    fallback={
                      <button
                        onClick={upgradePasskey}
                        disabled={passkeyBusy()}
                        class="text-[11px] px-3 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-400 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {passkeyBusy() ? "注册中…" : "升级 Passkey"}
                      </button>
                    }
                  >
                    <button
                      onClick={removePasskey}
                      disabled={passkeyBusy()}
                      class="text-[11px] px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-rose-400 hover:border-rose-500/40 disabled:opacity-60"
                    >
                      {passkeyBusy() ? "…" : "移除"}
                    </button>
                  </Show>
                </div>
                <Show when={passkeyError()}>
                  <div class="mt-2 text-[11px] text-rose-400 break-words">
                    {passkeyError()}
                  </div>
                </Show>
              </div>
            </Show>
            <Show
              when={devices().length > 0}
              fallback={
                <div class="p-10 text-center text-sm text-zinc-500">
                  还没有配对设备。
                </div>
              }
            >
              <ul class="divide-y divide-zinc-900">
                <For each={devices()}>
                  {(d) => (
                    <li class="px-5 py-3 flex items-start gap-3">
                      <div class="w-9 h-9 rounded-lg bg-zinc-900 grid place-items-center text-sm shrink-0">
                        {d.userAgent?.match(/iPhone|iPad/) ? "📱" :
                         d.userAgent?.match(/Macintosh|Mac/) ? "💻" :
                         d.userAgent?.match(/Windows/) ? "🖥" :
                         d.userAgent?.match(/Android/) ? "📱" : "🔑"}
                      </div>
                      <div class="flex-1 min-w-0">
                        <Show
                          when={renamingId() === d.id}
                          fallback={
                            <div class="flex items-center gap-2">
                              <div class="text-sm font-medium truncate">{d.name}</div>
                              <Show when={d.current}>
                                <span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                  当前设备
                                </span>
                              </Show>
                            </div>
                          }
                        >
                          <div class="flex gap-1">
                            <input
                              value={renameValue()}
                              onInput={(e) => setRenameValue(e.currentTarget.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitRename(d);
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              class="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:border-zinc-700"
                              autofocus
                            />
                            <button
                              onClick={() => commitRename(d)}
                              class="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 text-xs"
                            >
                              保存
                            </button>
                            <button
                              onClick={() => setRenamingId(null)}
                              class="px-2 py-1 rounded text-xs text-zinc-500"
                            >
                              取消
                            </button>
                          </div>
                        </Show>
                        <div class="text-[11px] text-zinc-500 mt-0.5 font-mono">
                          {d.id}
                        </div>
                        <div class="text-[11px] text-zinc-500 mt-1 flex items-center gap-3">
                          <span>上次活动 {formatAge(d.lastSeenAt)}</span>
                          <span>·</span>
                          <span>配对于 {formatAge(d.createdAt)}</span>
                        </div>
                        <Show when={d.userAgent}>
                          <div class="text-[10px] text-zinc-600 mt-0.5 truncate font-mono" title={d.userAgent!}>
                            {d.userAgent}
                          </div>
                        </Show>
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => startRename(d)}
                          class="text-[11px] px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                          title="重命名"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => revoke(d)}
                          disabled={d.current}
                          class="text-[11px] px-2 py-1 rounded text-rose-400 hover:bg-rose-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
                          title={d.current ? "不能吊销自己" : "吊销此设备"}
                        >
                          🗑
                        </button>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>

          <div class="px-5 py-3 border-t border-zinc-900 flex items-center justify-between text-[11px] text-zinc-500">
            <span>吊销后该设备立即断开，token 失效。</span>
            <button
              onClick={() => props.client.send({ v: 1, t: "device.list.request" })}
              class="text-zinc-400 hover:text-zinc-200"
            >
              ⟳ 刷新
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
