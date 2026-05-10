import { createSignal } from "solid-js";
import type { FrameByT } from "@rcc/protocol";
import type { RccClient } from "../client.ts";
import { toast } from "../primitives/Toast.tsx";

export type Pending = FrameByT<"approval.request">;

/**
 * Historical approvals (approved / denied / auto-cleared). Keeps
 * `decidedAt` so future UIs can render "just now / 2m ago", and `outcome`
 * so we can show the answer the user gave.
 *
 * `provisional` (B15-A): true while an optimistic approve/deny is
 * in-flight and unacknowledged. The UI can use it to render the row with
 * reduced opacity / a spinner. Cleared once the host confirms (next
 * `approval.request` id or an `approval.cleared` / error frame).
 */
export interface ApprovalHistoryItem {
  request: Pending;
  decidedAt: number;
  outcome: "approved" | "denied" | "cleared";
  provisional?: boolean;
}

const HIGH_RISK_DELAY_MS = 500;
const HISTORY_LIMIT = 50;
const RESPONSE_TIMEOUT_MS = 10_000;

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

  // --- Optimistic response rollback (B15-A) ---------------------------
  // Track provisional approve/deny by approval id. If the host sends a
  // new `approval.request` (= moved on), a matching `approval.cleared`,
  // or a bare `error` frame for the sid, we confirm. On 10s timer we
  // roll back: re-seat the request as current and toast the user.
  interface PendingResponse {
    request: Pending;
    approve: boolean;
    timer: ReturnType<typeof setTimeout>;
  }
  const pendingResponses = new Map<string, PendingResponse>();

  function clearProvisionalFlag(id: string): void {
    setHistory((prev) =>
      prev.map((item) =>
        item.request.id === id && item.provisional
          ? { ...item, provisional: false }
          : item,
      ),
    );
  }

  function resolveResponse(id: string): void {
    const p = pendingResponses.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pendingResponses.delete(id);
    clearProvisionalFlag(id);
  }

  function rollbackResponse(id: string, reason: string): void {
    const p = pendingResponses.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pendingResponses.delete(id);
    // Drop the provisional history row and re-seat as current if nothing
    // else has claimed the slot in the meantime.
    setHistory((prev) => prev.filter((item) => item.request.id !== id));
    if (!current()) {
      setCurrent(p.request);
      if (p.request.risk === "high") startCountdown();
    }
    toast(`审批未送达 · ${reason} · 请重试`, { tone: "danger" });
  }

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
      // A fresh request means any earlier provisional response for a
      // DIFFERENT id is now confirmed — the host moved on.
      for (const id of Array.from(pendingResponses.keys())) {
        if (id !== frame.id) resolveResponse(id);
      }
      setCurrent(frame);
      if (frame.risk === "high") startCountdown();
      else {
        setCountdown(0);
        stopCountdown();
      }
    } else if (frame.t === "approval.cleared") {
      // Matches the id of a provisional response — host confirmed.
      if (pendingResponses.has(frame.id)) {
        resolveResponse(frame.id);
        return;
      }
      const c = current();
      if (c && c.id === frame.id) {
        pushHistory({ request: c, decidedAt: Date.now(), outcome: "cleared" });
        setCurrent(null);
        setCountdown(0);
        stopCountdown();
      }
    } else if (frame.t === "error") {
      // Best-effort: roll back any provisional response targeting this sid.
      // The error frame has no approval id, so we match by sid.
      if (frame.sid) {
        for (const [id, p] of pendingResponses) {
          if (p.request.sid === frame.sid) {
            rollbackResponse(id, frame.message || frame.code);
            break;
          }
        }
      }
    } else if (frame.t === "session.exited") {
      // Session is gone — any provisional response for that sid is moot.
      for (const [id, p] of pendingResponses) {
        if (p.request.sid === frame.sid) resolveResponse(id);
      }
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
    // Optimistically mark as provisional in history; rollback on timeout.
    pushHistory({
      request: c,
      decidedAt: Date.now(),
      outcome: approve ? "approved" : "denied",
      provisional: true,
    });
    const timer = setTimeout(
      () => rollbackResponse(c.id, "请求超时"),
      RESPONSE_TIMEOUT_MS,
    );
    // Replace any prior pending entry for this id.
    const existing = pendingResponses.get(c.id);
    if (existing) clearTimeout(existing.timer);
    pendingResponses.set(c.id, { request: c, approve, timer });
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
      for (const p of pendingResponses.values()) clearTimeout(p.timer);
      pendingResponses.clear();
      unsub();
    },
  };
}
