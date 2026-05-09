import { createSignal } from "solid-js";
import type { FrameByT } from "@rcc/protocol";
import type { RccClient } from "../client.ts";

export type Pending = FrameByT<"approval.request">;

/**
 * Historical approvals (approved / denied / auto-cleared). Keeps
 * `decidedAt` so future UIs can render "just now / 2m ago", and `outcome`
 * so we can show the answer the user gave.
 */
export interface ApprovalHistoryItem {
  request: Pending;
  decidedAt: number;
  outcome: "approved" | "denied" | "cleared";
}

const HIGH_RISK_DELAY_MS = 500;
const HISTORY_LIMIT = 50;

export interface ApprovalsStore {
  current: () => Pending | null;
  history: () => ApprovalHistoryItem[];
  /** ms remaining on the high-risk delay (0 when ready / not applicable) */
  countdown: () => number;
  respond: (approve: boolean, webauthnToken?: string) => void;
  clear: () => void;
  dispose: () => void;
}

/**
 * Data-layer mirror of PermissionApproval.tsx. The modal component keeps
 * its own signal for now (so the in-flight UI continues to work), while
 * this store is additive — future consumers (MobileApprovalsTab,
 * ApprovalPane in P5) can subscribe without racing the modal.
 *
 * Keeps the last HISTORY_LIMIT resolved approvals. Frames handled:
 *   - approval.request  → set current, reset countdown
 *   - approval.cleared  → if id matches, drop to history as "cleared"
 *   - session.exited    → drop current if its sid is gone
 */
export function createApprovalsStore(client: RccClient): ApprovalsStore {
  const [current, setCurrent] = createSignal<Pending | null>(null);
  const [history, setHistory] = createSignal<ApprovalHistoryItem[]>([]);
  const [countdown, setCountdown] = createSignal(0);

  let tickTimer: ReturnType<typeof setInterval> | null = null;

  function stopCountdown() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function startCountdown() {
    stopCountdown();
    const started = Date.now();
    setCountdown(HIGH_RISK_DELAY_MS);
    tickTimer = setInterval(() => {
      const left = HIGH_RISK_DELAY_MS - (Date.now() - started);
      if (left <= 0) {
        setCountdown(0);
        stopCountdown();
      } else {
        setCountdown(left);
      }
    }, 50);
  }

  function pushHistory(item: ApprovalHistoryItem) {
    setHistory((prev) => {
      const next = [item, ...prev];
      if (next.length > HISTORY_LIMIT) next.length = HISTORY_LIMIT;
      return next;
    });
  }

  const unsub = client.on((frame) => {
    if (frame.t === "approval.request") {
      setCurrent(frame);
      if (frame.risk === "high") startCountdown();
      else {
        setCountdown(0);
        stopCountdown();
      }
    } else if (frame.t === "approval.cleared") {
      const c = current();
      if (c && c.id === frame.id) {
        pushHistory({ request: c, decidedAt: Date.now(), outcome: "cleared" });
        setCurrent(null);
        setCountdown(0);
        stopCountdown();
      }
    } else if (frame.t === "session.exited") {
      const c = current();
      if (c && c.sid === frame.sid) {
        pushHistory({ request: c, decidedAt: Date.now(), outcome: "cleared" });
        setCurrent(null);
        setCountdown(0);
        stopCountdown();
      }
    }
  });

  function respond(approve: boolean, webauthnToken?: string): void {
    const c = current();
    if (!c) return;
    client.send({
      v: 1,
      t: "approval.response",
      id: c.id,
      sid: c.sid,
      approve,
      webauthnToken,
    });
    pushHistory({
      request: c,
      decidedAt: Date.now(),
      outcome: approve ? "approved" : "denied",
    });
    setCurrent(null);
    setCountdown(0);
    stopCountdown();
  }

  function clear(): void {
    const c = current();
    if (!c) return;
    pushHistory({ request: c, decidedAt: Date.now(), outcome: "cleared" });
    setCurrent(null);
    setCountdown(0);
    stopCountdown();
  }

  return {
    current,
    history,
    countdown,
    respond,
    clear,
    dispose: () => {
      stopCountdown();
      unsub();
    },
  };
}
