import { createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import type { RccClient } from "../client.ts";
import { createApprovalsStore, type Pending, type ApprovalHistoryItem } from "../stores/approvalsStore.ts";
import { authenticateForApproval, isWebAuthnAvailable } from "../webauthn.ts";
import Button from "../primitives/Button.tsx";
import { ApprovalCard, type ApprovalRecord } from "./ApprovalCard.tsx";

/**
 * ApprovalPane — list view of pending + recent approvals.
 *
 * Coexists with the legacy PermissionApproval modal (still wired in App.tsx
 * as of P5-A). A later batch swaps the wiring. Data source is approvalsStore
 * (current + history). onApprove/onDeny dispatch approval.response frames
 * (the canonical wire shape — matches PermissionApproval.tsx). For high-risk
 * approvals with a passkey-bound device, Approve first runs the WebAuthn
 * assertion ceremony via authenticateForApproval.
 */

// Device type extended with optional id/name so Face ID ceremony can run
// when App wires a full Device shape. The spec prop typing `{ hasPasskey? }`
// is a subset — when `id` is absent we skip the ceremony (graceful fallback).
export interface ApprovalPaneDevice {
  id?: string;
  name?: string;
  hasPasskey?: boolean;
}

export interface ApprovalPaneProps {
  client: RccClient;
  device?: ApprovalPaneDevice | null;
  /** Optional filter to a specific sid; when undefined shows all. */
  sid?: string;
  /** When embedded in a Dialog/Drawer, pass a close callback. */
  onClose?: () => void;
}

const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000; // last 24h

function pendingToRecord(p: Pending): ApprovalRecord {
  return {
    id: p.id,
    sid: p.sid,
    tool: p.tool,
    risk: p.risk,
    summary: p.summary,
    raw: p.raw,
    timestamp: p.timestamp,
    status: "pending",
  };
}

function historyToRecord(h: ApprovalHistoryItem): ApprovalRecord {
  const status: ApprovalRecord["status"] =
    h.outcome === "approved" ? "approved" : "denied";
  return {
    id: h.request.id,
    sid: h.request.sid,
    tool: h.request.tool,
    risk: h.request.risk,
    summary: h.request.summary,
    raw: h.request.raw,
    timestamp: h.request.timestamp,
    status,
    resolvedAt: h.decidedAt,
    resolver: "local",
  };
}

export function ApprovalPane(props: ApprovalPaneProps): JSX.Element {
  const store = createApprovalsStore(props.client);
  const [authError, setAuthError] = createSignal<string | null>(null);
  const [authing, setAuthing] = createSignal(false);

  onCleanup(() => store.dispose());

  const pending = createMemo<ApprovalRecord[]>(() => {
    const c = store.current();
    if (!c) return [];
    if (props.sid && c.sid !== props.sid) return [];
    return [pendingToRecord(c)];
  });

  const history = createMemo<ApprovalRecord[]>(() => {
    const cutoff = Date.now() - HISTORY_WINDOW_MS;
    return store
      .history()
      .filter((h) => h.decidedAt >= cutoff)
      .filter((h) => !props.sid || h.request.sid === props.sid)
      .filter((h) => h.outcome !== "cleared")
      .map(historyToRecord);
  });

  const empty = () => pending().length === 0 && history().length === 0;

  function sendResponse(c: Pending, approve: boolean, webauthnToken?: string) {
    props.client.send({
      v: 1,
      t: "approval.response",
      id: c.id,
      sid: c.sid,
      approve,
      webauthnToken,
    });
    // Mirror store state so history reflects the decision even though
    // respond() is the canonical path. We call store.respond for parity.
    store.respond(approve, webauthnToken);
  }

  async function handleApprove(approvalId: string, _opts: { allowAlways: boolean }) {
    const c = store.current();
    if (!c || c.id !== approvalId) return;
    const needsWebAuthn =
      c.risk === "high" &&
      !!props.device?.hasPasskey &&
      isWebAuthnAvailable() &&
      !!props.device?.id;
    if (needsWebAuthn && props.device?.id) {
      setAuthing(true);
      setAuthError(null);
      try {
        const token = await authenticateForApproval(props.device.id, c.id);
        sendResponse(c, true, token);
      } catch (err) {
        setAuthError((err as Error).message || "passkey 验证失败");
      } finally {
        setAuthing(false);
      }
      return;
    }
    sendResponse(c, true);
  }

  function handleDeny(approvalId: string) {
    const c = store.current();
    if (!c || c.id !== approvalId) return;
    sendResponse(c, false);
  }

  return (
    <div class="flex flex-col h-full bg-bg-page text-text-primary">
      <header class="shrink-0 flex items-center gap-3 px-4 h-12 border-b border-border-subtle">
        <h2 class="font-sans text-sm font-semibold">审批</h2>
        <Show when={pending().length > 0}>
          <span class="text-[11px] px-2 py-0.5 rounded-full border border-danger text-danger font-sans font-medium">
            {pending().length}
          </span>
        </Show>
        <div class="ml-auto flex items-center gap-1">
          <Show when={props.onClose}>
            <Button variant="ghost" size="sm" onClick={() => props.onClose?.()}>
              关闭
            </Button>
          </Show>
        </div>
      </header>

      <Show when={authError()}>
        <div class="shrink-0 px-4 py-2 text-[12px] text-danger border-b border-danger/30 bg-danger/5">
          {authError()}
        </div>
      </Show>

      <div class="flex-1 overflow-y-auto">
        <Show
          when={!empty()}
          fallback={
            <div class="h-full flex items-center justify-center text-text-muted text-sm font-sans">
              没有待处理审批
            </div>
          }
        >
          <Show when={pending().length > 0}>
            <section>
              <div class="sticky top-0 z-10 bg-bg-page/95 backdrop-blur px-4 py-1.5 text-[11px] uppercase tracking-wider text-text-muted font-sans border-b border-border-subtle">
                待处理
              </div>
              <div class="px-3 py-3 space-y-3">
                <For each={pending()}>
                  {(a) => (
                    <ApprovalCard approval={a} device={props.device} onApprove={handleApprove} onDeny={handleDeny} />
                  )}
                </For>
                <Show when={authing()}>
                  <div class="text-[12px] text-text-muted px-1">等待生物识别…</div>
                </Show>
              </div>
            </section>
          </Show>
          <Show when={history().length > 0}>
            <section>
              <div class="sticky top-0 z-10 bg-bg-page/95 backdrop-blur px-4 py-1.5 text-[11px] uppercase tracking-wider text-text-muted font-sans border-b border-border-subtle">
                最近
              </div>
              <div class="px-3 py-2 space-y-1.5">
                <For each={history()}>
                  {(a) => (
                    <ApprovalCard approval={a} device={props.device} onApprove={handleApprove} onDeny={handleDeny} compact />
                  )}
                </For>
              </div>
            </section>
          </Show>
        </Show>
      </div>
    </div>
  );
}

export default ApprovalPane;
