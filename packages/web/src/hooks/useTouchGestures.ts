import { createSignal, onCleanup } from "solid-js";

/**
 * useTouchGestures — pinch-to-zoom primitive built on pointer events.
 *
 * Tracks up to two concurrent pointers and, when both are touch contacts,
 * derives a scale factor from the change in their Euclidean distance. The
 * caller receives a single `fontSize` signal clamped to [`min`, `max`] and
 * three handlers to wire onto a host element's `onPointerDown/Move/Up`.
 *
 * Design notes:
 *   - Single-finger drags are a no-op (distance tracking requires two
 *     pointers). Mouse / pen input is ignored entirely so desktop text
 *     selection still works.
 *   - Scale is applied multiplicatively: new = base × (d_now / d_start).
 *     Applying the raw ratio on every move event would compound drift; we
 *     snapshot `baseSize` + `baseDistance` at the 2-pointer transition and
 *     recompute from there.
 *   - We deliberately do NOT call `setPointerCapture` — capturing both
 *     fingers on the `<pre>` would block scroll fall-through when the user
 *     single-finger pans a code block. The code path short-circuits before
 *     any capture is attempted.
 *   - `touch-action: pinch-zoom` is set via inline style on the host to
 *     suppress the browser's native pinch gesture (which would zoom the
 *     page viewport instead of just this block).
 */

export interface TouchGestureOptions {
  /** Minimum font size in px. Default 12. */
  min?: number;
  /** Maximum font size in px. Default 20. */
  max?: number;
  /** Initial font size in px. Default 13 (matches CodeBlock default). */
  initial?: number;
}

export interface TouchGestureApi {
  /** Current font-size in px — apply via inline `font-size`. */
  fontSize: () => number;
  /** Reset to the initial size. */
  reset: () => void;
  /** Pointer handlers; spread onto the host element. */
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
}

interface PointerSample {
  id: number;
  x: number;
  y: number;
}

function distance(a: PointerSample, b: PointerSample): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function useTouchGestures(options: TouchGestureOptions = {}): TouchGestureApi {
  const min = options.min ?? 12;
  const max = options.max ?? 20;
  const initial = Math.max(min, Math.min(max, options.initial ?? 13));

  const [fontSize, setFontSize] = createSignal(initial);

  // Active touch pointers, keyed by pointerId. Map preserves insertion
  // order — the first two are the pair we measure against.
  const pointers = new Map<number, PointerSample>();
  let baseDistance = 0;
  let baseSize = initial;

  function pair(): [PointerSample, PointerSample] | null {
    if (pointers.size < 2) return null;
    const iter = pointers.values();
    const a = iter.next().value as PointerSample;
    const b = iter.next().value as PointerSample;
    return [a, b];
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== "touch") return;
    pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
    const p = pair();
    if (p) {
      baseDistance = distance(p[0], p[1]);
      baseSize = fontSize();
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerType !== "touch") return;
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
    const p = pair();
    if (!p || baseDistance === 0) return;
    const d = distance(p[0], p[1]);
    const next = baseSize * (d / baseDistance);
    const clamped = Math.max(min, Math.min(max, next));
    setFontSize(clamped);
    // Prevent the browser's pinch-zoom on the viewport while we're driving
    // the code block's own zoom.
    if (e.cancelable) e.preventDefault();
  }

  function onPointerUp(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    // If we drop below 2 pointers, reset the baseline so the next pinch
    // starts from the current size rather than compounding.
    if (pointers.size < 2) {
      baseDistance = 0;
      baseSize = fontSize();
    }
  }

  function reset(): void {
    pointers.clear();
    baseDistance = 0;
    baseSize = initial;
    setFontSize(initial);
  }

  onCleanup(() => {
    pointers.clear();
  });

  return { fontSize, reset, onPointerDown, onPointerMove, onPointerUp };
}

/**
 * hasTouchCapability — one-shot check for a coarse pointer + touch device.
 * Not reactive; pointer capabilities don't meaningfully change mid-session.
 * Returns `false` in SSR.
 */
export function hasTouchCapability(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}
