import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { RccClient } from "./client.ts";
import { loadToken } from "./auth.ts";

interface VersionInfo {
  version: string;
  buildTime: number;
  node: string;
}

type CheckResult =
  | { configured: false }
  | { configured: true; available: boolean; current: string; latest: string; notes?: string; url?: string }
  | { configured: true; error: string; current: string };

interface CrashToast {
  at: number;
  message: string;
  type?: string;
}

async function authedFetch(path: string): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = loadToken();
  if (token) headers["authorization"] = `Bearer ${token}`;
  return fetch(path, { headers });
}

export function VersionBadge(props: { client: RccClient }) {
  const [info, setInfo] = createSignal<VersionInfo | null>(null);
  const [check, setCheck] = createSignal<CheckResult | null>(null);
  const [popoverOpen, setPopoverOpen] = createSignal(false);
  const [checking, setChecking] = createSignal(false);
  const [crash, setCrash] = createSignal<CrashToast | null>(null);
  const [copied, setCopied] = createSignal(false);

  async function loadVersion() {
    try {
      const resp = await authedFetch("/version");
      if (!resp.ok) return;
      setInfo((await resp.json()) as VersionInfo);
    } catch {
      // ignore
    }
  }

  async function runCheck(force = false) {
    setChecking(true);
    try {
      const url = force ? "/version/check?force=1" : "/version/check";
      const resp = await authedFetch(url);
      if (!resp.ok) return;
      setCheck((await resp.json()) as CheckResult);
    } catch {
      // ignore
    } finally {
      setChecking(false);
    }
  }

  const unsub = props.client.on((frame) => {
    if (frame.t === "health.crash") {
      setCrash({ at: frame.at, message: frame.message, type: frame.type });
      setTimeout(() => {
        setCrash((cur) => (cur && cur.at === frame.at ? null : cur));
      }, 12_000);
    }
  });

  onMount(() => {
    void loadVersion();
    void runCheck(false);
  });

  onCleanup(() => {
    unsub();
  });

  const hasUpdate = () => {
    const c = check();
    return !!(c && c.configured === true && "available" in c && c.available);
  };

  function copyCmd() {
    const cmd = "git pull && pnpm install && pnpm -F @rcc/web build";
    navigator.clipboard?.writeText(cmd).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }

  function togglePopover() {
    if (!popoverOpen()) void runCheck(false);
    setPopoverOpen((v) => !v);
  }

  return (
    <>
      <div class="relative">
        <button
          type="button"
          class={`text-[10px] px-1.5 py-0.5 rounded border font-mono transition ${
            hasUpdate()
              ? "border-orange-500/40 text-orange-300 hover:bg-orange-500/10"
              : "border-zinc-800 text-zinc-500 hover:text-zinc-300"
          }`}
          title={
            hasUpdate()
              ? "有新版本,点击查看"
              : info()
                ? `当前版本 v${info()!.version} · 点击检查更新`
                : "版本信息"
          }
          onClick={togglePopover}
        >
          <Show when={info()} fallback={<span>…</span>}>
            <span>v{info()!.version}</span>
          </Show>
          <Show when={hasUpdate()}>
            <span class="ml-1 w-1.5 h-1.5 inline-block rounded-full bg-orange-400 pulse-soft align-middle" />
          </Show>
        </button>
        <Show when={popoverOpen()}>
          <div
            class="absolute right-0 top-full mt-1 w-72 rounded-lg bg-zinc-900 border border-zinc-800 shadow-xl p-3 text-xs z-50"
            onMouseLeave={() => setPopoverOpen(false)}
          >
            <div class="flex items-center justify-between mb-2">
              <div class="text-zinc-400">版本</div>
              <button
                class="text-[10px] text-zinc-500 hover:text-zinc-200"
                onClick={() => runCheck(true)}
                disabled={checking()}
              >
                {checking() ? "检查中…" : "↻ 检查"}
              </button>
            </div>
            <Show when={info()}>
              <div class="font-mono text-zinc-300">v{info()!.version}</div>
              <div class="text-[10px] text-zinc-600 font-mono">
                node {info()!.node}
              </div>
            </Show>
            <div class="mt-2 border-t border-zinc-800 pt-2">
              <Show
                when={check()}
                fallback={<div class="text-zinc-600">加载中…</div>}
              >
                {(c) => (
                  <Show
                    when={c().configured}
                    fallback={
                      <div class="text-zinc-500">
                        未配置自动升级。
                        <div class="mt-1 text-[10px] text-zinc-600">
                          在 <span class="font-mono">~/.rcc/config.json</span> 的{" "}
                          <span class="font-mono">update.manifestUrl</span> 里配置一个 GitHub releases
                          或自定义 JSON URL。
                        </div>
                      </div>
                    }
                  >
                    {(() => {
                      const val = c();
                      if (!val.configured) return null;
                      if ("error" in val) {
                        return (
                          <div class="text-rose-400">
                            检查失败: <span class="font-mono text-[10px]">{val.error}</span>
                          </div>
                        );
                      }
                      if (val.available) {
                        return (
                          <div>
                            <div class="text-orange-300 font-medium">
                              新版本: {val.latest}
                            </div>
                            <Show when={val.notes}>
                              <pre class="mt-1 max-h-32 overflow-y-auto scrollbar text-[10px] text-zinc-400 whitespace-pre-wrap font-mono bg-zinc-950 rounded p-1.5 border border-zinc-800">
                                {val.notes}
                              </pre>
                            </Show>
                            <div class="mt-2 text-[10px] text-zinc-500">
                              RCC 从源码运行,请手动升级:
                            </div>
                            <button
                              class="mt-1 w-full text-left font-mono text-[11px] bg-zinc-950 border border-zinc-800 hover:border-orange-500/40 rounded px-2 py-1.5 text-zinc-300"
                              onClick={copyCmd}
                              title="复制到剪贴板"
                            >
                              git pull && pnpm install{" "}
                              <span class="text-zinc-600">
                                {copied() ? "✓ 已复制" : "⎘"}
                              </span>
                            </button>
                            <Show when={val.url}>
                              <a
                                href={val.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                class="block mt-1 text-[10px] text-zinc-500 hover:text-orange-300 underline decoration-dotted"
                              >
                                查看 release
                              </a>
                            </Show>
                          </div>
                        );
                      }
                      return (
                        <div class="text-emerald-400/80">
                          已是最新版本
                          <span class="ml-1 text-zinc-600">({val.latest})</span>
                        </div>
                      );
                    })()}
                  </Show>
                )}
              </Show>
            </div>
          </div>
        </Show>
      </div>
      <Show when={crash()}>
        {(c) => (
          <div class="fixed bottom-4 right-4 z-[60] max-w-sm rounded-lg bg-rose-950/90 border border-rose-700 shadow-xl p-3 text-xs text-rose-100 backdrop-blur">
            <div class="flex items-start gap-2">
              <span class="text-base leading-none">⚠</span>
              <div class="flex-1 min-w-0">
                <div class="font-semibold">
                  host 崩溃
                  <Show when={c().type}>
                    <span class="ml-1 text-[10px] font-mono text-rose-300">
                      · {c().type}
                    </span>
                  </Show>
                </div>
                <div class="mt-1 break-words font-mono text-[11px] text-rose-200">
                  {c().message}
                </div>
                <div class="mt-1.5 text-[10px] text-rose-300/80">
                  详情见{" "}
                  <span class="font-mono">~/.rcc/crashes.log</span>
                </div>
              </div>
              <button
                class="text-rose-300 hover:text-white text-xs"
                onClick={() => setCrash(null)}
                title="关闭"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </Show>
    </>
  );
}
