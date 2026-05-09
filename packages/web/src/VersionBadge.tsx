import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { RccClient } from "./client.ts";
import { loadToken } from "./auth.ts";

interface VersionInfo {
  version: string;
  buildTime: number;
  node: string;
}

interface UpdateManifest {
  version: string;
  url: string;
  sha256: string;
  releaseNotes?: string;
  publishedAt?: number;
}

type UpdaterState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "applying"
  | "error";

interface UpdaterStatus {
  state: UpdaterState;
  current: string;
  latest?: UpdateManifest;
  error?: string;
  progress?: { bytes: number; total: number };
}

interface CrashToast {
  at: number;
  message: string;
  type?: string;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  const token = loadToken();
  if (token) headers["authorization"] = `Bearer ${token}`;
  return fetch(path, { ...init, headers });
}

function fmtMB(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0";
  return (bytes / (1024 * 1024)).toFixed(1);
}

export function VersionBadge(props: { client: RccClient }) {
  const [info, setInfo] = createSignal<VersionInfo | null>(null);
  const [status, setStatus] = createSignal<UpdaterStatus | null>(null);
  const [popoverOpen, setPopoverOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [crash, setCrash] = createSignal<CrashToast | null>(null);
  const [appliedVersion, setAppliedVersion] = createSignal<string | null>(null);

  async function loadVersion() {
    try {
      const resp = await authedFetch("/version");
      if (!resp.ok) return;
      setInfo((await resp.json()) as VersionInfo);
    } catch {
      // ignore
    }
  }

  async function runCheck() {
    setBusy(true);
    try {
      const resp = await authedFetch("/update/check", { method: "POST" });
      if (!resp.ok) return;
      setStatus((await resp.json()) as UpdaterStatus);
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  async function startDownload() {
    setBusy(true);
    try {
      await authedFetch("/update/download", { method: "POST" });
    } catch {
      // ignore — progress arrives via ws
    } finally {
      setBusy(false);
    }
  }

  async function applyUpdate() {
    setBusy(true);
    try {
      await authedFetch("/update/apply", { method: "POST" });
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  const unsub = props.client.on((frame) => {
    if (frame.t === "health.crash") {
      setCrash({ at: frame.at, message: frame.message, type: frame.type });
      setTimeout(() => {
        setCrash((cur) => (cur && cur.at === frame.at ? null : cur));
      }, 12_000);
      return;
    }
    if (frame.t === "update.status") {
      setStatus(frame.status);
      return;
    }
    if (frame.t === "update.progress") {
      setStatus((cur) => {
        if (!cur) return cur;
        return { ...cur, progress: { bytes: frame.bytes, total: frame.total } };
      });
      return;
    }
    if (frame.t === "update.ready") {
      setAppliedVersion(frame.version);
      setStatus((cur) => (cur ? { ...cur, state: "idle" } : cur));
      return;
    }
  });

  onMount(() => {
    void loadVersion();
    void runCheck();
  });

  onCleanup(() => {
    unsub();
  });

  const hasUpdate = () => {
    const s = status();
    return !!s && (s.state === "available" || s.state === "downloading" || s.state === "downloaded");
  };

  function togglePopover() {
    if (!popoverOpen()) void runCheck();
    setPopoverOpen((v) => !v);
  }

  const progressPct = () => {
    const s = status();
    if (!s?.progress || s.progress.total <= 0) return 0;
    return Math.min(100, Math.round((s.progress.bytes / s.progress.total) * 100));
  };

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
            class="absolute right-0 top-full mt-1 w-80 rounded-lg bg-zinc-900 border border-zinc-800 shadow-xl p-3 text-xs z-50"
            onMouseLeave={() => setPopoverOpen(false)}
          >
            <div class="flex items-center justify-between mb-2">
              <div class="text-zinc-400">版本</div>
              <button
                class="text-[10px] text-zinc-500 hover:text-zinc-200"
                onClick={() => void runCheck()}
                disabled={busy()}
              >
                {busy() ? "…" : "↻ 检查"}
              </button>
            </div>
            <Show when={info()}>
              <div class="font-mono text-zinc-300">v{info()!.version}</div>
              <div class="text-[10px] text-zinc-600 font-mono">node {info()!.node}</div>
            </Show>
            <div class="mt-2 border-t border-zinc-800 pt-2">
              <Show when={appliedVersion()}>
                <div class="mb-2 rounded border border-emerald-500/40 bg-emerald-500/10 p-2 text-emerald-300">
                  <div class="font-medium">✅ 已应用 v{appliedVersion()}</div>
                  <div class="mt-0.5 text-[10px] text-emerald-400/70">
                    host 已退出,等待 supervisor 重启。请刷新页面或重新运行{" "}
                    <span class="font-mono">pnpm dev:host</span>
                  </div>
                </div>
              </Show>
              <Show
                when={status()}
                fallback={<div class="text-zinc-600">加载中…</div>}
              >
                {(s) => {
                  const st = s();
                  if (st.state === "error") {
                    return (
                      <div class="text-rose-400">
                        失败:{" "}
                        <span class="font-mono text-[10px]">{st.error ?? "unknown"}</span>
                        <button
                          class="mt-1 block w-full text-[11px] bg-zinc-950 border border-zinc-800 hover:border-orange-500/40 rounded px-2 py-1 text-zinc-300"
                          onClick={() => void runCheck()}
                        >
                          重试
                        </button>
                      </div>
                    );
                  }
                  if (st.state === "idle" && !st.latest) {
                    return (
                      <div class="text-zinc-500">
                        未配置自动升级。
                        <div class="mt-1 text-[10px] text-zinc-600">
                          在 <span class="font-mono">~/.rcc/config.json</span> 的{" "}
                          <span class="font-mono">update.manifestUrl</span> 里配置一个 JSON URL
                          (需含 version / url / sha256)。
                        </div>
                      </div>
                    );
                  }
                  if (st.state === "idle" && st.latest) {
                    return (
                      <div class="text-emerald-400/80">
                        已是最新版本
                        <span class="ml-1 text-zinc-600">({st.latest.version})</span>
                      </div>
                    );
                  }
                  if (st.state === "checking") {
                    return <div class="text-zinc-500">检查中…</div>;
                  }
                  if (st.state === "available" && st.latest) {
                    return (
                      <div>
                        <div class="text-orange-300 font-medium">
                          新版本: v{st.latest.version}
                        </div>
                        <Show when={st.latest.releaseNotes}>
                          <pre class="mt-1 max-h-32 overflow-y-auto scrollbar text-[10px] text-zinc-400 whitespace-pre-wrap font-mono bg-zinc-950 rounded p-1.5 border border-zinc-800">
                            {st.latest.releaseNotes}
                          </pre>
                        </Show>
                        <button
                          class="mt-2 w-full text-[11px] bg-orange-500/20 border border-orange-500/50 hover:bg-orange-500/30 rounded px-2 py-1.5 text-orange-200 font-medium"
                          onClick={() => void startDownload()}
                          disabled={busy()}
                        >
                          ⬇ 下载更新 v{st.latest.version}
                        </button>
                        <div class="mt-1 text-[10px] text-zinc-600">
                          sha256 校验 · 解压到{" "}
                          <span class="font-mono">~/.rcc/install/</span>
                        </div>
                      </div>
                    );
                  }
                  if (st.state === "downloading") {
                    const p = st.progress;
                    return (
                      <div>
                        <div class="text-orange-300 font-medium">
                          下载中… v{st.latest?.version ?? ""}
                        </div>
                        <div class="mt-2 h-1.5 w-full rounded-full bg-zinc-950 border border-zinc-800 overflow-hidden">
                          <div
                            class="h-full bg-orange-400 transition-all"
                            style={{ width: `${progressPct()}%` }}
                          />
                        </div>
                        <div class="mt-1 flex items-center justify-between text-[10px] font-mono text-zinc-500">
                          <span>
                            {p ? fmtMB(p.bytes) : "0"} /{" "}
                            {p && p.total > 0 ? `${fmtMB(p.total)} MB` : "? MB"}
                          </span>
                          <span>{progressPct()}%</span>
                        </div>
                      </div>
                    );
                  }
                  if (st.state === "downloaded" && st.latest) {
                    return (
                      <div>
                        <div class="text-emerald-300 font-medium">
                          ✅ 已下载 v{st.latest.version}
                        </div>
                        <div class="mt-1 text-[10px] text-zinc-500">
                          校验通过,点击下面按钮重启并应用。host 将退出。
                        </div>
                        <button
                          class="mt-2 w-full text-[11px] bg-emerald-500/20 border border-emerald-500/50 hover:bg-emerald-500/30 rounded px-2 py-1.5 text-emerald-200 font-medium"
                          onClick={() => void applyUpdate()}
                          disabled={busy()}
                        >
                          🚀 应用并重启
                        </button>
                      </div>
                    );
                  }
                  if (st.state === "applying") {
                    return <div class="text-emerald-300">应用中… host 即将退出</div>;
                  }
                  return <div class="text-zinc-500">{st.state}</div>;
                }}
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
                  详情见 <span class="font-mono">~/.rcc/crashes.log</span>
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
