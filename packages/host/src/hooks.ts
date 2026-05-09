import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type HookScope = "user" | "project";

export type HookEventName =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "Notification"
  | "Stop"
  | "SubagentStop"
  | "SessionStart"
  | "SessionEnd"
  | "PreCompact";

export const HOOK_EVENT_NAMES: readonly HookEventName[] = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
] as const;

export interface HookAction {
  type: "command";
  command: string;
  timeout?: number;
  truncated?: boolean;
}

export interface HookMatcher {
  matcher?: string;
  hooks: HookAction[];
}

export interface HookConfig {
  scope: HookScope;
  event: HookEventName;
  index: number;
  matcher?: string;
  hooks: HookAction[];
}

export interface HookTestResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated?: boolean;
}

const MAX_COMMAND_LEN = 32 * 1024;
const MAX_OUTPUT_LEN = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

function userSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

function projectSettingsPath(cwd: string): string {
  return join(cwd, ".claude", "settings.json");
}

function settingsPath(scope: HookScope, cwd: string): string {
  return scope === "user" ? userSettingsPath() : projectSettingsPath(cwd);
}

async function readSettings(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {};
  try {
    const raw = await readFile(path, "utf8");
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch (err) {
    throw new Error(`failed to parse ${path}: ${(err as Error).message}`);
  }
}

async function writeSettings(path: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const json = JSON.stringify(data, null, 2) + "\n";
  await writeFile(path, json, "utf8");
}

function sanitizeAction(raw: unknown): HookAction | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.type !== "command") return null;
  const cmdRaw = typeof r.command === "string" ? r.command : "";
  if (!cmdRaw) return null;
  let command = cmdRaw;
  let truncated = false;
  if (command.length > MAX_COMMAND_LEN) {
    command = command.slice(0, MAX_COMMAND_LEN);
    truncated = true;
  }
  const action: HookAction = { type: "command", command };
  if (typeof r.timeout === "number" && Number.isFinite(r.timeout) && r.timeout > 0) {
    action.timeout = Math.floor(r.timeout);
  }
  if (truncated) action.truncated = true;
  return action;
}

function sanitizeMatcher(raw: unknown): HookMatcher | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const hooksRaw = Array.isArray(r.hooks) ? r.hooks : [];
  const hooks: HookAction[] = [];
  for (const h of hooksRaw) {
    const a = sanitizeAction(h);
    if (a) hooks.push(a);
  }
  const m: HookMatcher = { hooks };
  if (typeof r.matcher === "string") m.matcher = r.matcher;
  return m;
}

function readHooksFromSettings(
  settings: Record<string, unknown>,
  scope: HookScope,
): HookConfig[] {
  const raw = settings.hooks;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: HookConfig[] = [];
  for (const event of HOOK_EVENT_NAMES) {
    const arr = (raw as Record<string, unknown>)[event];
    if (!Array.isArray(arr)) continue;
    arr.forEach((entry, index) => {
      const m = sanitizeMatcher(entry);
      if (!m) return;
      const cfg: HookConfig = {
        scope,
        event,
        index,
        hooks: m.hooks,
      };
      if (m.matcher !== undefined) cfg.matcher = m.matcher;
      out.push(cfg);
    });
  }
  return out;
}

export async function listHooks(
  scope: "user" | "project" | "all",
  projectCwd: string,
): Promise<HookConfig[]> {
  const out: HookConfig[] = [];
  if (scope === "user" || scope === "all") {
    const s = await readSettings(userSettingsPath());
    out.push(...readHooksFromSettings(s, "user"));
  }
  if (scope === "project" || scope === "all") {
    const s = await readSettings(projectSettingsPath(projectCwd));
    out.push(...readHooksFromSettings(s, "project"));
  }
  return out;
}

function getHooksObject(settings: Record<string, unknown>): Record<string, unknown> {
  const raw = settings.hooks;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  const fresh: Record<string, unknown> = {};
  settings.hooks = fresh;
  return fresh;
}

function serializeAction(a: HookAction): Record<string, unknown> {
  const out: Record<string, unknown> = { type: "command", command: a.command };
  if (a.timeout && a.timeout > 0) out.timeout = a.timeout;
  return out;
}

function serializeEntry(matcher: string | undefined, hooks: HookAction[]): Record<string, unknown> {
  const entry: Record<string, unknown> = {};
  if (matcher !== undefined && matcher !== "") entry.matcher = matcher;
  entry.hooks = hooks.map(serializeAction);
  return entry;
}

export async function writeHook(
  scope: HookScope,
  event: HookEventName,
  index: number,
  matcher: string | undefined,
  hooks: HookAction[],
  projectCwd: string,
): Promise<void> {
  if (!HOOK_EVENT_NAMES.includes(event)) {
    throw new Error(`invalid hook event: ${event}`);
  }
  const cleaned: HookAction[] = hooks
    .map((h) => sanitizeAction(h))
    .filter((x): x is HookAction => x !== null);
  if (cleaned.length === 0) {
    throw new Error("at least one command is required");
  }
  const path = settingsPath(scope, projectCwd);
  const settings = await readSettings(path);
  const hooksObj = getHooksObject(settings);
  const existing = Array.isArray(hooksObj[event]) ? (hooksObj[event] as unknown[]) : [];
  const entry = serializeEntry(matcher, cleaned);
  let next: unknown[];
  if (index < 0 || index >= existing.length) {
    next = [...existing, entry];
  } else {
    next = existing.slice();
    next[index] = entry;
  }
  hooksObj[event] = next;
  await writeSettings(path, settings);
}

export async function deleteHook(
  scope: HookScope,
  event: HookEventName,
  index: number,
  projectCwd: string,
): Promise<boolean> {
  const path = settingsPath(scope, projectCwd);
  if (!existsSync(path)) return false;
  const settings = await readSettings(path);
  const raw = settings.hooks;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const hooksObj = raw as Record<string, unknown>;
  const arr = hooksObj[event];
  if (!Array.isArray(arr)) return false;
  if (index < 0 || index >= arr.length) return false;
  const next = arr.slice();
  next.splice(index, 1);
  if (next.length === 0) {
    delete hooksObj[event];
  } else {
    hooksObj[event] = next;
  }
  if (Object.keys(hooksObj).length === 0) {
    delete settings.hooks;
  }
  await writeSettings(path, settings);
  return true;
}

function truncate(s: string, limit = MAX_OUTPUT_LEN): { out: string; truncated: boolean } {
  if (s.length <= limit) return { out: s, truncated: false };
  return { out: s.slice(0, limit), truncated: true };
}

export async function testHook(
  scope: HookScope,
  event: HookEventName,
  index: number,
  hookIndex: number,
  projectCwd: string,
): Promise<HookTestResult> {
  const settings = await readSettings(settingsPath(scope, projectCwd));
  const raw = settings.hooks;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("no hooks configured");
  }
  const arr = (raw as Record<string, unknown>)[event];
  if (!Array.isArray(arr) || index < 0 || index >= arr.length) {
    throw new Error(`hook not found: ${event}[${index}]`);
  }
  const entry = sanitizeMatcher(arr[index]);
  if (!entry || entry.hooks.length === 0) {
    throw new Error(`hook has no commands: ${event}[${index}]`);
  }
  const sub = Math.max(0, Math.min(hookIndex, entry.hooks.length - 1));
  const action = entry.hooks[sub]!;
  const timeoutMs = (action.timeout && action.timeout > 0 ? action.timeout : DEFAULT_TIMEOUT_MS);
  const cwd = scope === "project" ? projectCwd : homedir();
  return new Promise<HookTestResult>((resolve) => {
    let settled = false;
    const child = execFile(
      "sh",
      ["-c", action.command],
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_LEN * 2,
        env: process.env,
        encoding: "utf8",
      },
      (err, stdout, stderr) => {
        if (settled) return;
        settled = true;
        const outS = stdout ?? "";
        const errS = stderr ?? "";
        const { out: sOut, truncated: tOut } = truncate(outS);
        const { out: sErr, truncated: tErr } = truncate(errS);
        if (err) {
          const code =
            typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number"
              ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? null)
              : child.exitCode;
          resolve({
            ok: false,
            stdout: sOut,
            stderr: sErr || err.message,
            exitCode: code ?? null,
            truncated: tOut || tErr,
          });
          return;
        }
        resolve({
          ok: true,
          stdout: sOut,
          stderr: sErr,
          exitCode: child.exitCode,
          truncated: tOut || tErr,
        });
      },
    );
  });
}
