import { createSignal, createEffect, onCleanup, onMount, For, Show } from "solid-js";
import type { FileEntry } from "@rcc/protocol";
import type { RccClient } from "./client.ts";

interface FileBrowserProps {
  client: RccClient;
  rootCwd: string;
}

interface TreeNode {
  entry: FileEntry;
  children: TreeNode[] | null;
  expanded: boolean;
  loading: boolean;
  error: string | null;
}

interface SelectedFile {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  size: number;
  truncated?: boolean;
}

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  xml: "xml",
  sql: "sql",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  dockerfile: "dockerfile",
};

function langForPath(path: string): string {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  if (base === "dockerfile") return "dockerfile";
  const idx = base.lastIndexOf(".");
  if (idx < 0) return "plaintext";
  const ext = base.slice(idx + 1);
  return LANG_BY_EXT[ext] ?? "plaintext";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatMtime(ms: number | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleString();
}

// Shorten path for display — strip home prefix.
function shorten(p: string): string {
  // Best-effort; we don't know the user's home here, but paths from the
  // host are already absolute. UI uses them verbatim in breadcrumb.
  return p;
}

let monacoPromise: Promise<typeof import("monaco-editor")> | null = null;
function loadMonaco(): Promise<typeof import("monaco-editor")> {
  if (!monacoPromise) {
    // Silence web worker requests — we only need the editor, not language workers.
    // Falling back to no worker produces a warning but works for read-only.
    (self as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
      getWorker: () => {
        // Return a dummy worker — the editor still functions without language services.
        const blob = new Blob(["self.onmessage=()=>{};"], { type: "application/javascript" });
        return new Worker(URL.createObjectURL(blob));
      },
    };
    monacoPromise = import("monaco-editor");
  }
  return monacoPromise;
}

export function FileBrowser(props: FileBrowserProps) {
  const [root, setRoot] = createSignal<TreeNode | null>(null);
  const [rootPath, setRootPath] = createSignal<string>(props.rootCwd);
  const [selected, setSelected] = createSignal<SelectedFile | null>(null);
  const [selectedLoading, setSelectedLoading] = createSignal(false);
  const [selectedError, setSelectedError] = createSignal<string | null>(null);
  const [rootError, setRootError] = createSignal<string | null>(null);

  // Pending resolvers keyed by path.
  const lsResolvers = new Map<string, (entries: FileEntry[]) => void>();
  const lsRejecters = new Map<string, (err: string) => void>();
  const readResolvers = new Map<string, (payload: {
    content: string;
    encoding: "utf8" | "base64";
    size: number;
    truncated?: boolean;
  }) => void>();
  const readRejecters = new Map<string, (err: string) => void>();

  const unsub = props.client.on((frame) => {
    if (frame.t === "fs.ls") {
      const r = lsResolvers.get(frame.path);
      if (r) {
        lsResolvers.delete(frame.path);
        lsRejecters.delete(frame.path);
        r(frame.entries);
      }
    } else if (frame.t === "fs.read") {
      const r = readResolvers.get(frame.path);
      if (r) {
        readResolvers.delete(frame.path);
        readRejecters.delete(frame.path);
        r({
          content: frame.content,
          encoding: frame.encoding,
          size: frame.size,
          truncated: frame.truncated,
        });
      }
    } else if (frame.t === "error") {
      // We don't know which path the error belongs to; surface to all pending.
      if (frame.code === "fs_ls_failed") {
        for (const [p, reject] of lsRejecters) {
          reject(frame.message);
          lsResolvers.delete(p);
          lsRejecters.delete(p);
        }
      } else if (frame.code === "fs_read_failed") {
        for (const [p, reject] of readRejecters) {
          reject(frame.message);
          readResolvers.delete(p);
          readRejecters.delete(p);
        }
      }
    }
  });

  function lsPath(path: string): Promise<FileEntry[]> {
    return new Promise<FileEntry[]>((resolve, reject) => {
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

  function readPath(path: string): Promise<{
    content: string;
    encoding: "utf8" | "base64";
    size: number;
    truncated?: boolean;
  }> {
    return new Promise((resolve, reject) => {
      readResolvers.set(path, resolve);
      readRejecters.set(path, reject);
      props.client.send({ v: 1, t: "fs.read.request", path });
      setTimeout(() => {
        if (readResolvers.has(path)) {
          readResolvers.delete(path);
          readRejecters.delete(path);
          reject("timeout");
        }
      }, 20000);
    });
  }

  async function loadRoot(path: string) {
    setRootError(null);
    try {
      const entries = await lsPath(path);
      // The host normalizes path — but we don't get it back except as frame.path
      // which equals what we sent through our handler. Trust input after server ok.
      const rootEntry: FileEntry = {
        name: path.split("/").pop() || path,
        path,
        type: "dir",
      };
      setRoot({
        entry: rootEntry,
        children: entries.map(entryToNode),
        expanded: true,
        loading: false,
        error: null,
      });
      setRootPath(path);
    } catch (err) {
      setRootError(typeof err === "string" ? err : String(err));
    }
  }

  function entryToNode(entry: FileEntry): TreeNode {
    return {
      entry,
      children: null,
      expanded: false,
      loading: false,
      error: null,
    };
  }

  async function toggleDir(node: TreeNode) {
    if (node.entry.type !== "dir") return;
    if (node.expanded) {
      node.expanded = false;
      setRoot((r) => (r ? { ...r } : r));
      return;
    }
    if (!node.children) {
      node.loading = true;
      node.error = null;
      setRoot((r) => (r ? { ...r } : r));
      try {
        const entries = await lsPath(node.entry.path);
        node.children = entries.map(entryToNode);
        node.expanded = true;
        node.loading = false;
      } catch (err) {
        node.error = typeof err === "string" ? err : String(err);
        node.loading = false;
      }
      setRoot((r) => (r ? { ...r } : r));
    } else {
      node.expanded = true;
      setRoot((r) => (r ? { ...r } : r));
    }
  }

  async function selectFile(entry: FileEntry) {
    setSelectedLoading(true);
    setSelectedError(null);
    try {
      const res = await readPath(entry.path);
      setSelected({
        path: entry.path,
        content: res.content,
        encoding: res.encoding,
        size: res.size,
        truncated: res.truncated,
      });
    } catch (err) {
      setSelected({ path: entry.path, content: "", encoding: "utf8", size: 0 });
      setSelectedError(typeof err === "string" ? err : String(err));
    } finally {
      setSelectedLoading(false);
    }
  }

  function refresh() {
    const r = root();
    if (!r) {
      loadRoot(rootPath());
      return;
    }
    // Invalidate children recursively.
    invalidate(r);
    loadRoot(rootPath());
  }

  function invalidate(node: TreeNode) {
    node.children = null;
    node.expanded = false;
  }

  onMount(() => {
    loadRoot(props.rootCwd);
  });

  onCleanup(() => {
    unsub();
  });

  return (
    <div class="h-full flex flex-col bg-zinc-950">
      <div class="h-12 border-b border-zinc-900 px-3 flex items-center gap-2 shrink-0">
        <span class="text-xs text-zinc-500 shrink-0">📁</span>
        <input
          class="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] font-mono text-zinc-300 outline-none focus:border-zinc-700"
          value={rootPath()}
          onChange={(e) => loadRoot(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") loadRoot(e.currentTarget.value);
          }}
          spellcheck={false}
          title="根目录路径 (Enter 加载)"
        />
        <button
          class="text-xs text-zinc-500 hover:text-zinc-200 px-1.5"
          onClick={refresh}
          title="刷新"
        >
          ⟳
        </button>
      </div>

      <div class="flex-1 min-h-0 grid" style="grid-template-rows: 1fr 1fr;">
        {/* Tree */}
        <div class="border-b border-zinc-900 overflow-y-auto scrollbar px-1 py-2">
          <div class="text-[10px] uppercase tracking-widest text-zinc-600 px-2 py-1">
            Working tree
          </div>
          <Show when={rootError()}>
            <div class="px-2 py-1 text-[11px] text-rose-400">{rootError()}</div>
          </Show>
          <Show when={root()}>
            <div class="font-mono text-[12px]">
              <TreeNodeView
                node={root()!}
                depth={0}
                onToggle={toggleDir}
                onSelect={selectFile}
                selectedPath={selected()?.path ?? null}
              />
            </div>
          </Show>
        </div>

        {/* Preview */}
        <div class="flex flex-col overflow-hidden">
          <div class="h-8 px-3 flex items-center justify-between border-b border-zinc-900 shrink-0">
            <div class="text-[11px] font-mono text-zinc-400 truncate" title={selected()?.path ?? ""}>
              {selected()?.path.split("/").pop() ?? "—"}
            </div>
            <Show when={selected()}>
              <div class="text-[10px] text-zinc-600 font-mono shrink-0 ml-2">
                {formatBytes(selected()!.size)}
                <Show when={selected()!.truncated}>
                  <span class="text-amber-400 ml-1">· 已截断</span>
                </Show>
              </div>
            </Show>
          </div>
          <div class="flex-1 min-h-0 relative">
            <Show when={selectedLoading()}>
              <div class="absolute inset-0 grid place-items-center text-[11px] text-zinc-500">
                加载中…
              </div>
            </Show>
            <Show when={!selectedLoading() && selectedError()}>
              <div class="p-3 text-[11px] text-rose-400">{selectedError()}</div>
            </Show>
            <Show when={!selectedLoading() && !selectedError() && selected()}>
              <PreviewPane file={selected()!} />
            </Show>
            <Show when={!selected() && !selectedLoading()}>
              <div class="absolute inset-0 grid place-items-center text-[11px] text-zinc-600">
                选择文件预览
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}

function TreeNodeView(props: {
  node: TreeNode;
  depth: number;
  onToggle: (n: TreeNode) => void;
  onSelect: (e: FileEntry) => void;
  selectedPath: string | null;
}) {
  const isDir = () => props.node.entry.type === "dir";
  const isSelected = () => props.selectedPath === props.node.entry.path;

  return (
    <>
      <div
        class={`flex items-center px-2 py-0.5 rounded cursor-pointer ${
          isSelected() ? "bg-orange-500/10 text-orange-300" : "text-zinc-400 hover:bg-zinc-900"
        }`}
        style={{ "padding-left": `${8 + props.depth * 12}px` }}
        onClick={() => {
          if (isDir()) props.onToggle(props.node);
          else props.onSelect(props.node.entry);
        }}
        title={props.node.entry.path}
      >
        <span class="w-3 text-[10px] text-zinc-600 shrink-0">
          {isDir() ? (props.node.expanded ? "▾" : "▸") : ""}
        </span>
        <span class="truncate">{props.node.entry.name}</span>
        <Show when={props.node.loading}>
          <span class="ml-2 text-[10px] text-zinc-600">…</span>
        </Show>
      </div>
      <Show when={props.node.error}>
        <div
          class="text-[10px] text-rose-400 px-2"
          style={{ "padding-left": `${20 + props.depth * 12}px` }}
        >
          {props.node.error}
        </div>
      </Show>
      <Show when={isDir() && props.node.expanded && props.node.children}>
        <For each={props.node.children!}>
          {(child) => (
            <TreeNodeView
              node={child}
              depth={props.depth + 1}
              onToggle={props.onToggle}
              onSelect={props.onSelect}
              selectedPath={props.selectedPath}
            />
          )}
        </For>
      </Show>
    </>
  );
}

function PreviewPane(props: { file: SelectedFile }) {
  let container!: HTMLDivElement;
  let editor: import("monaco-editor").editor.IStandaloneCodeEditor | null = null;
  let disposed = false;

  if (props.file.encoding === "base64") {
    return (
      <div class="p-4 text-[12px] text-zinc-500 font-mono">
        二进制文件 ({formatBytes(props.file.size)}) — 无预览
      </div>
    );
  }

  onMount(() => {
    loadMonaco().then((monaco) => {
      if (disposed) return;
      editor = monaco.editor.create(container, {
        value: props.file.content,
        language: langForPath(props.file.path),
        theme: "vs-dark",
        readOnly: true,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 12,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        scrollBeyondLastLine: false,
        lineNumbers: "on",
        wordWrap: "off",
        renderLineHighlight: "none",
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      });
    });
  });

  createEffect(() => {
    const file = props.file;
    if (!editor) return;
    loadMonaco().then((monaco) => {
      if (!editor) return;
      const model = editor.getModel();
      const lang = langForPath(file.path);
      if (model) {
        if (model.getValue() !== file.content) model.setValue(file.content);
        monaco.editor.setModelLanguage(model, lang);
      }
    });
  });

  onCleanup(() => {
    disposed = true;
    editor?.dispose();
    editor = null;
  });

  return <div ref={container} class="absolute inset-0" />;
}
