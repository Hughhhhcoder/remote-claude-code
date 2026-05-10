import { createSignal, createEffect, onCleanup, onMount, Show, For } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { loadToken } from "./auth.ts";

interface Props {
  sid: string;
  onClose: () => void;
}

interface CastEvent {
  t: number;
  data: string;
}

interface CastHeader {
  version: number;
  width: number;
  height: number;
  timestamp?: number;
  title?: string;
}

const SPEEDS = [0.5, 1, 2, 4] as const;

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * Lightweight asciinema v2 player — no external library. Fetches the whole
 * cast file, JSONL-parses events, and walks the array driven by
 * requestAnimationFrame. Supports play / pause / speed (0.5/1/2/4) / seek.
 */
export function RecordingPlayback(props: Props) {
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

  // Playback state that must NOT be reactive (would cause tearing). Kept in
  // plain vars and read from the rAF loop.
  let nextIndex = 0;
  let wallStart = 0;
  let virtualOffset = 0; // seconds of cast already played at wallStart
  let rafHandle: number | null = null;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = loadToken();
      const headers: Record<string, string> = {};
      if (token) headers["authorization"] = `Bearer ${token}`;
      const resp = await fetch(`/recording/${encodeURIComponent(props.sid)}.cast`, { headers });
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
        } catch {
          // skip malformed lines — partial writes at cap time can happen
        }
      }
      setHeader(h);
      setEvents(evts);
      setLoading(false);
      // Resize xterm to cast dimensions if possible. If the fit addon sized
      // us already, we still call resize explicitly so the replay looks the
      // same as when it was recorded.
      if (term) {
        try {
          term.resize(h.width, h.height);
        } catch {
          // ignore
        }
      }
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setLoading(false);
    }
  }

  onMount(() => {
    term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: false,
      convertEol: false,
      disableStdin: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: {
        background: "#09090b",
        foreground: "#e4e4e7",
        cursor: "#fb923c",
        cursorAccent: "#0a0a0a",
        selectionBackground: "#3f3f46",
      },
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termHost);
    try {
      fit.fit();
    } catch {
      // ignore
    }
    void load();
  });

  onCleanup(() => {
    stopLoop();
    if (term) {
      try {
        term.dispose();
      } catch {
        // ignore
      }
      term = null;
    }
  });

  function stopLoop() {
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  }

  function totalDuration(): number {
    const evts = events();
    return evts.length > 0 ? evts[evts.length - 1]!.t : 0;
  }

  function play() {
    if (playing()) return;
    const evts = events();
    if (evts.length === 0) return;
    // If we're at the end, rewind. Otherwise resume from currentT.
    if (nextIndex >= evts.length) {
      rewindTo(0);
    }
    wallStart = performance.now();
    virtualOffset = currentT();
    setPlaying(true);
    tick();
  }

  function pause() {
    if (!playing()) return;
    setPlaying(false);
    stopLoop();
  }

  function tick() {
    if (!playing() || !term) return;
    const evts = events();
    const now = performance.now();
    const elapsed = ((now - wallStart) / 1000) * speed();
    const virtualT = virtualOffset + elapsed;
    // Drain all events whose timestamp has arrived.
    while (nextIndex < evts.length && evts[nextIndex]!.t <= virtualT) {
      term.write(evts[nextIndex]!.data);
      nextIndex++;
    }
    setCurrentT(virtualT);
    if (nextIndex >= evts.length) {
      setPlaying(false);
      setCurrentT(totalDuration());
      stopLoop();
      return;
    }
    rafHandle = requestAnimationFrame(tick);
  }

  function rewindTo(t: number) {
    if (!term) return;
    const evts = events();
    stopLoop();
    setPlaying(false);
    term.reset();
    nextIndex = 0;
    const target = Math.max(0, t);
    while (nextIndex < evts.length && evts[nextIndex]!.t <= target) {
      term.write(evts[nextIndex]!.data);
      nextIndex++;
    }
    setCurrentT(target);
  }

  function onSpeedChange(next: number) {
    const wasPlaying = playing();
    if (wasPlaying) pause();
    setSpeed(next);
    if (wasPlaying) play();
  }

  // Restart playback when events change (after load completes).
  createEffect(() => {
    const evts = events();
    if (evts.length > 0 && nextIndex === 0) {
      // auto-play once ready
      setTimeout(() => play(), 100);
    }
  });

  function onSeek(ev: Event) {
    const target = ev.currentTarget as HTMLInputElement;
    const wasPlaying = playing();
    rewindTo(Number(target.value));
    if (wasPlaying) play();
  }

  return (
    <div
      class="fixed inset-0 bg-black/70 grid place-items-center z-50 p-4"
      onClick={props.onClose}
    >
      <div
        class="bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div class="text-sm font-semibold flex items-center gap-2">
            <span>▶ 会话回放</span>
            <Show when={header()}>
              <span class="text-[11px] font-normal text-zinc-500">
                {header()!.width}×{header()!.height} · {events().length} 事件
              </span>
            </Show>
          </div>
          <button
            class="text-zinc-500 hover:text-zinc-200 text-lg leading-none"
            onClick={props.onClose}
          >
            ×
          </button>
        </div>

        <Show when={error()}>
          <div class="px-4 py-3 text-xs text-rose-400 bg-rose-500/10 border-b border-rose-500/30">
            加载失败: {error()}
          </div>
        </Show>

        <div class="flex-1 min-h-0 overflow-hidden bg-[#09090b]">
          <div ref={termHost} class="w-full h-full" />
          <Show when={loading()}>
            <div class="absolute inset-0 grid place-items-center text-xs text-zinc-500">
              加载中…
            </div>
          </Show>
        </div>

        <div class="border-t border-zinc-800 p-3 shrink-0 space-y-2">
          <div class="flex items-center gap-3">
            <button
              class="text-[11px] px-3 py-1 rounded border border-zinc-700 hover:border-accent-500/50 hover:text-accent-300 w-16 text-center"
              onClick={() => (playing() ? pause() : play())}
              disabled={loading() || !!error() || events().length === 0}
            >
              {playing() ? "⏸ 暂停" : "▶ 播放"}
            </button>
            <button
              class="text-[11px] px-2 py-1 rounded border border-zinc-800 text-zinc-400 hover:text-zinc-100"
              onClick={() => rewindTo(0)}
              title="回到开头"
            >
              ⏮
            </button>
            <div class="font-mono text-[11px] text-zinc-400 shrink-0">
              {formatClock(currentT())} / {formatClock(totalDuration())}
            </div>
            <div class="flex items-center gap-1">
              <span class="text-[10px] text-zinc-500">速度</span>
              <For each={SPEEDS}>
                {(sp) => (
                  <button
                    class={`text-[10px] px-1.5 py-0.5 rounded border ${
                      speed() === sp
                        ? "border-accent-500/50 bg-accent-500/10 text-accent-300"
                        : "border-zinc-800 text-zinc-500 hover:text-zinc-200"
                    }`}
                    onClick={() => onSpeedChange(sp)}
                  >
                    {sp}x
                  </button>
                )}
              </For>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={totalDuration()}
            step={0.1}
            value={currentT()}
            onInput={onSeek}
            class="w-full accent-orange-500"
            disabled={loading() || !!error() || events().length === 0}
          />
        </div>
      </div>
    </div>
  );
}
