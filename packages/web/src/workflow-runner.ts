import { createSignal, onCleanup } from "solid-js";
import type { Workflow, WorkflowStep } from "@rcc/protocol";
import type { RccClient } from "./client.ts";
import { haptics } from "./hooks/useHaptics.ts";

export interface WorkflowRunRequest {
  workflow: Workflow;
  sid: string;
}

/**
 * [B25-B] Per-step lifecycle state. A step is `pending` before it runs,
 * `running` while its timer is in flight, and transitions to
 * `completed` once advanced, `skipped` if the user skipped it (or its
 * `condition` evaluated falsy — see B25-C), or `failed` if
 * `executeStep` threw. Failed / skipped runs still advance the cursor
 * so downstream steps don't stall silently.
 */
export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "skipped"
  | "failed";

export interface StepRecord {
  status: StepStatus;
  startedAt?: number;
  endedAt?: number;
  /** Populated for `failed` status; short human-readable message. */
  error?: string;
}

export interface RunState {
  workflow: Workflow;
  sid: string;
  /** Currently-running step index, or -1 once the run has finished. */
  index: number;
  total: number;
  startedAt: number;
  /** [B25-B] Per-step history, parallel to `workflow.steps`. */
  steps: StepRecord[];
  /** [B25-B] True once the run has reached the end. */
  finished: boolean;
  /** [B25-B] True if any step ended with `failed` status. */
  hasFailure: boolean;
}

const DEFAULT_DELAY_MS = 500;

/**
 * Client-side workflow runner. Fires each step at a fixed cadence without
 * waiting for Claude to finish responding — the runner only guarantees that
 * frames are sent in order. Call `start` to kick off, and the returned
 * dispose/stop functions to abort. The runner tracks exactly one in-flight
 * workflow at a time; calling `start` while another is running aborts the
 * previous one.
 *
 * [B25-B] In addition to `start` / `stop`:
 *   - `skipCurrent()` — mark the currently-running step as `skipped`,
 *     cancel its pending advance, and jump straight to the next step.
 *   - `resumeFrom(i)` — after a finished run (successful or with
 *     failures), pick up from step `i` while preserving the history of
 *     previously-completed steps.
 *   - `clear()` — dismiss a finished run's state (panel-close without
 *     abort semantics).
 */
export function createWorkflowRunner(client: RccClient) {
  const [state, setState] = createSignal<RunState | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  let currentReq: WorkflowRunRequest | null = null;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function stop(): void {
    cancelled = true;
    clearTimer();
    currentReq = null;
    setState(null);
  }

  /** Dismiss a completed run's state. No-op while a run is in flight. */
  function clear(): void {
    const s = state();
    if (s && !s.finished) return;
    currentReq = null;
    setState(null);
  }

  function executeStep(sid: string, step: WorkflowStep, vars: Record<string, string>): void {
    switch (step.kind) {
      case "prompt":
        client.write(sid, interpolate(step.text, vars) + "\r");
        return;
      case "slash":
        client.write(sid, "/" + interpolate(step.name, vars) + "\r");
        return;
      case "git":
        client.send({
          v: 1,
          t: "git.exec.request",
          sid,
          args: step.args.map((a) => interpolate(a, vars)),
        });
        return;
      case "wait":
        // handled by caller via delay; nothing to send
        return;
    }
  }

  function start(req: WorkflowRunRequest): void {
    stop();
    cancelled = false;
    currentReq = req;
    const startedAt = Date.now();
    const total = req.workflow.steps.length;
    const steps: StepRecord[] = Array.from(
      { length: total },
      () => ({ status: "pending" as const }),
    );
    setState({
      workflow: req.workflow,
      sid: req.sid,
      index: 0,
      total,
      startedAt,
      steps,
      finished: false,
      hasFailure: false,
    });
    runFrom(req, 0, startedAt, steps);
  }

  /**
   * [B25-B] Resume a finished run starting at step `i`. Steps before `i`
   * keep their previous status; steps from `i` onward are reset to
   * `pending` so they can run fresh. No-op if there is no prior run or
   * `i` is out of range.
   */
  function resumeFrom(i: number): void {
    const prev = state();
    if (!prev || !currentReq) return;
    if (i < 0 || i >= prev.total) return;
    clearTimer();
    cancelled = false;
    const startedAt = Date.now();
    const steps = prev.steps.map((rec, idx) =>
      idx < i ? rec : ({ status: "pending" } as StepRecord),
    );
    setState({
      ...prev,
      index: i,
      startedAt,
      steps,
      finished: false,
      hasFailure: steps.some((s) => s.status === "failed"),
    });
    runFrom(currentReq, i, startedAt, steps);
  }

  /**
   * [B25-B] Mark the currently-running step as skipped and advance
   * immediately. No-op when no step is currently running.
   */
  function skipCurrent(): void {
    const prev = state();
    if (!prev || prev.finished) return;
    if (!currentReq) return;
    const i = prev.index;
    if (i < 0 || i >= prev.total) return;
    clearTimer();
    const steps = prev.steps.slice();
    const rec = steps[i] ?? ({ status: "pending" } as StepRecord);
    steps[i] = {
      ...rec,
      status: "skipped",
      endedAt: Date.now(),
    };
    setState({ ...prev, steps });
    const req = currentReq;
    // Advance without burning the current step's remaining delay; skip
    // should feel immediate from the user's POV.
    queueMicrotask(() => {
      if (cancelled || currentReq !== req) return;
      runFrom(req, i + 1, prev.startedAt, steps);
    });
  }

  function runFrom(
    req: WorkflowRunRequest,
    i: number,
    startedAt: number,
    stepsIn: StepRecord[],
  ): void {
    if (cancelled) return;
    let steps = stepsIn.slice();
    if (i >= req.workflow.steps.length) {
      setState({
        workflow: req.workflow,
        sid: req.sid,
        index: -1,
        total: req.workflow.steps.length,
        startedAt,
        steps,
        finished: true,
        hasFailure: steps.some((s) => s.status === "failed"),
      });
      return;
    }
    const step = req.workflow.steps[i]!;
    const vars = req.workflow.variables ?? {};
    // [B25-C] Evaluate optional condition; a falsy condition marks the
    // step as `skipped` (pre-dispatch) without user interaction.
    let conditionSkipped = false;
    if (step.condition && step.condition.trim()) {
      const ok = evaluateCondition(step.condition, vars);
      if (!ok) conditionSkipped = true;
    }
    const now = Date.now();
    if (conditionSkipped) {
      steps[i] = { status: "skipped", startedAt: now, endedAt: now };
      console.info(`[workflow] step ${i + 1} skipped (condition: ${step.condition})`);
    } else {
      steps[i] = { status: "running", startedAt: now };
    }
    setState({
      workflow: req.workflow,
      sid: req.sid,
      index: i,
      total: req.workflow.steps.length,
      startedAt,
      steps,
      finished: false,
      hasFailure: steps.some((s) => s.status === "failed"),
    });
    let failed = false;
    let errMsg: string | undefined;
    if (!conditionSkipped) {
      try {
        executeStep(req.sid, step, vars);
      } catch (err) {
        failed = true;
        errMsg = err instanceof Error ? err.message : String(err);
        console.warn("[workflow] step failed", err);
      }
    }
    const delayMs = conditionSkipped
      ? 0
      : step.kind === "wait"
      ? Math.max(0, Math.floor(step.seconds * 1000))
      : DEFAULT_DELAY_MS;
    timer = setTimeout(() => {
      timer = null;
      if (cancelled) return;
      // Finalize step record — but only touch records still in "running"
      // state. `skipCurrent()` may have flipped it to "skipped" first.
      const s = state();
      if (s) {
        const snapshot = s.steps.slice();
        const rec = snapshot[i];
        if (rec && rec.status === "running") {
          snapshot[i] = {
            ...rec,
            status: failed ? "failed" : "completed",
            endedAt: Date.now(),
            error: errMsg,
          };
          setState({
            ...s,
            steps: snapshot,
            hasFailure: s.hasFailure || failed,
          });
          steps = snapshot;
          // [B29-B] subtle buzz on every successful step completion so users
          // running a long workflow on their phone know it's progressing.
          if (!failed) haptics.light();
        } else {
          steps = snapshot;
        }
      }
      runFrom(req, i + 1, startedAt, steps);
    }, delayMs);
  }

  onCleanup(stop);

  return {
    state,
    start,
    stop,
    clear,
    skipCurrent,
    resumeFrom,
    isRunning: () => {
      const s = state();
      return s !== null && !s.finished;
    },
  };
}

export type WorkflowRunner = ReturnType<typeof createWorkflowRunner>;

// ──────────────────────────────────────────────────────────────────────────
// [B25-C] Variable interpolation + conditional evaluation.
//
// Additions live at file tail to minimize merge churn with B25-B (which edits
// the top-of-file runner state). Keep export surface stable — only new named
// exports, no changes to createWorkflowRunner's signature.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Expand `{{name}}` placeholders in `input` from `vars`. Fallback order:
 *   1. vars[name]
 *   2. `${env:VAR}`-style reference (special prefix): reads globalThis env
 *      (web has none, so effectively empty string)
 *   3. empty string (never leaves the placeholder in output)
 *
 * Also supports `${name}`-style inside condition expressions — see
 * `resolveVarRef` below; that's used by evaluateCondition, NOT interpolate.
 */
export function interpolate(input: string, vars: Record<string, string>): string {
  if (!input || input.indexOf("{{") < 0) return input;
  return input.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_m, key) => {
    return resolveVarRef(key, vars);
  });
}

function resolveVarRef(key: string, vars: Record<string, string>): string {
  if (key in vars) return vars[key]!;
  // ${env:NAME} fallback — only works on web if globalThis has env shim. We
  // check in a defensive way so this stays browser-safe.
  if (key.startsWith("env:")) {
    const envKey = key.slice(4);
    const env: Record<string, string | undefined> | undefined =
      (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? undefined;
    if (env && typeof env[envKey] === "string") return env[envKey] as string;
    return "";
  }
  return "";
}

/**
 * Evaluate a simple conditional expression. Returns `true` iff the condition
 * matches; on parse error or unknown operator returns `false` (fail-closed).
 *
 * Supported operators (exactly one per expression, whitespace-separated):
 *   `==`  `!=`  `contains`  `!contains`
 *
 * LHS is always a `${name}` reference (or literal string in single quotes).
 * RHS is either a `'quoted'` string literal or another `${name}` ref.
 *
 * Examples:
 *   ${mode} == 'deploy'
 *   ${lastOutput} contains 'error'
 *   ${step_2_exit} != 0
 *   ${branch} !contains 'main'
 */
export function evaluateCondition(expr: string, vars: Record<string, string>): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return true;
  // Match: <lhs> <op> <rhs>  where op ∈ known set. We try longest ops first
  // so "!contains" isn't mis-tokenized as "!" + "contains".
  const ops = ["!contains", "contains", "==", "!="] as const;
  let op: (typeof ops)[number] | null = null;
  let opIdx = -1;
  for (const candidate of ops) {
    // must be surrounded by whitespace to avoid matching inside literals
    const idx = trimmed.indexOf(` ${candidate} `);
    if (idx >= 0) {
      op = candidate;
      opIdx = idx;
      break;
    }
  }
  if (!op || opIdx < 0) return false;
  const lhsRaw = trimmed.slice(0, opIdx).trim();
  const rhsRaw = trimmed.slice(opIdx + op.length + 2).trim();
  const lhs = resolveOperand(lhsRaw, vars);
  const rhs = resolveOperand(rhsRaw, vars);
  if (lhs === null || rhs === null) return false;
  switch (op) {
    case "==":
      return lhs === rhs;
    case "!=":
      return lhs !== rhs;
    case "contains":
      return lhs.includes(rhs);
    case "!contains":
      return !lhs.includes(rhs);
  }
}

/**
 * Resolve one side of a condition expression. Supports:
 *   - `${name}`        → vars[name] or "" (see resolveVarRef)
 *   - `'quoted'`       → literal string, with basic `\'` + `\\` unescaping
 *   - `"quoted"`       → same as single-quoted
 *   - bareword like `0`, `true` → returned as-is (string comparison)
 *
 * Returns `null` only on malformed syntax (e.g. unclosed quote) so the
 * evaluator can fail-closed.
 */
function resolveOperand(raw: string, vars: Record<string, string>): string | null {
  if (!raw) return "";
  // ${name} reference
  const refMatch = raw.match(/^\$\{\s*([a-zA-Z_][a-zA-Z0-9_:]*)\s*\}$/);
  if (refMatch) {
    return resolveVarRef(refMatch[1]!, vars);
  }
  // quoted literal
  if (
    (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) ||
    (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2)
  ) {
    const inner = raw.slice(1, -1);
    // unescape \\ and \' or \"
    return inner.replace(/\\(.)/g, "$1");
  }
  // bareword: allow simple alphanumeric / dash / dot (for numbers, true, etc.)
  if (/^[a-zA-Z0-9_.\-+]+$/.test(raw)) return raw;
  return null;
}
