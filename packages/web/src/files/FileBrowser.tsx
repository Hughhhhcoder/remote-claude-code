import { createSignal, createMemo, onMount, onCleanup, For, Show, type JSX } from "solid-js";
import type { FileEntry } from "@rcc/protocol";
import type { RccClient } from "../client.ts";
import { IconButton } from "../primitives/IconButton";
import { Spinner } from "../primitives/Spinner";
import { EmptyState } from "../primitives/EmptyState";
import { FilePreview } from "./FilePreview";

/**
 * FileBrowser (v2) — responsive flat-list browser with breadcrumb nav.
 * Replaces the recursive tree with a "one directory per view" pattern that
 * works correctly at 375px. Monaco preview stays lazy via FilePreview.
 */

export interface FileBrowserProps {
  client: RccClient;
  rootCwd: string;
  onOpenFile?: (path: string) => void;
  gitStatus?: { modified?: string[]; untracked?: string[]; staged?: string[] } | null;
  onClose?: () => void;
}

interface ListState {
  path: string;
  entries: FileEntry[] | null;
  loading: boolean;
  error: string | null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function parentOf(p: string): string | null {
  if (!p || p === "/") return null;
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

function breadcrumbSegments(path: string): Array<{ label: string; path: string }> {
  if (!path || path === "/") return [{ label: "/", path: "/" }];
  const parts = path.split("/").filter(Boolean);
  const out: Array<{ label: string; path: string }> = [{ label: "/", path: "/" }];
  let acc = "";
  for (const p of parts) {
    acc = acc === "" ? `/${p}` : `${acc}/${p}`;
    out.push({ label: p, path: acc });
  }
  return out;
}

export function FileBrowser(props: FileBrowserProps): JSX.Element {
  const [state, setState] = createSignal<ListState>({
    path: props.rootCwd,
    entries: null,
    loading: true,
    error: null,
  });
  const [showHidden, setShowHidden] = createSignal(false);
  const [previewPath, setPreviewPath] = createSignal<string | null>(null);

  // Pending ls resolvers, keyed by exact path the host echoes back.
  const lsResolvers = new Map<string, (entries: FileEntry[]) => void>();
  const lsRejecters = new Map<string, (err: string) => void>();

  const unsub = props.client.on((frame) => {
    if (frame.t === "fs.ls") {
      const r = lsResolvers.get(frame.path);
      if (r) {
        lsResolvers.delete(frame.path);
        lsRejecters.delete(frame.path);
        r(frame.entries);
      }
    } else if (frame.t === "error" && frame.code === "fs_ls_failed") {
      for (const [p, reject] of lsRejecters) {
        reject(frame.message);
        lsResolvers.delete(p);
        lsRejecters.delete(p);
      }
    }
  });

  function lsPath(path: string): Promise<FileEntry[]> {
    return new Promise((resolve, reject) => {
      lsResolvers.set(path, resolve);
      lsRejecters.set(path, reject);
      props.client.send({ v: 1, t: "fs.ls.request", path });
      setTimeout(() => {
        if (lsResolvers.has(path)) {
          lsResolvers.delete(path);
          lsRejecters.delete(path);
          reject("timeout");
        }
      }, 15000);
    });
  }

  async function navigate(path: string) {
    setState({ path, entries: null, loading: true, error: null });
    try {
      const entries = await lsPath(path);
      setState({ path, entries, loading: false, error: null });
    } catch (err) {
      setState({ path, entries: null, loading: false, error: typeof err === "string" ? err : String(err) });
    }
  }

  onMount(() => { navigate(props.rootCwd); });
  onCleanup(() => { unsub(); });

  const gitLookup = createMemo(() => {
    const g = props.gitStatus;
    const set = new Map<string, "modified" | "untracked" | "staged">();
    if (!g) return set;
    for (const p of g.staged ?? []) set.set(p, "staged");
    for (const p of g.modified ?? []) set.set(p, "modified");
    for (const p of g.untracked ?? []) set.set(p, "untracked");
    return set;
  });

  const visible = createMemo(() => {
    const e = state().entries;
    if (!e) return null;
    const filtered = showHidden() ? e.slice() : e.filter((x) => !x.name.startsWith("."));
    filtered.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return filtered;
  });

  function openEntry(entry: FileEntry) {
    if (entry.type === "dir") {
      navigate(entry.path);
    } else {
      if (props.onOpenFile) props.onOpenFile(entry.path);
      else setPreviewPath(entry.path);
    }
  }

  function goUp() {
    const p = parentOf(state().path);
    if (p) navigate(p);
  }

  const segments = createMemo(() => breadcrumbSegments(state().path));

  return (
    <div class="h-full w-full flex flex-col bg-bg-page relative min-h-0">
      <div class="shrink-0 border-b border-border-subtle bg-bg-surface">
        <div class="min-h-[44px] sm:min-h-[36px] flex items-center gap-1 px-2 sm:px-3">
          <IconButton aria-label="上一级" title="上一级" size="sm" onClick={goUp}
            disabled={parentOf(state().path) == null}>
            <span class="text-[14px]" aria-hidden="true">↑</span>
          </IconButton>
          <div class="flex-1 min-w-0 overflow-x-auto scrollbar-none">
            <div class="flex items-center gap-0.5 font-mono text-[12px] text-text-secondary whitespace-nowrap">
              <For each={segments()}>
                {(seg, i) => {
                  const total = segments().length;
                  const isLast = () => i() === total - 1;
                  const mobileVis = () => i() === 0 || i() === total - 1 || i() === total - 2;
                  return (
                    <>
                      <Show when={i() > 0}>
                        <span class="text-text-muted px-0.5" aria-hidden="true">/</span>
                      </Show>
                      <button type="button" onClick={() => navigate(seg.path)} title={seg.path}
                        class={`px-1 py-0.5 rounded hover:text-text-primary hover:bg-bg-surfaceStrong truncate max-w-[140px] ${isLast() ? "text-text-primary" : ""} ${mobileVis() ? "" : "hidden sm:inline-block"}`}>
                        {seg.label}
                      </button>
                    </>
                  );
                }}
              </For>
            </div>
          </div>
          <button type="button" aria-pressed={showHidden()} onClick={() => setShowHidden((v) => !v)}
            title={showHidden() ? "隐藏点文件" : "显示点文件"}
            class={`h-7 px-2 rounded-md font-sans text-[11px] border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              showHidden()
                ? "bg-accent/10 text-accent border-accent/30"
                : "bg-transparent text-text-muted border-border-subtle hover:text-text-primary hover:border-border-strong"
            }`}>
            .*
          </button>
          <IconButton aria-label="刷新" title="刷新" size="sm" onClick={() => navigate(state().path)}>
            <span class="text-[14px]" aria-hidden="true">⟳</span>
          </IconButton>
          <Show when={props.onClose}>
            <IconButton aria-label="关闭" title="关闭" size="sm" onClick={props.onClose}>
              <span class="text-[14px]" aria-hidden="true">✕</span>
            </IconButton>
          </Show>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto scrollbar">
        <Show when={state().loading}>
          <div class="py-10 flex items-center justify-center"><Spinner color="muted" /></div>
        </Show>
        <Show when={!state().loading && state().error}>
          <div class="px-4 py-6 text-[12px] text-danger font-mono">{state().error}</div>
        </Show>
        <Show when={!state().loading && !state().error && visible()}>
          <Show when={visible()!.length > 0} fallback={
            <EmptyState icon="📂" title="空目录"
              description={showHidden() ? undefined : "试试显示隐藏文件 (.*)"} />
          }>
            <ul class="py-1">
              <For each={visible()!}>
                {(entry) => {
                  const gs = () => gitLookup().get(entry.path);
                  const dotTone = () => {
                    const g = gs();
                    return g === "staged" ? "bg-success" : g === "modified" ? "bg-warn" : g === "untracked" ? "bg-danger" : "";
                  };
                  return (
                    <li>
                      <button type="button" onClick={() => openEntry(entry)} title={entry.path}
                        class="w-full flex items-center gap-2 px-3 py-2 min-h-[44px] sm:min-h-[32px] hover:bg-bg-surfaceStrong text-left cursor-pointer focus-visible:outline-none focus-visible:bg-bg-surfaceStrong">
                        <span class="text-[15px] leading-none shrink-0" aria-hidden="true">
                          {entry.type === "dir" ? "📁" : "📄"}
                        </span>
                        <span class="font-mono text-[13px] text-text-primary truncate flex-1 min-w-0">
                          {entry.name}{entry.type === "dir" ? "/" : ""}
                        </span>
                        <Show when={gs()}>
                          <span class={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotTone()}`}
                            title={gs()} aria-label={gs()} />
                        </Show>
                        <Show when={entry.type === "file" && entry.size != null}>
                          <span class="font-mono text-[11px] text-text-muted shrink-0 tabular-nums">
                            {formatBytes(entry.size!)}
                          </span>
                        </Show>
                      </button>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        </Show>
      </div>

      {/* Inline preview overlay (only when no onOpenFile callback) */}
      <Show when={!props.onOpenFile && previewPath()}>
        <div class="absolute inset-0 z-10 bg-bg-page">
          <FilePreview client={props.client} path={previewPath()!} onClose={() => setPreviewPath(null)} />
        </div>
      </Show>
    </div>
  );
}

export default FileBrowser;
