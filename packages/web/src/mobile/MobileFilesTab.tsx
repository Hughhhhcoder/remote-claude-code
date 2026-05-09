import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { FileEntry, GitStatusData, SessionMeta } from "@rcc/protocol";
import type { RccClient } from "../client.ts";

interface Props {
  client: RccClient;
  activeSession: () => SessionMeta | undefined;
  gitBySid: () => Record<string, GitStatusData | null>;
}

function formatSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(entry: FileEntry): string {
  if (entry.type === "dir") return "📁";
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) return "📜";
  if (["json", "yaml", "yml", "toml"].includes(ext)) return "⚙";
  if (["md", "txt"].includes(ext)) return "📝";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼";
  return "📄";
}

function breadcrumbs(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export function MobileFilesTab(props: Props) {
  const [cwd, setCwd] = createSignal<string>("");
  const [entries, setEntries] = createSignal<FileEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    const session = props.activeSession();
    if (!session) {
      setCwd("");
      setEntries([]);
      return;
    }
    if (!cwd()) setCwd(session.cwd);
  });

  createEffect(() => {
    const p = cwd();
    if (!p) return;
    setLoading(true);
    setError(null);
    props.client.send({ v: 1, t: "fs.ls.request", path: p });
  });

  const unsub = props.client.on((frame) => {
    if (frame.t === "fs.ls" && frame.path === cwd()) {
      setEntries(frame.entries);
      setLoading(false);
    }
    if (frame.t === "error") {
      setError(frame.message);
      setLoading(false);
    }
  });
  onCleanup(() => unsub());

  function navigateTo(path: string) {
    setCwd(path);
  }

  function navigateUp() {
    const parts = cwd().split("/");
    if (parts.length <= 1) return;
    parts.pop();
    const up = parts.join("/") || "/";
    setCwd(up);
  }

  const gitStatus = () => {
    const sid = props.activeSession()?.id;
    if (!sid) return null;
    return props.gitBySid()[sid] ?? null;
  };

  const sortedEntries = () =>
    entries()
      .slice()
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

  return (
    <div class="h-full overflow-y-auto scrollbar pb-4">
      <div class="px-5 pt-4 pb-2 flex items-center gap-3">
        <button
          type="button"
          onClick={navigateUp}
          class="text-[13px] text-accent-400 active:text-accent-300"
        >
          ← 上级
        </button>
        <div class="text-[13px] font-semibold flex-1 text-center">文件</div>
        <span class="text-[13px] text-transparent select-none">← 上级</span>
      </div>

      {/* breadcrumb */}
      <div class="px-5 pb-3 overflow-x-auto no-scrollbar">
        <div class="flex items-center gap-1 text-[11px] font-mono text-zinc-500 whitespace-nowrap">
          <For each={breadcrumbs(cwd())}>
            {(part, i) => (
              <>
                <span>/</span>
                <span
                  class={
                    i() === breadcrumbs(cwd()).length - 1
                      ? "text-accent-300"
                      : "text-zinc-500"
                  }
                >
                  {part}
                </span>
              </>
            )}
          </For>
        </div>
      </div>

      <div class="px-4 space-y-4">
        {/* git status chip */}
        <Show when={gitStatus()}>
          <div class="px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900/40 flex items-center gap-2 text-[11px]">
            <span class="font-mono text-zinc-300">
              {gitStatus()!.branch ?? "detached"}
            </span>
            <Show when={gitStatus()!.dirty}>
              <span class="text-amber-400">● 有改动</span>
            </Show>
            <Show when={!gitStatus()!.dirty}>
              <span class="text-emerald-400">✓ 干净</span>
            </Show>
            <Show when={gitStatus()!.ahead}>
              <span class="text-zinc-500 ml-auto">↑{gitStatus()!.ahead}</span>
            </Show>
            <Show when={gitStatus()!.behind}>
              <span class="text-zinc-500">↓{gitStatus()!.behind}</span>
            </Show>
          </div>
        </Show>

        {/* file list */}
        <div>
          <div class="text-[10px] uppercase tracking-widest text-zinc-600 mb-2 px-1 flex items-center justify-between">
            <span>当前目录</span>
            <Show when={loading()}>
              <span class="text-zinc-500 normal-case tracking-normal">加载中…</span>
            </Show>
          </div>
          <Show when={error()}>
            <div class="px-3 py-2 rounded-lg border border-rose-500/40 bg-rose-500/5 text-[11px] text-rose-300 mb-2">
              {error()}
            </div>
          </Show>
          <div class="space-y-0.5">
            <For each={sortedEntries()}>
              {(entry) => (
                <button
                  type="button"
                  onClick={() => {
                    if (entry.type === "dir") navigateTo(entry.path);
                  }}
                  class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg active:bg-zinc-900 text-left"
                >
                  <span class="text-lg shrink-0">{fileIcon(entry)}</span>
                  <div class="flex-1 min-w-0">
                    <div class="font-mono text-[13px] truncate">{entry.name}</div>
                    <div class="text-[10px] text-zinc-500">
                      {entry.type === "dir" ? "目录" : formatSize(entry.size)}
                    </div>
                  </div>
                  <Show when={entry.type === "dir"}>
                    <span class="text-zinc-600">›</span>
                  </Show>
                </button>
              )}
            </For>
            <Show when={!loading() && entries().length === 0 && !error()}>
              <div class="py-8 text-center text-[12px] text-zinc-500">
                空目录
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
