import { For, Show, lazy, type JSX } from "solid-js";
import type {
  CommandSummary,
  GitStatusData,
  PermissionMode,
  SessionDriver,
  SessionMeta,
  SessionUsage,
} from "@rcc/protocol";
import type { RccClient } from "./client.ts";
import { ChatSurface } from "./chat/ChatSurface.tsx";
import { NotebookView } from "./NotebookView.tsx";
import { RecordingPanel } from "./RecordingPanel.tsx";
import { permissionChip } from "./NewSessionModal.tsx";
import { t } from "./i18n/index.ts";
import type { createWorkflowRunner } from "./workflow-runner.ts";

const FileBrowser = lazy(() =>
  import("./FileBrowser.tsx").then((m) => ({ default: m.FileBrowser })),
);
// Lazy-load TerminalView so xterm only ships when the terminal view is opened.
const TerminalView = lazy(() =>
  import("./TerminalView.tsx").then((m) => ({ default: m.TerminalView })),
);

/**
 * MainPane — active-session chat/terminal view + optional side columns.
 *
 * Extracted from App.tsx in P3-C to keep the shell-level orchestrator thin.
 * Phase 4 will split the session header into `chat/ChatHeader.tsx` and the
 * command bar into `chat/Composer.tsx`; Phase 5 relocates the file browser
 * and notebook into their own panes. Until then, this file is the home of
 * the still-inline bits.
 */

function dotForScope(scope: "builtin" | "user" | "project"): string {
  if (scope === "project") return "bg-orange-400";
  if (scope === "user") return "bg-sky-400";
  return "bg-violet-400";
}

export interface MainPaneProps {
  client: RccClient;
  isCompact: boolean;
  sendCommand: (cmd: string) => void;
  customKeys: () => readonly { label: string; send: string; hint?: string }[];
  pinnedCommands: () => readonly CommandSummary[];
  allCommands: () => readonly CommandSummary[];
  sessions: () => SessionMeta[];
  viewMode: () => "chat" | "terminal";
  setViewMode: (v: "chat" | "terminal" | ((prev: "chat" | "terminal") => "chat" | "terminal")) => void;
  fileBrowserOpen: () => boolean;
  setFileBrowserOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  notebookOpen: () => boolean;
  setNotebookOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  fileBrowserRoot: () => string;
  workflowRunner: ReturnType<typeof createWorkflowRunner>;
  activeSid: () => string | null;
  activeSession: () => SessionMeta | undefined;
  gitBySid: () => Record<string, GitStatusData | null>;
  onShareSession: (sid: string) => void;
  onPinToNotebook?: (messageId: string) => void;
  /** [B23-A] Fork active session from a given message. */
  onForkSession?: (sid: string, messageId: string) => void;
}

export function MainPane(props: MainPaneProps): JSX.Element {
  const showTerminal = () =>
    props.viewMode() === "terminal" && props.activeSession()?.driver !== "sdk";

  return (
    <div
      class="h-full grid"
      style={{
        "grid-template-columns":
          props.isCompact
            ? "1fr"
            : props.fileBrowserOpen() && props.notebookOpen()
              ? "1fr 360px 360px"
              : props.fileBrowserOpen() || props.notebookOpen()
                ? "1fr 360px"
                : "1fr",
        "min-height": "0",
      }}
    >
      <main class="bg-bg-page flex flex-col overflow-hidden min-w-0">
        <Show
          when={showTerminal()}
          fallback={
            <div class="flex-1 min-h-0">
              <ChatSurface
                client={props.client}
                sid={props.activeSid()!}
                session={props.activeSession()}
                sessions={props.sessions()}
                gitStatus={props.gitBySid()[props.activeSid()!] ?? null}
                commands={props.allCommands()}
                viewMode={props.viewMode()}
                onSend={props.sendCommand}
                onToggleViewMode={
                  props.activeSession()?.driver === "sdk"
                    ? undefined
                    : () =>
                        props.setViewMode((v) =>
                          v === "chat" ? "terminal" : "chat",
                        )
                }
                onShare={() => props.onShareSession(props.activeSid()!)}
                onToggleNotebook={() => props.setNotebookOpen((v) => !v)}
                notebookActive={props.notebookOpen()}
                onForkFromMessage={
                  props.onForkSession
                    ? (messageId) => props.onForkSession!(props.activeSid()!, messageId)
                    : undefined
                }
                onPinToNotebook={(messageId) => {
                  props.setNotebookOpen(true);
                  const cid =
                    typeof crypto !== "undefined" && "randomUUID" in crypto
                      ? crypto.randomUUID()
                      : `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  props.client.send({
                    v: 1,
                    t: "notebook.append",
                    sid: props.activeSid()!,
                    cell: { kind: "chatRef", id: cid, messageId },
                  });
                  props.onPinToNotebook?.(messageId);
                }}
              />
            </div>
          }
        >
          <SessionHeader {...props} />
          <div class="flex-1 min-h-0 relative">
            <TerminalView client={props.client} sid={props.activeSid()!} />
          </div>
          <Show when={!props.isCompact}>
            <CommandBar {...props} />
          </Show>
        </Show>
      </main>

      <Show when={!props.isCompact && props.fileBrowserOpen()}>
        <aside class="bg-bg-page border-l border-border-subtle overflow-hidden">
          <FileBrowser client={props.client} rootCwd={props.fileBrowserRoot()} />
        </aside>
      </Show>
      <Show when={!props.isCompact && props.notebookOpen() && props.activeSid()}>
        <aside class="bg-bg-page border-l border-border-subtle overflow-hidden">
          <NotebookView client={props.client} sid={props.activeSid()!} />
        </aside>
      </Show>
    </div>
  );
}

function SessionHeader(props: MainPaneProps): JSX.Element {
  return (
    <div class="h-12 border-b border-border-subtle px-5 flex items-center justify-between shrink-0">
      <div class="flex items-center gap-3 min-w-0">
        <div class="text-sm font-medium truncate">
          {props.activeSession()?.title ?? props.activeSid()}
        </div>
        <span class="text-text-muted">·</span>
        <div class="font-mono text-xs text-text-muted">{props.activeSid()}</div>
        <Show when={props.activeSession()}>
          <PermissionChip mode={props.activeSession()!.permissionMode} />
          <DriverChip driver={props.activeSession()!.driver ?? "cli"} />
          <Show when={props.activeSession()!.usage}>
            <UsageChip usage={props.activeSession()!.usage!} />
          </Show>
          <Show when={props.gitBySid()[props.activeSid()!]}>
            <BranchChip status={props.gitBySid()[props.activeSid()!]!} />
          </Show>
        </Show>
        <button
          onClick={() => {
            if (props.activeSession()?.driver === "sdk") return;
            props.setViewMode((v) => (v === "chat" ? "terminal" : "chat"));
          }}
          disabled={props.activeSession()?.driver === "sdk"}
          class={`text-[10px] px-1.5 py-0.5 rounded border ${
            props.activeSession()?.driver === "sdk"
              ? "border-border-subtle text-text-muted cursor-not-allowed"
              : "border-border-subtle text-text-secondary hover:text-text-primary"
          }`}
          title={
            props.activeSession()?.driver === "sdk"
              ? t("main.toggleViewDisabled")
              : t("main.toggleViewTitle")
          }
        >
          {props.activeSession()?.driver === "sdk"
            ? t("main.toggleViewSdk")
            : props.viewMode() === "chat"
              ? t("main.toggleViewChat")
              : t("main.toggleViewTerminal")}
        </button>
      </div>
      <div class="flex items-center gap-2 text-[11px] text-text-muted shrink-0">
        <Show when={!props.isCompact}>
          <button
            onClick={() => props.setNotebookOpen((v) => !v)}
            class={`text-[10px] px-1.5 py-0.5 rounded border transition ${
              props.notebookOpen()
                ? "border-accent text-accent bg-accent-bg"
                : "border-border-subtle text-text-secondary hover:text-text-primary"
            }`}
            title={t("main.notebookTitle")}
          >
            {t("main.notebook")}
          </button>
        </Show>
        <RecordingPanel client={props.client} sid={props.activeSid()} />
        <span class="text-text-muted">
          {props.activeSession()?.cols}×{props.activeSession()?.rows}
        </span>
      </div>
    </div>
  );
}

function CommandBar(props: MainPaneProps): JSX.Element {
  return (
    <div class="border-t border-border-subtle p-3 shrink-0">
      <div class="flex items-center gap-1.5 overflow-x-auto scrollbar">
        <For each={props.pinnedCommands()}>
          {(c) => (
            <button
              class={`shrink-0 text-[11px] px-2.5 py-1.5 rounded-md border flex items-center gap-1.5 font-mono ${
                c.scope === "project"
                  ? "bg-accent-bg border-accent/30 text-accent hover:bg-accent/20"
                  : "bg-bg-surface border-border-subtle text-text-secondary hover:border-border-strong"
              }`}
              onClick={() => props.sendCommand(`/${c.name}`)}
              title={c.description || `发送 /${c.name}`}
            >
              <span class={`w-1 h-1 rounded-full ${dotForScope(c.scope)}`} />
              /{c.name}
            </button>
          )}
        </For>
        <span class="shrink-0 w-px h-5 bg-border-subtle mx-0.5" />
        <For each={props.customKeys()}>
          {(k) => (
            <KeyButton
              label={k.label}
              onClick={() => props.client.write(props.activeSid()!, k.send)}
              hint={k.hint}
            />
          )}
        </For>
      </div>
      <div class="mt-2 flex items-center justify-between text-[11px] text-text-muted">
        <div>{t("main.commandHint")}</div>
        <div>v0.2 · 本地模式</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small chips. Phase 4 moves these into chat/ChatHeader.tsx.
// ---------------------------------------------------------------------------

export function PermissionChip(props: { mode: PermissionMode }) {
  const { info, cls } = permissionChip(props.mode);
  return (
    <span
      class={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${cls}`}
      title={info.description}
    >
      {info.label}
    </span>
  );
}

export function DriverChip(props: { driver: SessionDriver }) {
  const isSdk = () => props.driver === "sdk";
  return (
    <span
      class={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
        isSdk()
          ? "border-violet-500/30 bg-violet-500/5 text-violet-300"
          : "border-sky-500/30 bg-sky-500/5 text-sky-300"
      }`}
      title={
        isSdk()
          ? "Claude Agent SDK 结构化事件流"
          : "传统 claude CLI (pty + 启发式解析)"
      }
    >
      {isSdk() ? "🧠 SDK" : "⌨ CLI"}
    </span>
  );
}

export function UsageChip(props: { usage: SessionUsage }) {
  const u = () => props.usage;
  const tip = () =>
    [
      `input: ${u().inputTokens.toLocaleString()}`,
      `output: ${u().outputTokens.toLocaleString()}`,
      `cache create: ${u().cacheCreateTokens.toLocaleString()}`,
      `cache read: ${u().cacheReadTokens.toLocaleString()}`,
      `cost: $${u().costUsd.toFixed(4)}`,
      `turns: ${u().turns}`,
    ].join("\n");
  return (
    <span
      class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/5 text-amber-300 font-mono"
      title={tip()}
    >
      <span>↑{formatTokensShort(u().inputTokens)}</span>
      <span class="text-text-muted">·</span>
      <span>↓{formatTokensShort(u().outputTokens)}</span>
      <span class="text-text-muted">·</span>
      <span>${u().costUsd.toFixed(u().costUsd >= 1 ? 2 : 4)}</span>
    </span>
  );
}

function formatTokensShort(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function BranchChip(props: { status: GitStatusData }) {
  const label = () => props.status.branch ?? props.status.head?.slice(0, 7) ?? "detached";
  const tooltip = () => {
    const s = props.status;
    const bits: string[] = [];
    bits.push(s.branch ? `branch ${s.branch}` : `HEAD ${s.head?.slice(0, 7) ?? "detached"}`);
    if (s.dirty) bits.push("dirty working tree");
    if (s.ahead) bits.push(`↑${s.ahead}`);
    if (s.behind) bits.push(`↓${s.behind}`);
    return bits.join(" · ");
  };
  return (
    <span
      class={`inline-flex items-center gap-1 text-[9px] px-1 py-px rounded border font-mono ${
        props.status.dirty
          ? "bg-amber-950/40 border-amber-800/60 text-amber-300"
          : "bg-bg-surface border-border-subtle text-text-secondary"
      }`}
      title={tooltip()}
    >
      <span class="opacity-80">⌥</span>
      <span class="truncate max-w-[96px]">{label()}</span>
      <Show when={props.status.dirty}>
        <span class="w-1 h-1 rounded-full bg-amber-400" />
      </Show>
      <Show when={(props.status.ahead ?? 0) > 0}>
        <span class="text-emerald-400">↑{props.status.ahead}</span>
      </Show>
      <Show when={(props.status.behind ?? 0) > 0}>
        <span class="text-rose-400">↓{props.status.behind}</span>
      </Show>
    </span>
  );
}

function KeyButton(props: { label: string; onClick: () => void; hint?: string }) {
  return (
    <button
      class="shrink-0 text-[11px] px-2 py-1.5 rounded-md bg-bg-surface border border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong font-mono"
      onClick={props.onClick}
      title={props.hint ?? props.label}
    >
      {props.label}
    </button>
  );
}

export function WorkflowRunBar(props: {
  state: import("./workflow-runner.ts").RunState | null;
  onStop: () => void;
}): JSX.Element {
  return (
    <Show when={props.state}>
      {(s) => (
        <div class="fixed top-14 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-1.5 rounded-full border border-teal-500/30 bg-bg-page/95 backdrop-blur shadow-lg text-[11px]">
          <span class="text-teal-300">⏵</span>
          <span class="text-text-primary">
            {t("workflow.running")} <span class="font-mono text-teal-200">{s().workflow.name}</span>
          </span>
          <span class="text-text-muted font-mono">
            {s().index + 1}/{s().total}
          </span>
          <div class="flex-1 h-1 rounded bg-bg-surfaceStrong overflow-hidden w-32">
            <div
              class="h-full bg-teal-400 transition-[width]"
              style={{ width: `${Math.round(((s().index + 1) / s().total) * 100)}%` }}
            />
          </div>
          <button
            onClick={props.onStop}
            class="px-2 py-0.5 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-[10px]"
          >
            {t("workflow.abort")}
          </button>
        </div>
      )}
    </Show>
  );
}
