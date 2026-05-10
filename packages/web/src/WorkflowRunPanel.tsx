import { For, Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import type { WorkflowStep } from "@rcc/protocol";
import type { RunState, StepRecord, StepStatus } from "./workflow-runner.ts";
import { t } from "./i18n/index.ts";

/**
 * [B25-B] Workflow runner UX panel.
 *
 * Replaces the tiny top-pill `WorkflowRunBar` with a proper step-progress
 * panel:
 *   - One row per step showing status (pending / running / completed /
 *     skipped / failed), description, and per-step elapsed time.
 *   - Global STOP button is always visible and always unmissable (red).
 *   - While running: SKIP button on the current step.
 *   - After finish: RESUME button on each failed/skipped step + a "dismiss"
 *     button on the header; a "run again" button is always available.
 *   - Minimize collapses the panel to a compact summary line (same pill
 *     that used to be `WorkflowRunBar`) so it stops covering chat.
 *
 * Layout:
 *   - Desktop (≥640px): floating card top-center, max-h 60vh, scroll inside.
 *   - Mobile (<640px):  bottom sheet pinned to bottom, full width, respects
 *     safe-area inset; each row is ≥44px for touch.
 */

export interface WorkflowRunPanelProps {
  state: RunState | null;
  onStop: () => void;
  onSkip: () => void;
  onResumeFrom: (i: number) => void;
  onDismiss: () => void;
  onRestart?: () => void;
}

export function WorkflowRunPanel(props: WorkflowRunPanelProps): JSX.Element {
  const [collapsed, setCollapsed] = createSignal(false);
  // "tick" signal forces elapsed-time readouts to re-compute every 500 ms
  // while a run is in flight. Cheap — we only create the interval when
  // there is something to show.
  const [tick, setTick] = createSignal(0);
  createEffect(() => {
    const s = props.state;
    if (!s || s.finished) return;
    const id = setInterval(() => setTick((n) => n + 1), 500);
    onCleanup(() => clearInterval(id));
  });

  const totalElapsed = () => {
    void tick();
    const s = props.state;
    if (!s) return 0;
    return Date.now() - s.startedAt;
  };

  return (
    <Show when={props.state}>
      {(s) => (
        <Show when={!collapsed()} fallback={
          <CompactPill
            state={s()}
            elapsed={totalElapsed()}
            onExpand={() => setCollapsed(false)}
            onStop={props.onStop}
          />
        }>
          <div
            class={[
              // Desktop: floating top-center card.
              "fixed z-40 flex flex-col",
              "top-14 left-1/2 -translate-x-1/2",
              "w-[min(560px,calc(100vw-24px))]",
              "rounded-xl border border-border-subtle bg-bg-page/95 backdrop-blur",
              "shadow-2xl max-h-[min(60vh,600px)]",
              // Mobile: bottom sheet. `sm:` breakpoint = 640px.
              "max-sm:left-0 max-sm:right-0 max-sm:top-auto max-sm:bottom-0",
              "max-sm:w-full max-sm:translate-x-0",
              "max-sm:rounded-b-none max-sm:rounded-t-2xl",
              "max-sm:max-h-[70vh]",
              "max-sm:pb-[env(safe-area-inset-bottom)]",
            ].join(" ")}
            role="region"
            aria-label="Workflow runner"
          >
            <Header
              state={s()}
              elapsed={totalElapsed()}
              onStop={props.onStop}
              onDismiss={props.onDismiss}
              onCollapse={() => setCollapsed(true)}
              onRestart={props.onRestart}
            />
            <StepList
              state={s()}
              onSkip={props.onSkip}
              onResumeFrom={props.onResumeFrom}
            />
          </div>
        </Show>
      )}
    </Show>
  );
}

/* -------------------------------------------------------------------------- */
/* Header                                                                     */
/* -------------------------------------------------------------------------- */

function Header(props: {
  state: RunState;
  elapsed: number;
  onStop: () => void;
  onDismiss: () => void;
  onCollapse: () => void;
  onRestart?: () => void;
}): JSX.Element {
  const finished = () => props.state.finished;
  const hasFailure = () => props.state.hasFailure;
  const done = () => props.state.steps.filter((r) => r.status === "completed").length;
  return (
    <div class="flex items-center gap-2 px-3 py-2 border-b border-border-subtle shrink-0">
      <span
        class={`text-[11px] font-medium shrink-0 ${
          finished()
            ? hasFailure()
              ? "text-rose-300"
              : "text-emerald-300"
            : "text-teal-300"
        }`}
      >
        <Show
          when={finished()}
          fallback={<span>⏵ {t("workflow.running")}</span>}
        >
          <span>
            {hasFailure() ? "⚠ " : "✓ "}
            {hasFailure() ? t("workflow.finishedWithErrors") : t("workflow.finished")}
          </span>
        </Show>
      </span>
      <span class="text-xs font-mono text-text-primary truncate min-w-0">
        {props.state.workflow.name}
      </span>
      <span class="text-[10px] font-mono text-text-muted shrink-0">
        {done()}/{props.state.total} · {formatElapsed(props.elapsed)}
      </span>
      <div class="flex-1" />
      <Show when={finished()}>
        <Show when={props.onRestart}>
          <button
            onClick={props.onRestart}
            class="text-[10px] px-2 py-1 rounded border border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong min-h-[28px]"
            title={t("workflow.runAgain")}
          >
            {t("workflow.runAgain")}
          </button>
        </Show>
        <button
          onClick={props.onDismiss}
          class="text-[10px] px-2 py-1 rounded border border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong min-h-[28px]"
          title={t("workflow.dismiss")}
        >
          {t("workflow.dismiss")}
        </button>
      </Show>
      <button
        onClick={props.onCollapse}
        class="text-[10px] px-2 py-1 rounded border border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong min-h-[28px]"
        title={t("workflow.minimize")}
        aria-label={t("workflow.minimize")}
      >
        ▾
      </button>
      <Show when={!finished()}>
        <button
          onClick={props.onStop}
          class={[
            "text-[11px] font-semibold px-3 py-1.5 rounded-md",
            "border border-rose-500/50 bg-rose-500/15 text-rose-200",
            "hover:bg-rose-500/25 hover:border-rose-400",
            "min-h-[32px] shrink-0",
          ].join(" ")}
          title={t("workflow.stop")}
        >
          ■ {t("workflow.stop")}
        </button>
      </Show>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Step list                                                                  */
/* -------------------------------------------------------------------------- */

function StepList(props: {
  state: RunState;
  onSkip: () => void;
  onResumeFrom: (i: number) => void;
}): JSX.Element {
  return (
    <div class="flex-1 min-h-0 overflow-y-auto scrollbar px-2 py-2">
      <ul class="flex flex-col gap-1">
        <For each={props.state.workflow.steps}>
          {(step, idx) => (
            <StepRow
              i={idx()}
              step={step}
              record={props.state.steps[idx()] ?? { status: "pending" }}
              isCurrent={!props.state.finished && props.state.index === idx()}
              runFinished={props.state.finished}
              onSkip={props.onSkip}
              onResumeFrom={props.onResumeFrom}
            />
          )}
        </For>
      </ul>
    </div>
  );
}

function StepRow(props: {
  i: number;
  step: WorkflowStep;
  record: StepRecord;
  isCurrent: boolean;
  runFinished: boolean;
  onSkip: () => void;
  onResumeFrom: (i: number) => void;
}): JSX.Element {
  const status = () => props.record.status;
  const label = () => describeStep(props.step);
  const tone = () => statusTone(status());
  const elapsed = () => {
    const r = props.record;
    if (r.startedAt == null) return null;
    const end = r.endedAt ?? Date.now();
    return end - r.startedAt;
  };
  return (
    <li
      class={[
        "flex items-center gap-2 px-2 py-1.5 rounded-md border min-h-[44px]",
        props.isCurrent
          ? "border-teal-500/40 bg-teal-500/5"
          : "border-border-subtle bg-bg-surface/40",
      ].join(" ")}
    >
      <StatusIcon status={status()} />
      <span class="text-[10px] font-mono text-text-muted w-5 text-right shrink-0">
        {props.i + 1}
      </span>
      <div class="flex-1 min-w-0">
        <div class="text-xs text-text-primary truncate" title={label()}>
          {label()}
        </div>
        <div class="text-[10px] text-text-muted flex items-center gap-1.5">
          <span class={tone()}>{statusLabel(status())}</span>
          <Show when={elapsed() != null}>
            <span>·</span>
            <span class="font-mono">{formatElapsed(elapsed()!)}</span>
          </Show>
          <Show when={props.record.error}>
            <span>·</span>
            <span class="text-rose-300 truncate" title={props.record.error}>
              {props.record.error}
            </span>
          </Show>
        </div>
      </div>
      <Show when={props.isCurrent}>
        <button
          onClick={props.onSkip}
          class="text-[10px] px-2 py-1 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 min-h-[32px] shrink-0"
          title={t("workflow.skip")}
        >
          {t("workflow.skip")}
        </button>
      </Show>
      <Show
        when={
          props.runFinished &&
          (status() === "failed" || status() === "skipped" || status() === "pending")
        }
      >
        <button
          onClick={() => props.onResumeFrom(props.i)}
          class={[
            "text-[10px] px-2 py-1 rounded border min-h-[32px] shrink-0",
            status() === "failed"
              ? "border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
              : "border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong",
          ].join(" ")}
          title={status() === "failed" ? t("workflow.retry") : t("workflow.resume")}
        >
          {status() === "failed" ? t("workflow.retry") : t("workflow.resume")}
        </button>
      </Show>
    </li>
  );
}

function StatusIcon(props: { status: StepStatus }): JSX.Element {
  return (
    <span class="shrink-0 w-4 h-4 flex items-center justify-center">
      <Show when={props.status === "running"}>
        <span class="w-3 h-3 rounded-full border-2 border-teal-300 border-t-transparent animate-spin" />
      </Show>
      <Show when={props.status === "completed"}>
        <span class="text-emerald-400 text-xs" aria-hidden>✓</span>
      </Show>
      <Show when={props.status === "failed"}>
        <span class="text-rose-400 text-xs" aria-hidden>✕</span>
      </Show>
      <Show when={props.status === "skipped"}>
        <span class="text-amber-400 text-xs" aria-hidden>⤼</span>
      </Show>
      <Show when={props.status === "pending"}>
        <span class="w-2 h-2 rounded-full bg-border-strong" aria-hidden />
      </Show>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Compact (minimized) pill                                                   */
/* -------------------------------------------------------------------------- */

function CompactPill(props: {
  state: RunState;
  elapsed: number;
  onExpand: () => void;
  onStop: () => void;
}): JSX.Element {
  const pct = () => {
    const s = props.state;
    const done = s.steps.filter(
      (r) => r.status === "completed" || r.status === "skipped" || r.status === "failed",
    ).length;
    return Math.round((done / Math.max(1, s.total)) * 100);
  };
  const running = () => !props.state.finished;
  return (
    <div
      class={[
        "fixed top-14 left-1/2 -translate-x-1/2 z-40",
        "flex items-center gap-3 px-3 py-1.5 rounded-full",
        "border border-border-subtle bg-bg-page/95 backdrop-blur shadow-lg",
        "text-[11px] max-w-[calc(100vw-24px)]",
      ].join(" ")}
    >
      <button
        onClick={props.onExpand}
        class="flex items-center gap-2 min-w-0 text-text-primary hover:text-accent"
        title={t("workflow.expand")}
      >
        <span class={running() ? "text-teal-300" : props.state.hasFailure ? "text-rose-300" : "text-emerald-300"}>
          {running() ? "⏵" : props.state.hasFailure ? "⚠" : "✓"}
        </span>
        <span class="font-mono text-teal-200 truncate max-w-[160px]">
          {props.state.workflow.name}
        </span>
        <span class="text-text-muted font-mono">
          {pct()}%
        </span>
      </button>
      <div class="h-1 w-28 rounded bg-bg-surfaceStrong overflow-hidden">
        <div
          class={`h-full transition-[width] ${
            props.state.hasFailure ? "bg-rose-400" : "bg-teal-400"
          }`}
          style={{ width: `${pct()}%` }}
        />
      </div>
      <Show when={running()}>
        <button
          onClick={props.onStop}
          class="px-2 py-0.5 rounded border border-rose-500/50 text-rose-200 hover:bg-rose-500/15 text-[10px] font-semibold"
          title={t("workflow.stop")}
        >
          ■
        </button>
      </Show>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function describeStep(step: WorkflowStep): string {
  switch (step.kind) {
    case "prompt":
      return step.text;
    case "slash":
      return `/${step.name}`;
    case "git":
      return `git ${step.args.join(" ")}`;
    case "wait":
      return `wait ${step.seconds}s`;
  }
}

function statusLabel(s: StepStatus): string {
  switch (s) {
    case "pending":
      return t("workflow.stepPending");
    case "running":
      return t("workflow.stepRunning");
    case "completed":
      return t("workflow.stepCompleted");
    case "skipped":
      return t("workflow.stepSkipped");
    case "failed":
      return t("workflow.stepFailed");
  }
}

function statusTone(s: StepStatus): string {
  switch (s) {
    case "running":
      return "text-teal-300";
    case "completed":
      return "text-emerald-300";
    case "failed":
      return "text-rose-300";
    case "skipped":
      return "text-amber-300";
    default:
      return "text-text-muted";
  }
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.floor(s - m * 60);
  return `${m}m${rest.toString().padStart(2, "0")}s`;
}
