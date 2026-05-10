// [B31-B] One-button bug report tarball UI.
//
// Opens from Settings → "报告 Bug". Gathers a client snapshot + recent audit
// entries + (opt-in) last 50 chat messages and serializes to redacted JSON.
// Two actions: "下载 JSON" (anchor.click()) and "复制到剪贴板". No upload —
// the user pastes or attaches the bundle themselves.
//
// Chat inclusion is off by default: messages can contain filesystem paths,
// prompts with user data, etc. The redaction pass scrubs long hashes and
// paths but can't reason about semantics, so the switch stays consent-gated.
//
// Audit fetch uses the existing `audit.query.request` → `audit.entries`
// round-trip (shared with AuditTab). We register a one-shot listener, then
// `client.send(... limit: 100)` and resolve when the frame arrives or the
// 3s timeout fires. No protocol changes.
import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import type { AuditEntry } from "@rcc/protocol";
import type { RccClient } from "./client.ts";
import type { PrefsStore } from "./prefs.ts";
import type { SessionsStore } from "./stores/sessionsStore.ts";
import { loadToken } from "./auth.ts";
import { loadCachedMessages } from "./hooks/useOfflineHydrate.ts";
import { toast } from "./primitives/Toast.tsx";
import {
  buildBugReport,
  serializeBundle,
  suggestFilename,
  type BugReportBundle,
  type VersionInfoInput,
  type DeviceInput,
} from "./bug-report.ts";

interface Props {
  open: boolean;
  client: RccClient;
  prefsStore: PrefsStore;
  sessionsStore: SessionsStore;
  device: DeviceInput | null;
  onClose: () => void;
}

async function fetchVersion(): Promise<VersionInfoInput | null> {
  try {
    const token = loadToken();
    const headers: Record<string, string> = {};
    if (token) headers["authorization"] = `Bearer ${token}`;
    const resp = await fetch("/version", { headers });
    if (!resp.ok) return null;
    return (await resp.json()) as VersionInfoInput;
  } catch {
    return null;
  }
}

function fetchAudit(client: RccClient): Promise<AuditEntry[]> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      unsub();
      resolve([]);
    }, 3000);
    const unsub = client.on((frame) => {
      if (frame.t !== "audit.entries") return;
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      resolve(frame.entries.slice(-100));
    });
    client.send({
      v: 1,
      t: "audit.query.request",
      limit: 100,
    });
  });
}

function downloadJson(text: string, filename: string): void {
  try {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    toast(`下载失败: ${err instanceof Error ? err.message : "unknown"}`, {
      tone: "danger",
    });
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to textarea fallback
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function BugReportModal(props: Props) {
  const [includeChat, setIncludeChat] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [bundle, setBundle] = createSignal<BugReportBundle | null>(null);
  const [serialized, setSerialized] = createSignal<string>("");
  const [error, setError] = createSignal<string | null>(null);

  // Re-gather when the modal opens or the opt-in toggle changes. We keep the
  // bundle live in state so "下载 JSON" and "复制到剪贴板" both see the same
  // snapshot (with matching timestamp in the filename).
  createEffect(() => {
    if (!props.open) {
      setBundle(null);
      setSerialized("");
      setError(null);
      return;
    }
    void gather();
  });

  onCleanup(() => {
    setBundle(null);
    setSerialized("");
  });

  async function gather(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const [versionInfo, auditEntries] = await Promise.all([
        fetchVersion(),
        fetchAudit(props.client),
      ]);
      const sid = props.sessionsStore.activeSid();
      const chatMessages = includeChat() && sid ? loadCachedMessages(sid) : [];
      const built = buildBugReport({
        versionInfo,
        sessions: props.sessionsStore.sessions(),
        activeSid: sid,
        prefs: props.prefsStore.prefs(),
        device: props.device,
        auditEntries,
        includeChat: includeChat(),
        chatSid: sid,
        chatMessages,
      });
      setBundle(built);
      setSerialized(serializeBundle(built));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onDownload(): void {
    const text = serialized();
    if (!text) return;
    const name = suggestFilename(bundle()?.generatedAt ?? Date.now());
    downloadJson(text, name);
  }

  async function onCopy(): Promise<void> {
    const text = serialized();
    if (!text) return;
    const ok = await copyToClipboard(text);
    toast(ok ? "已复制到剪贴板" : "复制失败,请手动下载", {
      tone: ok ? "info" : "warn",
    });
  }

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3"
        onClick={props.onClose}
      >
        <div
          class="w-full max-w-xl max-h-[90vh] flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Bug report"
        >
          <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-900">
            <div class="flex items-center gap-2 text-sm font-medium">
              <span>🐞</span>
              <span>报告 Bug</span>
            </div>
            <button
              class="text-zinc-500 hover:text-zinc-200 text-sm"
              onClick={props.onClose}
              title="关闭"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>

          <div class="p-5 space-y-4 overflow-y-auto">
            <div class="text-xs text-zinc-400 leading-relaxed">
              生成一份诊断快照(JSON),包含最近 100 条审计日志、会话列表摘要、客户端偏好、
              浏览器信息和版本信息。令牌、密码、密钥、长哈希和绝对路径会被自动脱敏。
              不会上传任何数据 —— 你自行粘贴或附在反馈里。
            </div>

            <label class="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                class="mt-0.5 accent-accent-500"
                checked={includeChat()}
                onChange={(e) => {
                  setIncludeChat(e.currentTarget.checked);
                  if (props.open) void gather();
                }}
              />
              <span>
                <div class="text-zinc-200">包含当前会话的聊天记录(最近 50 条)</div>
                <div class="text-[11px] text-zinc-500 mt-0.5">
                  聊天内容可能含有提示词、文件路径、代码片段等。仅在复现问题时勾选,
                  并在提交前自行检查 JSON 内容。
                </div>
              </span>
            </label>

            <div class="rounded-lg border border-zinc-800 bg-zinc-900/50">
              <div class="flex items-center justify-between px-3 py-2 border-b border-zinc-800 text-[11px] text-zinc-500">
                <span>预览</span>
                <Show when={bundle()}>
                  <span class="font-mono">
                    {(serialized().length / 1024).toFixed(1)} KB · {bundle()?.auditEntries.length ?? 0} 条审计
                    <Show when={bundle()?.chatHistory.included}>
                      <span> · {bundle()?.chatHistory.messageCount} 条消息</span>
                    </Show>
                  </span>
                </Show>
              </div>
              <Show
                when={!busy() && serialized()}
                fallback={
                  <div class="px-3 py-4 text-[11px] text-zinc-500">
                    <Show when={busy()} fallback={<span>准备中…</span>}>
                      <span>收集中…</span>
                    </Show>
                  </div>
                }
              >
                <pre
                  class="px-3 py-2 text-[10px] font-mono text-zinc-400 whitespace-pre-wrap break-all max-h-48 overflow-y-auto scrollbar"
                >
                  {serialized().slice(0, 1200)}
                  <Show when={serialized().length > 1200}>
                    <span class="text-zinc-600">{"\n…（截断预览,完整数据请下载/复制）"}</span>
                  </Show>
                </pre>
              </Show>
            </div>

            <Show when={error()}>
              <div class="text-[11px] text-rose-400 font-mono">{error()}</div>
            </Show>
          </div>

          <div class="px-5 py-3 border-t border-zinc-900 flex items-center justify-end gap-2">
            <button
              class="px-3 py-1.5 rounded-lg text-xs border border-zinc-800 text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => void onCopy()}
              disabled={busy() || !serialized()}
            >
              复制到剪贴板
            </button>
            <button
              class="px-3 py-1.5 rounded-lg text-xs border border-accent-500/50 bg-accent-500/15 text-accent-300 hover:bg-accent-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={onDownload}
              disabled={busy() || !serialized()}
            >
              下载 JSON
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
