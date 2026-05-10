import { createSignal, Show, type JSX } from "solid-js";
import Button from "../primitives/Button.tsx";

/**
 * ApprovalCard — standalone per-approval card used by ApprovalPane.
 * List-view counterpart of the chat-embedded ApprovalBlock. Visuals match
 * the locked spec (risk-coloured border, tool accent, raw preview, 始终允许
 * checkbox + 拒绝 / 允许 footer). Intentionally dumb: the Pane supplies data
 * and decides where approve/deny frames are sent. Two densities: full
 * (default) or compact (single row — risk pill + tool + summary + actions).
 */

export interface ApprovalRecord {
  // Matches the wire approval.request shape:
  id: string;
  sid: string;
  tool: string;
  risk: "low" | "medium" | "high";
  summary: string;
  raw: string;
  timestamp: number;
  // UI state:
  status: "pending" | "approved" | "denied";
  resolvedAt?: number;
  resolver?: string;
}

export interface ApprovalCardProps {
  approval: ApprovalRecord;
  device?: { hasPasskey?: boolean } | null;
  onApprove: (approvalId: string, opts: { allowAlways: boolean }) => void;
  onDeny: (approvalId: string) => void;
  /** When true, render compact (list row) style. Default false = full card. */
  compact?: boolean;
}

const RISK_ICON: Record<"low" | "medium" | "high", string> = {
  low: "🔒",
  medium: "⚠",
  high: "🛑",
};

const RISK_PILL: Record<"low" | "medium" | "high", string> = {
  low: "bg-accent-bg text-accent border-accent",
  medium: "bg-warn/10 text-warn border-warn",
  high: "bg-danger/10 text-danger border-danger",
};

function riskFrame(risk: "low" | "medium" | "high", resolved: boolean): string {
  if (resolved) return "border-border-subtle bg-bg-surface opacity-75";
  if (risk === "high") return "border-danger bg-danger/5";
  if (risk === "medium") return "border-warn bg-warn/5";
  return "border-accent bg-accent-bg";
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function describeRequest(a: ApprovalRecord): string {
  if (a.summary && a.summary.trim()) return a.summary;
  return `使用 ${a.tool}`;
}

function cwdFromRaw(a: ApprovalRecord): string | null {
  if (!a.raw) return null;
  try {
    const parsed = JSON.parse(a.raw) as Record<string, unknown>;
    if (parsed && typeof parsed.cwd === "string") return parsed.cwd;
  } catch {
    // raw is not JSON — ignore
  }
  return null;
}

export function ApprovalCard(props: ApprovalCardProps): JSX.Element {
  const [allowAlways, setAllowAlways] = createSignal(false);
  const risk = () => props.approval.risk;
  const isResolved = () => props.approval.status !== "pending";
  const useFaceId = () => risk() === "high" && !!props.device?.hasPasskey && !isResolved();

  const handleApprove = () => props.onApprove(props.approval.id, { allowAlways: allowAlways() });
  const handleDeny = () => props.onDeny(props.approval.id);

  return (
    <Show
      when={!props.compact}
      fallback={
        <div
          class={`rounded-md border flex items-center gap-2 px-3 min-h-11 ${riskFrame(risk(), isResolved())}`}
          role="group"
          aria-label={`permission request: ${props.approval.tool}`}
        >
          <span class={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border font-sans font-medium ${RISK_PILL[risk()]}`}>
            {RISK_ICON[risk()]}
          </span>
          <div class="min-w-0 flex-1 flex items-baseline gap-2 overflow-hidden">
            <span class="font-sans text-[13px] font-semibold text-accent shrink-0">{props.approval.tool}</span>
            <span class="text-[12px] text-text-secondary truncate">{describeRequest(props.approval)}</span>
          </div>
          <span class="shrink-0 text-[11px] text-text-muted font-mono">
            {relativeTime(props.approval.resolvedAt ?? props.approval.timestamp)}
          </span>
          <Show
            when={!isResolved()}
            fallback={
              <span class="shrink-0 text-[11px] text-text-muted">
                {props.approval.status === "approved" ? "✓" : "✗"}
              </span>
            }
          >
            <div class="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="sm" class="h-8 px-2" onClick={handleDeny}>✗</Button>
              <Button variant={risk() === "high" ? "danger" : "primary"} size="sm" class="h-8 px-2" onClick={handleApprove}>✓</Button>
            </div>
          </Show>
        </div>
      }
    >
      <div
        class={`rounded-lg border-2 overflow-hidden ${riskFrame(risk(), isResolved())}`}
        role="group"
        aria-label={`permission request: ${props.approval.tool}`}
      >
        <div class="px-4 py-3 border-b border-border-subtle flex items-start gap-3">
          <span class="text-xl shrink-0 leading-none mt-0.5" aria-hidden="true">{RISK_ICON[risk()]}</span>
          <div class="min-w-0 flex-1">
            <div class="font-sans text-sm font-semibold text-accent break-all">{props.approval.tool}</div>
            <div class="text-[13px] text-text-primary mt-0.5 break-words">{describeRequest(props.approval)}</div>
            <Show when={cwdFromRaw(props.approval)}>
              {(cwd) => <div class="text-[11px] font-mono text-text-muted mt-1 break-all">{cwd()}</div>}
            </Show>
          </div>
          <span class="shrink-0 text-[11px] text-text-muted font-mono">{relativeTime(props.approval.timestamp)}</span>
        </div>

        <Show when={props.approval.raw && props.approval.raw.trim()}>
          <div class="px-4 py-3">
            <pre class="text-[12px] font-mono bg-codeBg rounded p-2 max-h-[160px] overflow-auto whitespace-pre-wrap break-all">
              {props.approval.raw}
            </pre>
          </div>
        </Show>

        <Show
          when={!isResolved()}
          fallback={
            <div class="px-4 py-2 border-t border-border-subtle text-[12px] text-text-muted flex items-center gap-2">
              <span>{props.approval.status === "approved" ? "✓ 已允许" : "✗ 已拒绝"}</span>
              <Show when={props.approval.resolvedAt}>
                {(t) => <span class="font-mono text-text-muted">· {relativeTime(t())}</span>}
              </Show>
              <Show when={props.approval.resolver}>
                {(r) => <span class="ml-auto text-[11px] text-text-muted">{r()}</span>}
              </Show>
            </div>
          }
        >
          <div class="px-4 py-3 border-t border-border-subtle flex flex-wrap items-center justify-end gap-2">
            <label class="mr-auto inline-flex items-center gap-2 h-10 cursor-pointer font-sans text-[12px] text-text-secondary">
              <input
                type="checkbox"
                checked={allowAlways()}
                onChange={(e) => setAllowAlways(e.currentTarget.checked)}
                class="w-4 h-4 accent-accent"
              />
              <span>始终允许此工具</span>
            </label>
            <Button variant="ghost" size="sm" class="h-11 sm:h-9" onClick={handleDeny}>拒绝</Button>
            <Button variant={risk() === "high" ? "danger" : "primary"} size="sm" class="h-11 sm:h-9" onClick={handleApprove}>
              <Show when={useFaceId()} fallback={<span>允许</span>}>
                <span>🔐 Face ID 允许</span>
              </Show>
            </Button>
          </div>
        </Show>
      </div>
    </Show>
  );
}

export default ApprovalCard;
