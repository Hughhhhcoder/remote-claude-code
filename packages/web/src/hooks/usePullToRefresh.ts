import { createSignal, onCleanup } from "solid-js";
import { hasTouchCapability } from "./useTouchGestures.ts";

/**
 * usePullToRefresh — classic iOS-style pull-to-refresh for a scroll container.
 *
 * Activates when the container is at `scrollTop === 0` and a touch drag moves
 * downward. Exposes `offset` (px, rubber-banded) and `state` so the UI can
 * render a spinner that grows with the drag, snaps to a success check on
 * resolve, or bounces back on cancel.
 *
 * Wiring:
 *   const ptr = usePullToRefresh({ onRefresh });
 *   <div ref={ptr.ref} class="overflow-y-auto" ...ptr.handlers />
 *
 * State machine:
 *   idle → dragging → refreshing → success → idle
 *                ↓
 *              cancel → idle
 *
 * Non-touch devices get a no-op: `handlers` are empty functions and
 * `ref` accepts but ignores the element. This keeps desktop wheel-scroll
 * untouched while letting callers spread the same API unconditionally.
 */

export type PtrState = "idle" | "dragging" | "refreshing" | "success";

export interface PullToRefreshOptions {
  /** Triggered once the user drags past `threshold`. Returns a promise that
   *  completes the spinner lifecycle. */
  onRefresh: () => void | Promise<void>;
  /** Distance (px) the user must drag past before release triggers refresh.
   *  Default 64. */
  threshold?: number;
  /** Maximum offset the spinner can be dragged to. Default 120. */
  maxOffset?: number;
  /** How long the success check lingers before snapping back. Default 400ms. */
  successDuration?: number;
  /** If set, the pull is only armed when the host element is scrolled to top
   *  (default true). Turn off for hosts that are already at the top (e.g. a
   *  fixed-header drawer that renders its own scroll region). */
  requireScrollTop?: boolean;
}

export interface PullToRefreshApi {
  /** Attach to the scroll container. Call with `null` to detach. */
  ref: (el: HTMLElement | null) => void;
  /** Current pull distance in px (0 when idle). */
  offset: () => number;
  /** Finite-state view of the current pull lifecycle. */
  state: () => PtrState;
  /** Threshold in px — exposed so the UI can style "armed" at ≥ threshold. */
  threshold: number;
  /** Pointer handlers for the host element (onPointerDown/Move/Up/Cancel). */
  handlers: {
    onPointerDown: (e: PointerEvent) => void;
    onPointerMove: (e: PointerEvent) => void;
    onPointerUp: (e: PointerEvent) => void;
    onPointerCancel: (e: PointerEvent) => void;
  };
  /** Manually flip to success (used when the caller finishes out-of-band). */
  resolve: () => void;
}

const NOOP_HANDLER = (_e: PointerEvent): void => {};

export function usePullToRefresh(options: PullToRefreshOptions): PullToRefreshApi {
  const threshold = options.threshold ?? 64;
  const maxOffset = options.maxOffset ?? 120;
  const successDuration = options.successDuration ?? 400;
  const requireScrollTop = options.requireScrollTop ?? true;

  const [offset, setOffset] = createSignal(0);
  const [state, setState] = createSignal<PtrState>("idle");

  let host: HTMLElement | null = null;
  let activePointer: number | null = null;
  let startY = 0;
  let successTimer: number | null = null;

  const isTouch = hasTouchCapability();

  function refImpl(el: HTMLElement | null): void {
    host = el;
  }

  function atTop(): boolean {
    if (!requireScrollTop) return true;
    if (!host) return true;
    return host.scrollTop <= 0;
  }

  /**
   * Rubber-band: dy maps to an offset that eases as it approaches `maxOffset`.
   * y = max × (1 − 1/(1 + dy/max)) — smooth, never exceeds max.
   */
  function rubberband(dy: number): number {
    if (dy <= 0) return 0;
    return maxOffset * (1 - 1 / (1 + dy / maxOffset));
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== "touch") return;
    if (state() === "refreshing" || state() === "success") return;
    if (!atTop()) return;
    activePointer = e.pointerId;
    startY = e.clientY;
  }

  function onPointerMove(e: PointerEvent): void {
    if (activePointer !== e.pointerId) return;
    const dy = e.clientY - startY;
    if (dy <= 0) {
      // Upward drag before arming: release the pull without triggering.
      if (state() === "dragging") {
        setState("idle");
        setOffset(0);
      }
      return;
    }
    if (!atTop()) {
      activePointer = null;
      setState("idle");
      setOffset(0);
      return;
    }
    if (state() === "idle") setState("dragging");
    setOffset(rubberband(dy));
    if (e.cancelable) e.preventDefault();
  }

  function enterSuccess(): void {
    setState("success");
    setOffset(threshold);
    if (successTimer != null) window.clearTimeout(successTimer);
    successTimer = window.setTimeout(() => {
      setState("idle");
      setOffset(0);
      successTimer = null;
    }, successDuration);
  }

  function onPointerUp(e: PointerEvent): void {
    if (activePointer !== e.pointerId) return;
    activePointer = null;
    if (state() !== "dragging") return;

    if (offset() >= threshold) {
      setState("refreshing");
      // Park spinner at exactly the threshold while work runs.
      setOffset(threshold);
      try {
        const ret = options.onRefresh();
        if (ret && typeof (ret as Promise<void>).then === "function") {
          (ret as Promise<void>).then(enterSuccess, enterSuccess);
        } else {
          // Sync onRefresh: give the UI a beat, then animate to success.
          window.setTimeout(enterSuccess, 250);
        }
      } catch {
        enterSuccess();
      }
    } else {
      setState("idle");
      setOffset(0);
    }
  }

  function onPointerCancel(e: PointerEvent): void {
    if (activePointer !== e.pointerId) return;
    activePointer = null;
    if (state() === "dragging") {
      setState("idle");
      setOffset(0);
    }
  }

  onCleanup(() => {
    if (successTimer != null) {
      window.clearTimeout(successTimer);
      successTimer = null;
    }
    host = null;
  });

  return {
    ref: refImpl,
    offset,
    state,
    threshold,
    handlers: isTouch
      ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
      : {
          onPointerDown: NOOP_HANDLER,
          onPointerMove: NOOP_HANDLER,
          onPointerUp: NOOP_HANDLER,
          onPointerCancel: NOOP_HANDLER,
        },
    resolve: enterSuccess,
  };
}
