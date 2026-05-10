import { createSignal, Show, type JSX } from "solid-js";
import Button from "../../primitives/Button.tsx";

/**
 * ApprovalBlock — inline (per-message) permission-approval card.
 *
 * This is the chat-embedded counterpart of the global PermissionApproval
 * modal. It renders the risk-coloured card, a JSON-stringified input preview,
 * and delegates approve/deny to the parent via callbacks. Parent decides on
 * passkey / WebAuthn gating — this block just surfaces the intent.
 *
 * Prop shape is tolerant: the host's live `approval.request` frame carries
 * `{ id, sid, tool, risk, summary, raw, timestamp }` (no `input`/`cwd`). We
 * accept the looser `input`-shaped payload callers already pass plus the
 * existing modal fields so both wire paths render.
 */

export interface ApprovalBlockProps {
  approval: {
    id: string;
    tool: string;
    sid: string;
    input?: unknown;
    cwd?: string;
    risk?: "low" | "medium" | "high";
    // Also present on the live wire frame — fall back if `input` is absent.
    summary?: string;
    raw?: string;
    timestamp?: number;
  };
  onApprove: (opts: { allowAlways: boolean }) => void;
  onDeny: () => void;
  device?: { hasPasskey?: boolean } | null;
  resolved?: "approved" | "denied" | null;
}

const RISK_ICON: Record<"low" | "medium" | "high", string> = {
  low: "🔒",
  medium: "⚠",
  high: "🛑",
};

function riskFrame(risk: "low" | "medium" | "high", resolved: boolean): string {
  if (resolved) return "border-border-subtle bg-bg-surface opacity-70";
  if (risk === "high") return "border-danger bg-danger/5";
  if (risk === "medium") return "border-warn bg-warn/5";
  return "border-accent bg-accent-bg";
}

function describeRequest(a: ApprovalBlockProps["approval"]): string {
  const input = a.input as Record<string, unknown> | undefined;
  if (a.tool === "Bash" || a.tool === "shell") {
    const cmd = input && typeof input.command === "string" ? input.command : "";
    return cmd ? `执行命令: ${cmd.slice(0, 80)}` : "执行命令";
  }
  if (a.tool === "Edit" || a.tool === "Write") {
    const path = input && typeof input.file_path === "string" ? input.file_path : "";
    return path ? `写入文件 ${path}` : "写入文件";
  }
  if (a.tool === "Read") {
    const path = input && typeof input.file_path === "string" ? input.file_path : "";
    return path ? `读取文件 ${path}` : "读取文件";
  }
  // Fall back to the host-provided summary (live modal path), else tool name.
  if (a.summary && a.summary.trim()) return a.summary;
  return `使用 ${a.tool}`;
}

function bodyText(a: ApprovalBlockProps["approval"]): string | null {
  if (a.input !== undefined && a.input !== null) {
    if (typeof a.input === "string") return a.input;
    try {
      return JSON.stringify(a.input, null, 2);
    } catch {
      return String(a.input);
    }
  }
  if (a.raw && a.raw.trim()) return a.raw;
  return null;
}

export function ApprovalBlock(props: ApprovalBlockProps): JSX.Element {
  const [allowAlways, setAllowAlways] = createSignal(false);
  const risk = () => props.approval.risk ?? "medium";
  const isResolved = () => props.resolved != null;
  const useFaceId = () =>
    risk() === "high" && !!props.device?.hasPasskey && !isResolved();

  function handleApprove() {
    props.onApprove({ allowAlways: allowAlways() });
  }

  return (
    <div
      class={`my-3 rounded-lg border-2 overflow-hidden ${riskFrame(
        risk(),
        isResolved(),
      )}`}
      role="group"
      aria-label={`permission request: ${props.approval.tool}`}
    >
      <div class="px-4 py-3 border-b border-border-subtle flex items-start gap-3">
        <span class="text-xl shrink-0 leading-none mt-0.5" aria-hidden="true">
          {RISK_ICON[risk()]}
        </span>
        <div class="min-w-0 flex-1">
          <div class="font-sans text-sm font-semibold text-accent break-all">
            {props.approval.tool}
          </div>
          <div class="text-[13px] text-text-primary mt-0.5 break-words">
            {describeRequest(props.approval)}
          </div>
          <Show when={props.approval.cwd}>
            <div class="text-[11px] font-mono text-text-muted mt-1 break-all">
              {props.approval.cwd}
            </div>
          </Show>
        </div>
      </div>

      <Show when={bodyText(props.approval)}>
        {(body) => (
          <div class="px-4 py-3 text-[13px]">
            <Show
              when={typeof props.approval.input === "string"}
              fallback={
                <pre class="text-[12px] font-mono bg-codeBg rounded p-2 max-h-[160px] overflow-auto whitespace-pre-wrap break-all">
                  {body()}
                </pre>
              }
            >
              <div class="text-[13px] whitespace-pre-wrap break-words">
                {body()}
              </div>
            </Show>
          </div>
        )}
      </Show>

      <Show
        when={!isResolved()}
        fallback={
          <div class="px-4 py-2 border-t border-border-subtle text-[12px] text-text-muted">
            <Show
              when={props.resolved === "approved"}
              fallback={<span>✗ 已拒绝</span>}
            >
              <span>✓ 已允许</span>
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
          <Button
            variant="ghost"
            size="sm"
            class="h-11 sm:h-9"
            onClick={() => props.onDeny()}
          >
            拒绝
          </Button>
          <Button
            variant={risk() === "high" ? "danger" : "primary"}
            size="sm"
            class="h-11 sm:h-9"
            onClick={handleApprove}
          >
            <Show when={useFaceId()} fallback={<span>允许</span>}>
              <span>🔐 Face ID 允许</span>
            </Show>
          </Button>
        </div>
      </Show>
    </div>
  );
}

export default ApprovalBlock;
