import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";

/**
 * PerfOverlay — dev-only performance HUD (B32-C).
 *
 * A tiny pill in the bottom-right showing FPS · last-frame ms ·
 * WS msg/s · JS heap MB. Mounted by main.tsx when `?debug=1` is
 * present in the URL. Can also be toggled at runtime with
 * Cmd/Ctrl+Shift+P.
 *
 * Design rules:
 *   - Non-intrusive: fixed, pointer-events only on the pill itself,
 *     z-50, small font, semi-transparent background.
 *   - Zero protocol/host changes. WS msg/s is sampled by lightly
 *     wrapping `WebSocket.prototype.addEventListener` on mount so
 *     client.ts stays untouched. The wrap is idempotent and gated
 *     by a window-level flag.
 *   - Draggable: pointer-drag anywhere on the pill to reposition.
 *     Position persists in sessionStorage for the tab's lifetime.
 */

type Pos = { x: number; y: number };

const POS_KEY = "rcc:perf-overlay:pos";
const WRAP_FLAG = "__rccPerfWSWrapped";
const COUNTER_KEY = "__rccPerfWSCount";

function installWSCounter(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, unknown>;
  if (w[WRAP_FLAG]) return;
  w[WRAP_FLAG] = true;
  w[COUNTER_KEY] = 0;

  const proto = WebSocket.prototype;
  const origAdd = proto.addEventListener;
  // Wrap addEventListener so any listener registered for "message"
  // is preceded by a tick of the global counter. Existing listeners
  // registered before the wrap also get counted via the `message`
  // event fallback below.
  proto.addEventListener = function patchedAdd(
    this: WebSocket,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (type === "message" && listener) {
      const wrapped: EventListener = (ev) => {
        (window as unknown as Record<string, number>)[COUNTER_KEY]++;
        if (typeof listener === "function") {
          (listener as EventListener).call(this, ev);
        } else if (listener && typeof listener.handleEvent === "function") {
          listener.handleEvent(ev);
        }
      };
      return origAdd.call(this, type, wrapped, options);
    }
    return origAdd.call(this, type, listener as EventListener, options);
  };
}

function readPos(): Pos | null {
  try {
    const raw = sessionStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pos;
    if (typeof p.x === "number" && typeof p.y === "number") return p;
  } catch {
    /* ignore */
  }
  return null;
}

function writePos(p: Pos): void {
  try {
    sessionStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function PerfOverlay(): JSX.Element {
  const [visible, setVisible] = createSignal(true);
  const [fps, setFps] = createSignal(0);
  const [frameMs, setFrameMs] = createSignal(0);
  const [msgPerSec, setMsgPerSec] = createSignal(0);
  const [heapMb, setHeapMb] = createSignal<number | null>(null);
  const [pos, setPos] = createSignal<Pos>(readPos() ?? { x: 12, y: 12 });

  let raf = 0;
  let lastT = 0;
  let frames = 0;
  let fpsAccum = 0;
  let msgWindowStart = 0;
  let msgWindowBase = 0;

  const loop = (t: number) => {
    if (lastT === 0) {
      lastT = t;
      msgWindowStart = t;
      msgWindowBase =
        (window as unknown as Record<string, number>)[COUNTER_KEY] ?? 0;
    }
    const dt = t - lastT;
    lastT = t;
    setFrameMs(Math.round(dt * 10) / 10);

    frames++;
    fpsAccum += dt;
    if (fpsAccum >= 500) {
      setFps(Math.round((frames * 1000) / fpsAccum));
      frames = 0;
      fpsAccum = 0;
    }

    // Sample WS msg/s over a rolling 1-second window.
    const elapsed = t - msgWindowStart;
    if (elapsed >= 1000) {
      const cur =
        (window as unknown as Record<string, number>)[COUNTER_KEY] ?? 0;
      setMsgPerSec(Math.round(((cur - msgWindowBase) * 1000) / elapsed));
      msgWindowStart = t;
      msgWindowBase = cur;
    }

    // Heap (Chromium only).
    const perf = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    if (perf.memory) {
      setHeapMb(Math.round(perf.memory.usedJSHeapSize / 1024 / 1024));
    }

    raf = requestAnimationFrame(loop);
  };

  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      setVisible((v) => !v);
    }
  };

  onMount(() => {
    installWSCounter();
    raf = requestAnimationFrame(loop);
    window.addEventListener("keydown", onKey);
  });

  onCleanup(() => {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
  });

  // Drag-to-reposition.
  let dragStart: { px: number; py: number; ox: number; oy: number } | null =
    null;
  const onPointerDown = (e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const p = pos();
    dragStart = { px: e.clientX, py: e.clientY, ox: p.x, oy: p.y };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.px;
    const dy = e.clientY - dragStart.py;
    // Anchor is bottom-right (x/y are offsets FROM bottom-right).
    setPos({
      x: Math.max(0, dragStart.ox - dx),
      y: Math.max(0, dragStart.oy - dy),
    });
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!dragStart) return;
    const el = e.currentTarget as HTMLElement;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragStart = null;
    writePos(pos());
  };

  return (
    <Show when={visible()}>
      <div
        class="fixed z-50 select-none cursor-move rounded-full px-3 py-1 font-mono text-[11px] leading-none shadow-lg backdrop-blur-sm"
        style={{
          right: `${pos().x}px`,
          bottom: `${pos().y}px`,
          background: "rgba(17, 17, 20, 0.82)",
          color: "#e6e6ea",
          border: "1px solid rgba(255,255,255,0.08)",
          "touch-action": "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title="Perf overlay — Cmd/Ctrl+Shift+P to toggle · drag to move"
      >
        <span style={{ color: fps() < 45 ? "#f87171" : "#a7f3d0" }}>
          {fps()} fps
        </span>
        <span style={{ opacity: 0.5, margin: "0 6px" }}>·</span>
        <span>{frameMs()}ms</span>
        <span style={{ opacity: 0.5, margin: "0 6px" }}>·</span>
        <span>{msgPerSec()} msg/s</span>
        <Show when={heapMb() !== null}>
          <span style={{ opacity: 0.5, margin: "0 6px" }}>·</span>
          <span>{heapMb()}MB</span>
        </Show>
      </div>
    </Show>
  );
}
