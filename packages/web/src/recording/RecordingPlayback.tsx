import { createSignal, createEffect, onCleanup, onMount, Show, For, type JSX } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { RccClient } from "../client.ts";
import { loadToken } from "../auth.ts";
import { IconButton } from "../primitives/IconButton.tsx";

export interface RecordingPlaybackProps {
  client: RccClient;
  /** Recording id — in this protocol, equal to the session id. */
  recordingId: string;
  onClose: () => void;
}

interface CastEvent { t: number; data: string }
interface CastHeader { version: number; width: number; height: number; timestamp?: number; title?: string }

const SPEEDS = [0.5, 1, 2, 4] as const;

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * Asciinema v2 player — lightweight xterm-based playback of the `.cast` file
 * for a given recording (session id). Fetches the file over authenticated
 * HTTP then drives xterm via requestAnimationFrame. Supports play / pause /
 * speed (0.5/1/2/4) / seek. `client` is accepted for future ws-streamed
 * playback but the current protocol only exposes the HTTP cast endpoint.
 */
export function RecordingPlayback(props: RecordingPlaybackProps): JSX.Element {
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [header, setHeader] = createSignal<CastHeader | null>(null);
  const [events, setEvents] = createSignal<CastEvent[]>([]);
  const [playing, setPlaying] = createSignal(false);
  const [speed, setSpeed] = createSignal<number>(1);
  const [currentT, setCurrentT] = createSignal(0);

  let termHost!: HTMLDivElement;
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;

  // Non-reactive playback cursor state (reactivity here would cause tearing).
  let nextIndex = 0;
  let wallStart = 0;
  let virtualOffset = 0;
  let rafHandle: number | null = null;

  async function load(): Promise<void> {
    setLoading(true); setError(null);
    try {
      const token = loadToken();
      const headers: Record<string, string> = {};
      if (token) headers["authorization"] = `Bearer ${token}`;
      const resp = await fetch(`/recording/${encodeURIComponent(props.recordingId)}.cast`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const lines = text.split("\n").filter((l) => l.length > 0);
      if (lines.length === 0) throw new Error("empty cast file");
      const h = JSON.parse(lines[0]!) as CastHeader;
      if (h.version !== 2) throw new Error(`unsupported cast version ${h.version}`);
      const evts: CastEvent[] = [];
      for (let i = 1; i < lines.length; i++) {
        try {
          const arr = JSON.parse(lines[i]!);
          if (Array.isArray(arr) && arr.length >= 3 && arr[1] === "o") {
            evts.push({ t: Number(arr[0]), data: String(arr[2]) });
          }
        } catch { /* skip malformed trailing lines (partial writes at cap) */ }
      }
      setHeader(h); setEvents(evts); setLoading(false);
      if (term) { try { term.resize(h.width, h.height); } catch { /* ignore */ } }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  onMount(() => {
    term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13, lineHeight: 1.35, cursorBlink: false, convertEol: false,
      disableStdin: true, allowProposedApi: true, scrollback: 5000,
      theme: {
        background: "#09090b", foreground: "#e4e4e7", cursor: "#fb923c",
        cursorAccent: "#0a0a0a", selectionBackground: "#3f3f46",
      },
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termHost);
    try { fit.fit(); } catch { /* ignore */ }
    void load();
  });

  onCleanup(() => {
    stopLoop();
    if (term) { try { term.dispose(); } catch { /* ignore */ } term = null; }
  });

  function stopLoop(): void { if (rafHandle !== null) { cancelAnimationFrame(rafHandle); rafHandle = null; } }
  function totalDuration(): number { const e = events(); return e.length > 0 ? e[e.length - 1]!.t : 0; }

  function play(): void {
    if (playing()) return;
    const evts = events(); if (evts.length === 0) return;
    if (nextIndex >= evts.length) rewindTo(0);
    wallStart = performance.now();
    virtualOffset = currentT();
    setPlaying(true);
    tick();
  }

  function pause(): void { if (!playing()) return; setPlaying(false); stopLoop(); }

  function tick(): void {
    if (!playing() || !term) return;
    const evts = events();
    const virtualT = virtualOffset + ((performance.now() - wallStart) / 1000) * speed();
    while (nextIndex < evts.length && evts[nextIndex]!.t <= virtualT) {
      term.write(evts[nextIndex]!.data); nextIndex++;
    }
    setCurrentT(virtualT);
    if (nextIndex >= evts.length) {
      setPlaying(false); setCurrentT(totalDuration()); stopLoop(); return;
    }
    rafHandle = requestAnimationFrame(tick);
  }

  function rewindTo(t: number): void {
    if (!term) return;
    const evts = events();
    stopLoop(); setPlaying(false); term.reset();
    nextIndex = 0;
    const target = Math.max(0, t);
    while (nextIndex < evts.length && evts[nextIndex]!.t <= target) {
      term.write(evts[nextIndex]!.data); nextIndex++;
    }
    setCurrentT(target);
  }

  function onSpeedChange(next: number): void {
    const wasPlaying = playing();
    if (wasPlaying) pause();
    setSpeed(next);
    if (wasPlaying) play();
  }

  // Auto-play once events arrive.
  createEffect(() => {
    const evts = events();
    if (evts.length > 0 && nextIndex === 0) setTimeout(() => play(), 100);
  });

  function onSeek(ev: Event): void {
    const target = ev.currentTarget as HTMLInputElement;
    const wasPlaying = playing();
    rewindTo(Number(target.value));
    if (wasPlaying) play();
  }

  const disabled = () => loading() || !!error() || events().length === 0;
  const speedBtn = (sp: number) => speed() === sp
    ? "text-[10px] px-1.5 py-0.5 rounded border border-accent bg-accent-bg text-accent min-h-[24px]"
    : "text-[10px] px-1.5 py-0.5 rounded border border-border-subtle text-text-muted hover:text-text-primary min-h-[24px]";

  return (
    <div class="fixed inset-0 bg-black/70 grid place-items-center z-50 p-2 sm:p-4" onClick={props.onClose}>
      <div class="bg-bg-page border border-border-subtle rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header class="sticky top-0 px-4 py-2.5 border-b border-border-subtle flex items-center justify-between shrink-0 bg-bg-page">
          <div class="text-sm font-medium flex items-center gap-2 min-w-0">
            <span>▶ 会话回放</span>
            <Show when={header()}>
              <span class="text-[11px] font-normal text-text-muted truncate">{header()!.width}×{header()!.height} · {events().length} 事件</span>
            </Show>
          </div>
          <IconButton size="sm" aria-label="关闭" onClick={props.onClose}>×</IconButton>
        </header>
        <Show when={error()}>
          <div class="px-4 py-3 text-xs text-danger bg-danger/10 border-b border-danger/30">加载失败: {error()}</div>
        </Show>
        <div class="flex-1 min-h-0 overflow-auto bg-[#09090b] max-w-full">
          <div ref={termHost} class="w-full h-full" />
          <Show when={loading()}>
            <div class="absolute inset-0 grid place-items-center text-xs text-text-muted">加载中…</div>
          </Show>
        </div>
        <footer class="border-t border-border-subtle p-3 shrink-0 space-y-2 bg-bg-page">
          <div class="flex flex-wrap items-center gap-2 sm:gap-3">
            <button class="text-[11px] px-3 py-1 rounded border border-border-subtle hover:border-accent hover:text-accent w-20 text-center min-h-[28px]" onClick={() => (playing() ? pause() : play())} disabled={disabled()}>{playing() ? "⏸ 暂停" : "▶ 播放"}</button>
            <button class="text-[11px] px-2 py-1 rounded border border-border-subtle text-text-secondary hover:text-text-primary min-h-[28px]" onClick={() => rewindTo(0)} title="回到开头" aria-label="回到开头">⏮</button>
            <div class="font-mono text-[11px] text-text-secondary shrink-0">{formatClock(currentT())} / {formatClock(totalDuration())}</div>
            <div class="flex items-center gap-1 ml-auto">
              <span class="text-[10px] text-text-muted">速度</span>
              <For each={SPEEDS}>{(sp) => <button class={speedBtn(sp)} onClick={() => onSpeedChange(sp)}>{sp}x</button>}</For>
            </div>
          </div>
          <input type="range" min={0} max={totalDuration()} step={0.1} value={currentT()} onInput={onSeek} class="w-full accent-accent" disabled={disabled()} aria-label="进度" />
        </footer>
      </div>
    </div>
  );
}

export default RecordingPlayback;
