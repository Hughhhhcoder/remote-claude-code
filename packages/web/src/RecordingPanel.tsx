import { createSignal, createEffect, onCleanup, lazy, Show } from "solid-js";
import type { RccClient } from "./client.ts";
import type { RecordingStatusData } from "@rcc/protocol";
import { loadToken } from "./auth.ts";

const RecordingPlayback = lazy(() =>
  import("./RecordingPlayback.tsx").then((m) => ({ default: m.RecordingPlayback })),
);

interface Props {
  client: RccClient;
  sid: string | null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatElapsed(startedAt: number | null): string {
  if (!startedAt) return "00:00";
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  const m = Math.floor(secs / 60)
    .toString()
    .padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * Session-header recording control. Tri-state:
 *   - idle + no file  → [⏺ 录制]
 *   - recording       → [⏹ 停止 · size · elapsed]  (red pulse)
 *   - idle + hasFile  → [▶ 回放] [⬇] [🗑]
 */
export function RecordingPanel(props: Props) {
  const [status, setStatus] = createSignal<RecordingStatusData | null>(null);
  const [elapsed, setElapsed] = createSignal("00:00");
  const [busy, setBusy] = createSignal(false);
  const [playbackOpen, setPlaybackOpen] = createSignal(false);

  function refresh() {
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

  // Poll size + elapsed while recording so the UI stays live without needing
  // the host to push status every second. Pulls a fresh status frame every 2s.
  let tick: ReturnType<typeof setInterval> | null = null;
  createEffect(() => {
    const s = status();
    if (tick) {
      clearInterval(tick);
      tick = null;
    }
    if (s?.recording) {
      setElapsed(formatElapsed(s.startedAt));
      tick = setInterval(() => {
        setElapsed(formatElapsed(s.startedAt));
        refresh();
      }, 2000);
    }
  });
  onCleanup(() => {
    if (tick) clearInterval(tick);
  });

  async function onStart() {
    const sid = props.sid;
    if (!sid) return;
    setBusy(true);
    props.client.send({ v: 1, t: "record.start", sid });
  }

  async function onStop() {
    const sid = props.sid;
    if (!sid) return;
    setBusy(true);
    props.client.send({ v: 1, t: "record.stop", sid });
  }

  async function onDownload() {
    const sid = props.sid;
    if (!sid) return;
    const token = loadToken();
    const headers: Record<string, string> = {};
    if (token) headers["authorization"] = `Bearer ${token}`;
    try {
      const resp = await fetch(`/recording/${encodeURIComponent(sid)}.cast`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rcc-${sid}.cast`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn("[rcc] download recording failed:", err);
    }
  }

  async function onDelete() {
    const sid = props.sid;
    if (!sid) return;
    if (!confirm("删除该会话的录制文件?")) return;
    const token = loadToken();
    const headers: Record<string, string> = {};
    if (token) headers["authorization"] = `Bearer ${token}`;
    try {
      const resp = await fetch(`/recording/${encodeURIComponent(sid)}`, {
        method: "DELETE",
        headers,
      });
      if (!resp.ok && resp.status !== 404) throw new Error(`HTTP ${resp.status}`);
      refresh();
    } catch (err) {
      console.warn("[rcc] delete recording failed:", err);
    }
  }

  const isRecording = () => !!status()?.recording;
  const hasFile = () => !!status()?.hasFile;
  const capped = () => !!status()?.capped;

  return (
    <>
      <Show when={isRecording()}>
        <button
          class="text-[10px] px-1.5 py-0.5 rounded border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 flex items-center gap-1 disabled:opacity-50"
          onClick={onStop}
          disabled={busy()}
          title="停止录制"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
          <span>⏹ {formatBytes(status()?.size ?? 0)}</span>
          <span class="text-zinc-500">· {elapsed()}</span>
        </button>
      </Show>
      <Show when={!isRecording() && !hasFile()}>
        <button
          class="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:text-rose-300 hover:border-rose-500/40 flex items-center gap-1 disabled:opacity-50"
          onClick={onStart}
          disabled={busy() || !props.sid}
          title="开始录制会话 (asciinema cast)"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-rose-500" />
          <span>录制</span>
        </button>
      </Show>
      <Show when={!isRecording() && hasFile()}>
        <div class="flex items-center gap-1">
          <button
            class="text-[10px] px-1.5 py-0.5 rounded border border-accent-500/40 bg-accent-500/10 text-accent-300 hover:bg-accent-500/20"
            onClick={() => setPlaybackOpen(true)}
            title="回放录制"
          >
            ▶ 回放
          </button>
          <button
            class="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-100"
            onClick={onDownload}
            title={`下载 cast 文件 (${formatBytes(status()?.size ?? 0)})`}
          >
            ⬇
          </button>
          <button
            class="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-500 hover:text-rose-300 hover:border-rose-500/40"
            onClick={onDelete}
            title="删除录制文件"
          >
            🗑
          </button>
          <Show when={capped()}>
            <span
              class="text-[10px] text-amber-400"
              title="达到 50MB 上限,录制已自动停止"
            >
              ⚠ 已截断
            </span>
          </Show>
        </div>
      </Show>
      <Show when={playbackOpen() && props.sid}>
        <RecordingPlayback
          sid={props.sid!}
          onClose={() => setPlaybackOpen(false)}
        />
      </Show>
    </>
  );
}
