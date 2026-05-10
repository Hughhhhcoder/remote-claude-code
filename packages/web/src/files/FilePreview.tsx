import { createSignal, createEffect, onCleanup, onMount, Show, type JSX } from "solid-js";
import type { RccClient } from "../client.ts";
import { IconButton } from "../primitives/IconButton";
import { Chip } from "../primitives/Chip";
import { Spinner } from "../primitives/Spinner";

/**
 * FilePreview (v2) — read-only file viewer. Monaco is behind a dynamic
 * `import("monaco-editor")` so it never lands in the initial bundle. Files
 * larger than MONACO_MAX_BYTES fall back to <pre> (editor never loaded).
 */

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", md: "markdown", markdown: "markdown", py: "python", rs: "rust",
  go: "go", html: "html", htm: "html", css: "css", scss: "scss", yaml: "yaml",
  yml: "yaml", toml: "ini", sh: "shell", bash: "shell", zsh: "shell", xml: "xml",
  sql: "sql", java: "java", c: "c", cpp: "cpp", h: "c", hpp: "cpp", rb: "ruby",
  php: "php", swift: "swift", kt: "kotlin", dockerfile: "dockerfile",
};

function langForPath(path: string): string {
  const base = (path.toLowerCase().split("/").pop() ?? "");
  if (base === "dockerfile") return "dockerfile";
  const idx = base.lastIndexOf(".");
  if (idx < 0) return "plaintext";
  return LANG_BY_EXT[base.slice(idx + 1)] ?? "plaintext";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Files above this use <pre> instead of Monaco. */
const MONACO_MAX_BYTES = 1024 * 1024;
// Lazy Monaco — identical pattern to legacy FileBrowser.tsx.
let monacoPromise: Promise<typeof import("monaco-editor")> | null = null;
function loadMonaco(): Promise<typeof import("monaco-editor")> {
  if (!monacoPromise) {
    (self as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
      getWorker: () => {
        const blob = new Blob(["self.onmessage=()=>{};"], { type: "application/javascript" });
        return new Worker(URL.createObjectURL(blob));
      },
    };
    monacoPromise = import("monaco-editor");
  }
  return monacoPromise;
}

export interface FilePreviewProps {
  client: RccClient;
  path: string;
  onClose: () => void;
  /** When false, omit the sticky header (useful when embedded inline). */
  showHeader?: boolean;
}
interface Loaded { content: string; encoding: "utf8" | "base64"; size: number; truncated?: boolean }

export function FilePreview(props: FilePreviewProps): JSX.Element {
  const [loaded, setLoaded] = createSignal<Loaded | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const unsub = props.client.on((frame) => {
    if (frame.t === "fs.read" && frame.path === props.path) {
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      setLoaded({ content: frame.content, encoding: frame.encoding, size: frame.size, truncated: frame.truncated });
      setLoading(false);
      setError(null);
    } else if (frame.t === "error" && frame.code === "fs_read_failed") {
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      setError(frame.message);
      setLoading(false);
    }
  });

  onMount(() => {
    props.client.send({ v: 1, t: "fs.read.request", path: props.path });
    timeoutId = setTimeout(() => {
      if (loading()) { setError("timeout"); setLoading(false); }
    }, 20000);
  });

  onCleanup(() => { unsub(); if (timeoutId) clearTimeout(timeoutId); });

  async function copyContent() {
    const f = loaded();
    if (!f || f.encoding === "base64") return;
    try {
      await navigator.clipboard.writeText(f.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  const fileName = () => props.path.split("/").pop() ?? props.path;
  const useMonaco = () => {
    const f = loaded();
    return !!f && f.encoding === "utf8" && f.size < MONACO_MAX_BYTES;
  };
  return (
    <div class="h-full flex flex-col bg-bg-page min-h-0">
      <Show when={props.showHeader !== false}>
        <div class="h-12 shrink-0 flex items-center gap-2 px-3 border-b border-border-subtle bg-bg-surface">
          <div class="flex-1 min-w-0 flex items-center gap-2">
            <span class="text-[13px] shrink-0" aria-hidden="true">📄</span>
            <span class="font-mono text-[13px] text-text-primary truncate" title={props.path}>
              {fileName()}
            </span>
            <Show when={loaded()}>
              <Chip size="xs" tone="neutral">{langForPath(props.path)}</Chip>
            </Show>
          </div>
          <Show when={loaded() && loaded()!.encoding === "utf8"}>
            <IconButton aria-label={copied() ? "已复制" : "复制内容"}
              title={copied() ? "已复制" : "复制"} size="sm" onClick={copyContent}>
              <span class="text-[14px]" aria-hidden="true">{copied() ? "✓" : "⎘"}</span>
            </IconButton>
          </Show>
          <IconButton aria-label="关闭预览" title="关闭" size="sm" onClick={props.onClose}>
            <span class="text-[14px]" aria-hidden="true">✕</span>
          </IconButton>
        </div>
      </Show>

      <div class="flex-1 min-h-0 relative">
        <Show when={loading()}>
          <div class="absolute inset-0 flex items-center justify-center"><Spinner color="muted" /></div>
        </Show>
        <Show when={!loading() && error()}>
          <div class="p-4 text-[12px] text-danger font-mono">无法读取:{error()}</div>
        </Show>
        <Show when={!loading() && !error() && loaded()}>
          {loaded()!.encoding === "base64" ? (
            <div class="p-4 text-[12px] text-text-muted font-mono">
              二进制文件 ({formatBytes(loaded()!.size)}) — 无预览
            </div>
          ) : useMonaco() ? (
            <MonacoPane path={props.path} content={loaded()!.content} />
          ) : (
            <pre class="absolute inset-0 overflow-auto p-3 font-mono text-[12px] text-text-primary whitespace-pre leading-relaxed m-0">
              {loaded()!.content}
            </pre>
          )}
        </Show>
      </div>

      <Show when={loaded() && !error()}>
        <div class="h-6 shrink-0 flex items-center gap-3 px-3 text-[11px] font-mono text-text-muted border-t border-border-subtle bg-bg-surface">
          <span>{formatBytes(loaded()!.size)}</span>
          <Show when={loaded()!.encoding === "utf8"}><span>{loaded()!.content.split("\n").length} 行</span></Show>
          <Show when={loaded()!.truncated}><span class="text-warn">· 已截断</span></Show>
        </div>
      </Show>
    </div>
  );
}

function MonacoPane(props: { path: string; content: string }): JSX.Element {
  let container!: HTMLDivElement;
  let editor: import("monaco-editor").editor.IStandaloneCodeEditor | null = null;
  let disposed = false;

  onMount(() => {
    loadMonaco().then((monaco) => {
      if (disposed) return;
      editor = monaco.editor.create(container, {
        value: props.content, language: langForPath(props.path), theme: "vs-dark",
        readOnly: true, automaticLayout: true, minimap: { enabled: false },
        fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        scrollBeyondLastLine: false, lineNumbers: "on", wordWrap: "off",
        renderLineHighlight: "none",
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      });
    });
  });

  createEffect(() => {
    const path = props.path;
    const content = props.content;
    if (!editor) return;
    loadMonaco().then((monaco) => {
      if (!editor) return;
      const model = editor.getModel();
      if (!model) return;
      if (model.getValue() !== content) model.setValue(content);
      monaco.editor.setModelLanguage(model, langForPath(path));
    });
  });
  onCleanup(() => { disposed = true; editor?.dispose(); editor = null; });
  return <div ref={container} class="absolute inset-0" />;
}

export default FilePreview;
