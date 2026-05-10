import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { crashLogPath } from "./crash.ts";

/**
 * Batch 31 — client-side crash sink.
 *
 * The web ErrorBoundary fires a `client.crash.report` frame when a render
 * error is caught. We append the record to the same ~/.rcc/crashes.log file
 * that host-side crashes use (see crash.ts). Optional feature: no UI, no
 * broadcast, no rotation coordination — just a JSONL line tagged
 * `type: "client"` so humans grepping the log can tell them apart from
 * host crashes (which are tagged `uncaughtException` / `unhandledRejection`).
 *
 * Best-effort: never throws. A failure here must not cascade into the
 * request-handling path.
 */

interface ClientCrashInput {
  scope: string;
  stack: string;
  ua: string;
  ts: number;
}

export async function appendClientCrash(rec: ClientCrashInput): Promise<void> {
  try {
    await mkdir(dirname(crashLogPath), { recursive: true });
    // First line of the stack is usually "Name: message" for real Errors;
    // fall back to the whole stack for weird throws. Keep fields terse — the
    // log is grep-target, not a structured analytics pipeline.
    const firstLine = (rec.stack.split("\n")[0] ?? "").trim();
    const line =
      JSON.stringify({
        time: rec.ts,
        type: "client",
        scope: rec.scope,
        message: firstLine || "(client crash)",
        stack: rec.stack,
        ua: rec.ua,
      }) + "\n";
    await appendFile(crashLogPath, line, { mode: 0o600 });
  } catch (err) {
    // Never let a logging failure reach the dispatcher. Log and move on.
    // eslint-disable-next-line no-console
    console.error("[rcc-host] failed to append client crash:", err);
  }
}
