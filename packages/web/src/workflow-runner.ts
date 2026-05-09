import { createSignal, onCleanup } from "solid-js";
import type { Workflow, WorkflowStep } from "@rcc/protocol";
import type { RccClient } from "./client.ts";

export interface WorkflowRunRequest {
  workflow: Workflow;
  sid: string;
}

export interface RunState {
  workflow: Workflow;
  sid: string;
  index: number;
  total: number;
  startedAt: number;
}

const DEFAULT_DELAY_MS = 500;

/**
 * Client-side workflow runner. Fires each step at a fixed cadence without
 * waiting for Claude to finish responding — the runner only guarantees that
 * frames are sent in order. Call `start` to kick off, and the returned
 * dispose/stop functions to abort. The runner tracks exactly one in-flight
 * workflow at a time; calling `start` while another is running aborts the
 * previous one.
 */
export function createWorkflowRunner(client: RccClient) {
  const [state, setState] = createSignal<RunState | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function stop(): void {
    cancelled = true;
    clearTimer();
    setState(null);
  }

  function executeStep(sid: string, step: WorkflowStep): void {
    switch (step.kind) {
      case "prompt":
        client.write(sid, step.text + "\r");
        return;
      case "slash":
        client.write(sid, "/" + step.name + "\r");
        return;
      case "git":
        client.send({ v: 1, t: "git.exec.request", sid, args: step.args });
        return;
      case "wait":
        // handled by caller via delay; nothing to send
        return;
    }
  }

  function start(req: WorkflowRunRequest): void {
    stop();
    cancelled = false;
    const startedAt = Date.now();
    const total = req.workflow.steps.length;
    setState({ workflow: req.workflow, sid: req.sid, index: 0, total, startedAt });
    runFrom(req, 0, startedAt);
  }

  function runFrom(req: WorkflowRunRequest, i: number, startedAt: number): void {
    if (cancelled) return;
    if (i >= req.workflow.steps.length) {
      setState(null);
      return;
    }
    const step = req.workflow.steps[i]!;
    setState({
      workflow: req.workflow,
      sid: req.sid,
      index: i,
      total: req.workflow.steps.length,
      startedAt,
    });
    try {
      executeStep(req.sid, step);
    } catch (err) {
      console.warn("[workflow] step failed", err);
    }
    const delayMs = step.kind === "wait"
      ? Math.max(0, Math.floor(step.seconds * 1000))
      : DEFAULT_DELAY_MS;
    timer = setTimeout(() => {
      timer = null;
      runFrom(req, i + 1, startedAt);
    }, delayMs);
  }

  onCleanup(stop);

  return {
    state,
    start,
    stop,
    isRunning: () => state() !== null,
  };
}

export type WorkflowRunner = ReturnType<typeof createWorkflowRunner>;
