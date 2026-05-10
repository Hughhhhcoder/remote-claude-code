import { Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import type { ConnStatus } from "../client";
import { Button } from "../primitives/Button";
import { Spinner } from "../primitives/Spinner";

/**
 * ConnectionBanner — user-visible strip that replaces the tiny TopBar status
 * dot when the ws drops. Renders nothing in the happy path (connected).
 *
 * Visual hierarchy:
 *   connected                       → unmounted
 *   connecting (first-time bootstrap) → subtle 28px strip
 *   closed + reconnect pending       → warn strip with countdown + "立即重连"
 *   closed + > 5 attempts            → danger strip with manual retry
 *   readonly                         → violet-ish info strip
 *   unauthorized                     → unmounted (PairingView covers the app)
 *   slow                             → unmounted (host is up, UI is fine)
 */

export interface ConnectionBannerProps {
  status: () => ConnStatus;
  /** Optional: if client exposes reconnect state, pipe in. Safe to omit. */
  reconnect?: () => { attempt: number; nextAttemptAt: number | null } | null;
  /** Called when user clicks "立即重连". */
  onReconnectNow?: () => void;
}

const FAIL_THRESHOLD = 5;

export function ConnectionBanner(props: ConnectionBannerProps): JSX.Element {
  // Local tick drives the countdown. Starts only when the banner mounts in
  // a reconnecting state; cleaned up on unmount.
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(id));
  });

  const kind = (): "hidden" | "connecting" | "reconnecting" | "failed" | "readonly" => {
    const s = props.status();
    if (s === "connected" || s === "unauthorized" || s === "slow") return "hidden";
    if (s === "readonly") return "readonly";
    const r = props.reconnect?.() ?? null;
    if (s === "closed") {
      if (r && r.attempt > FAIL_THRESHOLD) return "failed";
      return "reconnecting";
    }
    // connecting: subtle strip unless we've already been retrying (then warn)
    if (r && r.attempt > 0) {
      return r.attempt > FAIL_THRESHOLD ? "failed" : "reconnecting";
    }
    return "connecting";
  };

  const secondsLeft = (): number => {
    const r = props.reconnect?.();
    if (!r || r.nextAttemptAt === null) return 0;
    return Math.max(0, Math.ceil((r.nextAttemptAt - now()) / 1000));
  };

  const attempt = (): number => props.reconnect?.()?.attempt ?? 0;

  return (
    <Show when={kind() !== "hidden"}>
      <Show when={kind() === "connecting"}>
        <div
          role="status"
          class="h-9 sm:h-8 flex items-center gap-2 px-4 font-sans text-[13px] bg-bg-surface text-text-muted border-b border-border-subtle"
        >
          <Spinner size="sm" color="muted" />
          <span class="truncate">连接中…</span>
        </div>
      </Show>

      <Show when={kind() === "reconnecting"}>
        <div
          role="status"
          aria-live="polite"
          class="h-9 sm:h-8 flex items-center gap-2 px-4 font-sans text-[13px] bg-warn/20 border-b border-warn/40 text-warn"
        >
          <span aria-hidden="true">⚠</span>
          <span class="truncate flex-1 min-w-0">
            <Show
              when={secondsLeft() > 0}
              fallback={<>连接已断开 · 正在重连… (第 {attempt()} 次尝试)</>}
            >
              连接已断开 · {secondsLeft()} 秒后重连 (第 {attempt()} 次尝试)
            </Show>
          </span>
          <Show when={props.onReconnectNow}>
            <Button
              variant="secondary"
              size="sm"
              class="h-7 shrink-0"
              onClick={() => props.onReconnectNow?.()}
            >
              立即重连
            </Button>
          </Show>
        </div>
      </Show>

      <Show when={kind() === "failed"}>
        <div
          role="alert"
          class="h-9 sm:h-8 flex items-center gap-2 px-4 font-sans text-[13px] bg-danger/20 border-b border-danger/40 text-danger"
        >
          <span aria-hidden="true">✗</span>
          <span class="truncate flex-1 min-w-0">
            无法连接到 host · 请检查网络
          </span>
          <Show when={props.onReconnectNow}>
            <Button
              variant="secondary"
              size="sm"
              class="h-7 shrink-0"
              onClick={() => props.onReconnectNow?.()}
            >
              立即重试
            </Button>
          </Show>
        </div>
      </Show>

      <Show when={kind() === "readonly"}>
        <div
          role="status"
          class="h-9 sm:h-8 flex items-center gap-2 px-4 font-sans text-[13px] bg-accent-bg border-b border-accent/30 text-accent"
        >
          <span aria-hidden="true">👁</span>
          <span class="truncate">只读模式 · 无法编辑</span>
        </div>
      </Show>
    </Show>
  );
}

export default ConnectionBanner;
