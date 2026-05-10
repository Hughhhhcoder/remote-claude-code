import { createSignal, createEffect, onCleanup, lazy, Show, type JSX } from "solid-js";
import type { RccClient } from "../client.ts";
import type { RecordingStatusData } from "@rcc/protocol";
import { loadToken } from "../auth.ts";
import { Button } from "../primitives/Button.tsx";
import { IconButton } from "../primitives/IconButton.tsx";
import { EmptyState } from "../primitives/EmptyState.tsx";

const RecordingPlayback = lazy(() => import("./RecordingPlayback.tsx").then((m) => ({ default: m.RecordingPlayback })));

export interface RecordingPanelProps {
  client: RccClient;
  /** Current session id — recordings are per-session. May be null. */
  sid: string | null;
  /** When true, render as a header-compact control (icon + state dot). */
  compact?: boolean;
  /** Called when user picks a past recording to play. Passed the sid. */
  onPlayback?: (recordingId: string) => void;
  onClose?: () => void;
}

function authHeaders(): Record<string, string> {
  const token = loadToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatElapsed(startedAt: number | null): string {
  if (!startedAt) return "00:00";
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * RecordingPanel — per-session recording controls. Protocol model is ONE
 * recording per sid (`record.start` / `record.stop` / `record.status.request`
 * / `record.status`); the "录制列表" shows at most one row for the current
 * session. Compact mode mimics the legacy inline header control; full-pane
 * is the new Pane module usable from settings / dedicated tab.
 */
export function RecordingPanel(props: RecordingPanelProps): JSX.Element {
  const [status, setStatus] = createSignal<RecordingStatusData | null>(null);
  const [elapsed, setElapsed] = createSignal("00:00");
  const [busy, setBusy] = createSignal(false);
  const [playbackSid, setPlaybackSid] = createSignal<string | null>(null);

  function refresh(): void {
    const sid = props.sid;
    if (!sid) return;
    props.client.send({ v: 1, t: "record.status.request", sid });
  }

  const unsub = props.client.on((frame) => {
    if (frame.t === "record.status" && frame.status.sid === props.sid) {
      setStatus(frame.status);
      setBusy(false);
    }
  });
  onCleanup(unsub);

  createEffect(() => {
    const sid = props.sid;
    setStatus(null);
    if (sid) refresh();
  });

  // Poll every 2s while recording so size + elapsed stay live.
  let tick: ReturnType<typeof setInterval> | null = null;
  createEffect(() => {
    const s = status();
    if (tick) { clearInterval(tick); tick = null; }
    if (s?.recording) {
      setElapsed(formatElapsed(s.startedAt));
      tick = setInterval(() => { setElapsed(formatElapsed(s.startedAt)); refresh(); }, 2000);
    }
  });
  onCleanup(() => { if (tick) clearInterval(tick); });

  function onStart(): void {
    const sid = props.sid; if (!sid) return;
    setBusy(true); props.client.send({ v: 1, t: "record.start", sid });
  }
  function onStop(): void {
    const sid = props.sid; if (!sid) return;
    setBusy(true); props.client.send({ v: 1, t: "record.stop", sid });
  }

  async function onDownload(): Promise<void> {
    const sid = props.sid; if (!sid) return;
    const headers = authHeaders();
    try {
      const resp = await fetch(`/recording/${encodeURIComponent(sid)}.cast`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `rcc-${sid}.cast`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) { console.warn("[rcc] download recording failed:", err); }
  }

  async function onDelete(): Promise<void> {
    const sid = props.sid; if (!sid) return;
    if (!confirm("删除该会话的录制文件?")) return;
    try {
      const resp = await fetch(`/recording/${encodeURIComponent(sid)}`, { method: "DELETE", headers: authHeaders() });
      if (!resp.ok && resp.status !== 404) throw new Error(`HTTP ${resp.status}`);
      refresh();
    } catch (err) { console.warn("[rcc] delete recording failed:", err); }
  }

  function openPlayback(): void {
    const sid = props.sid; if (!sid) return;
    if (props.onPlayback) props.onPlayback(sid); else setPlaybackSid(sid);
  }

  const isRecording = () => !!status()?.recording;
  const hasFile = () => !!status()?.hasFile;
  const sidShort = () => (props.sid ? props.sid.slice(0, 8) : "—");

  const compactBtn = "text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 disabled:opacity-50 min-h-[28px]";

  const compactControl = (): JSX.Element => (
    <>
      <Show when={isRecording()}>
        <button class={`${compactBtn} border-danger/40 bg-danger/10 text-danger hover:bg-danger/20`} onClick={onStop} disabled={busy()} title="停止录制" aria-label="停止录制">
          <span class="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
          <span>⏹ {formatBytes(status()?.size ?? 0)}</span>
          <span class="text-text-muted">· {elapsed()}</span>
        </button>
      </Show>
      <Show when={!isRecording() && !hasFile()}>
        <button class={`${compactBtn} border-border-subtle text-text-secondary hover:text-danger hover:border-danger/40`} onClick={onStart} disabled={busy() || !props.sid} title="开始录制会话 (asciinema cast)" aria-label="开始录制">
          <span class="w-1.5 h-1.5 rounded-full bg-danger" /><span>录制</span>
        </button>
      </Show>
      <Show when={!isRecording() && hasFile()}>
        <div class="flex items-center gap-1">
          <button class={`${compactBtn} border-accent/40 bg-accent-bg text-accent hover:bg-accent-bg/70`} onClick={openPlayback} title="回放录制" aria-label="回放">▶ 回放</button>
          <button class={`${compactBtn} border-border-subtle text-text-secondary hover:text-text-primary`} onClick={onDownload} title={`下载 cast 文件 (${formatBytes(status()?.size ?? 0)})`} aria-label="下载">⬇</button>
          <button class={`${compactBtn} border-border-subtle text-text-muted hover:text-danger hover:border-danger/40`} onClick={onDelete} title="删除录制文件" aria-label="删除">🗑</button>
          <Show when={!!status()?.capped}><span class="text-[10px] text-warning" title="达到 50MB 上限,录制已自动停止">⚠ 已截断</span></Show>
        </div>
      </Show>
      <Show when={playbackSid() && !props.onPlayback}>
        <RecordingPlayback client={props.client} recordingId={playbackSid()!} onClose={() => setPlaybackSid(null)} />
      </Show>
    </>
  );

  const fullPane = (): JSX.Element => (
    <div class="flex flex-col h-full min-h-0 bg-bg-page text-text-primary">
      <header class="sticky top-0 z-10 bg-bg-page/95 backdrop-blur border-b border-border-subtle px-4 py-3 flex items-center gap-3 min-h-[56px]">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium flex items-center gap-2">
            <span>录屏</span>
            <span class="text-xs text-text-muted font-mono">· {sidShort()}</span>
            <Show when={isRecording()}>
              <span class="inline-flex items-center gap-1 text-danger text-xs font-mono">
                <span class="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />{elapsed()}
              </span>
            </Show>
          </div>
        </div>
        <Show when={isRecording()} fallback={<Button size="sm" variant="primary" disabled={busy() || !props.sid} onClick={onStart}>⏺ 录制</Button>}>
          <Button size="sm" variant="danger" disabled={busy()} onClick={onStop}>⏹ 停止</Button>
        </Show>
        <Show when={props.onClose}><IconButton size="sm" aria-label="关闭" onClick={() => props.onClose?.()}>×</IconButton></Show>
      </header>
      <div class="flex-1 min-h-0 overflow-auto">
        <Show when={isRecording()}>
          <section class="px-4 py-3 border-b border-border-subtle">
            <div class="text-[11px] uppercase tracking-wider text-text-muted mb-2">正在录制</div>
            <RecordingRow active label={`rcc-${sidShort()}.cast`} duration={elapsed()} size={formatBytes(status()?.size ?? 0)} timestamp={status()?.startedAt ? new Date(status()!.startedAt!).toLocaleTimeString() : ""} />
          </section>
        </Show>
        <section class="px-4 py-3">
          <div class="text-[11px] uppercase tracking-wider text-text-muted mb-2">录制列表</div>
          <Show when={hasFile() && !isRecording()} fallback={
            <Show when={!isRecording()}>
              <EmptyState icon="🎬" title="暂无录制" description={props.sid ? "点击右上角「录制」按钮开始记录当前会话(asciinema cast 格式)。" : "请先选择一个会话。"} />
            </Show>
          }>
            <RecordingRow label={`rcc-${sidShort()}.cast`} duration="—" size={formatBytes(status()?.size ?? 0)} timestamp="" onPlay={openPlayback} onDelete={onDelete} onDownload={onDownload} capped={!!status()?.capped} />
          </Show>
        </section>
      </div>

      <Show when={playbackSid() && !props.onPlayback}>
        <RecordingPlayback client={props.client} recordingId={playbackSid()!} onClose={() => setPlaybackSid(null)} />
      </Show>
    </div>
  );

  return <Show when={props.compact} fallback={fullPane()}>{compactControl()}</Show>;
}

interface RowProps { active?: boolean; label: string; duration: string; size: string; timestamp: string; onPlay?: () => void; onDownload?: () => void; onDelete?: () => void; capped?: boolean }

function RecordingRow(props: RowProps): JSX.Element {
  return (
    <div class={`flex items-center gap-3 rounded-md px-3 border transition duration-fast ease-rcc min-h-[56px] ${props.active ? "border-danger/40 bg-danger/5" : "border-border-subtle hover:bg-bg-surfaceStrong"}`}>
      <div class={`w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0 ${props.active ? "bg-danger/20 text-danger" : "bg-bg-surfaceStrong"}`} aria-hidden="true">{props.active ? "⏺" : "🎬"}</div>
      <div class="flex-1 min-w-0">
        <div class="text-sm truncate font-mono">{props.label}</div>
        <div class="text-[11px] text-text-muted font-mono truncate">
          {props.duration} · {props.size}
          <Show when={props.timestamp}> · {props.timestamp}</Show>
          <Show when={props.capped}><span class="text-warning"> · ⚠ 已截断</span></Show>
        </div>
      </div>
      <Show when={!props.active}>
        <div class="flex items-center gap-1 shrink-0">
          <Show when={props.onPlay}><IconButton size="sm" tone="accent" aria-label="播放" title="播放" onClick={() => props.onPlay?.()}>▶</IconButton></Show>
          <Show when={props.onDownload}><IconButton size="sm" aria-label="下载" title="下载" onClick={() => props.onDownload?.()}>⬇</IconButton></Show>
          <Show when={props.onDelete}><IconButton size="sm" tone="danger" aria-label="删除" title="删除" onClick={() => props.onDelete?.()}>🗑</IconButton></Show>
        </div>
      </Show>
    </div>
  );
}

export default RecordingPanel;
