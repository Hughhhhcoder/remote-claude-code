import { createSignal, createEffect, For, Show, onCleanup } from "solid-js";
import type { RccClient } from "./client.ts";
import type { ShareSummary } from "@rcc/protocol";
import { loadToken } from "./auth.ts";

interface Props {
  open: boolean;
  sid: string | null;
  onClose: () => void;
  client: RccClient;
}

const TTL_PRESETS: { label: string; minutes: number }[] = [
  { label: "10 分钟", minutes: 10 },
  { label: "1 小时", minutes: 60 },
  { label: "8 小时", minutes: 8 * 60 },
  { label: "24 小时", minutes: 24 * 60 },
];

export function ShareModal(props: Props) {
  const [ttl, setTtl] = createSignal(60);
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [lastUrl, setLastUrl] = createSignal<string | null>(null);
  const [lastToken, setLastToken] = createSignal<string | null>(null);
  const [shares, setShares] = createSignal<ShareSummary[]>([]);
  const [copied, setCopied] = createSignal(false);

  const unsub = props.client.on((frame) => {
    if (frame.t === "share.list") {
      const sid = props.sid;
      setShares(
        sid ? frame.shares.filter((s) => s.sid === sid) : frame.shares,
      );
    }
  });
  onCleanup(unsub);

  createEffect(() => {
    if (props.open && props.sid) {
      setError(null);
      setLastUrl(null);
      setLastToken(null);
      props.client.send({ v: 1, t: "share.list.request", sid: props.sid });
    }
  });

  async function onCreate() {
    const sid = props.sid;
    if (!sid) return;
    setCreating(true);
    setError(null);
    try {
      const token = loadToken();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (token) headers["authorization"] = `Bearer ${token}`;
      const resp = await fetch("/share/new", {
        method: "POST",
        headers,
        body: JSON.stringify({ sid, ttlMinutes: ttl() }),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { url: string; token: string };
      setLastUrl(data.url);
      setLastToken(data.token);
      props.client.send({ v: 1, t: "share.list.request", sid });
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke(id: string) {
    try {
      const token = loadToken();
      const headers: Record<string, string> = {};
      if (token) headers["authorization"] = `Bearer ${token}`;
      const resp = await fetch(`/share/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      if (props.sid) props.client.send({ v: 1, t: "share.list.request", sid: props.sid });
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }

  function formatRemaining(expiresAt: number): string {
    const ms = expiresAt - Date.now();
    if (ms <= 0) return "已过期";
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return `剩 ${mins} 分钟`;
    const hours = Math.floor(mins / 60);
    return `剩 ${hours} 小时 ${mins % 60} 分钟`;
  }

  async function copyUrl() {
    const url = lastUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 bg-black/60 grid place-items-center z-50 p-4"
        onClick={props.onClose}
      >
        <div
          class="bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="px-5 py-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
            <div class="text-sm font-semibold">分享会话 (只读)</div>
            <button
              class="text-zinc-500 hover:text-zinc-200 text-lg leading-none"
              onClick={props.onClose}
            >
              ×
            </button>
          </div>

          <div class="p-5 space-y-4 overflow-y-auto">
            <div class="text-xs text-zinc-400">
              生成一个临时 URL,访客无需配对即可只读查看对话。访客看不到终端键入、无法审批、无法发送任何输入。
            </div>

            <div>
              <div class="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">
                有效期
              </div>
              <div class="grid grid-cols-4 gap-2">
                <For each={TTL_PRESETS}>
                  {(preset) => (
                    <button
                      class={`py-2 text-xs rounded border ${
                        ttl() === preset.minutes
                          ? "border-accent-500 bg-accent-500/10 text-accent-300"
                          : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700"
                      }`}
                      onClick={() => setTtl(preset.minutes)}
                    >
                      {preset.label}
                    </button>
                  )}
                </For>
              </div>
            </div>

            <button
              class="w-full py-2 rounded-lg bg-gradient-to-r from-accent-500 to-accent-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
              disabled={creating() || !props.sid}
              onClick={onCreate}
            >
              {creating() ? "生成中…" : "生成链接"}
            </button>

            <Show when={error()}>
              <div class="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">
                {error()}
              </div>
            </Show>

            <Show when={lastUrl()}>
              <div class="border border-accent-500/30 bg-accent-500/5 rounded p-3 space-y-2">
                <div class="text-[11px] uppercase tracking-wider text-accent-300">
                  新分享链接
                </div>
                <div class="font-mono text-[11px] text-zinc-200 break-all bg-zinc-950 rounded px-2 py-1.5 border border-zinc-800">
                  {lastUrl()}
                </div>
                <div class="flex items-center gap-2">
                  <button
                    class="text-xs px-3 py-1.5 rounded border border-zinc-700 hover:border-accent-500/50 hover:text-accent-300"
                    onClick={copyUrl}
                  >
                    {copied() ? "已复制" : "复制链接"}
                  </button>
                  <div class="text-[10px] text-zinc-500">
                    Token 只在本地显示一次,刷新后看不到原文
                  </div>
                </div>
              </div>
            </Show>

            <div class="pt-2 border-t border-zinc-800">
              <div class="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">
                已有分享 ({shares().length})
              </div>
              <Show
                when={shares().length > 0}
                fallback={
                  <div class="text-xs text-zinc-600 py-2">
                    此会话尚无分享链接
                  </div>
                }
              >
                <div class="space-y-1.5">
                  <For each={shares()}>
                    {(s) => (
                      <div class="flex items-center justify-between gap-2 px-3 py-2 rounded border border-zinc-800 bg-zinc-950">
                        <div class="min-w-0 flex-1">
                          <div class="font-mono text-[11px] text-zinc-400 truncate">
                            {s.id}
                          </div>
                          <div class="text-[10px] text-zinc-500">
                            {formatRemaining(s.expiresAt)}
                          </div>
                        </div>
                        <button
                          class="text-[10px] px-2 py-1 rounded border border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                          onClick={() => onRevoke(s.id)}
                        >
                          撤销
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
