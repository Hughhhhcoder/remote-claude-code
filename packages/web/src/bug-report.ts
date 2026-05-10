// [B31-B] Bug-report bundle builder.
//
// Pure data gather + redact + serialize. No DOM, no fetches, no ws — the
// consumer is BugReportModal.tsx which hands us already-fetched pieces.
// Keeping this module pure lets a future unit test round-trip known input
// through redactValue() without spinning up a browser.
//
// Redaction rules (conservative — err on over-redaction):
//   - object key matches /token|password|secret|key|authorization/i → "[REDACTED]"
//     (substring match, case-insensitive; catches `apiToken`, `sshKey`,
//     `Authorization`, etc.)
//   - string value matches /^[A-Za-z0-9_-]{32,}$/ AND length > 40 →
//     "[REDACTED_HASH]" (catches bearer tokens, long hashes; short words
//     like `AuthenticationFailedException` are >40 but contain separators
//     so the char-class `[A-Za-z0-9_-]` still matches — those will be
//     redacted too, acceptable per "over-redact" guidance)
//   - absolute filesystem paths (start with `/` or `<drive>:\`) → keep only
//     the basename; applied to string VALUES, not keys.
//
// Redaction walks arbitrary JSON-ish values (objects/arrays/primitives).
// Circular refs are broken by a visited WeakSet — cycles become the sentinel
// `"[CIRCULAR]"`.
import type { AuditEntry, ChatMessage, SessionMeta } from "@rcc/protocol";

export const REDACTED_KEY_RE = /token|password|secret|key|authorization/i;
export const LONG_HASH_RE = /^[A-Za-z0-9_-]{32,}$/;

/** Strip leading directory components from an absolute path, keeping the
 * final segment. Handles `/unix/style`, `C:\windows\style`, and mixed
 * separators. Returns the original string if no separator is present. */
export function basenameOnly(p: string): string {
  if (!p) return p;
  // Normalize: split on both / and \
  const lastSlash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (lastSlash < 0) return p;
  return p.slice(lastSlash + 1) || p;
}

/** Heuristic: does this look like an absolute filesystem path? */
export function isAbsolutePath(s: string): boolean {
  if (s.length < 2) return false;
  if (s.startsWith("/") && !s.startsWith("//")) return true; // unix (skip `//host` URLs)
  // windows drive letter: `C:\` or `C:/`
  if (/^[A-Za-z]:[\\/]/.test(s)) return true;
  return false;
}

/** Redact a single string value (not a key). Order matters: path-basename
 * runs BEFORE hash check so `/tmp/abcdef…long` collapses to a short
 * basename that won't trip LONG_HASH_RE. */
export function redactString(s: string): string {
  if (isAbsolutePath(s)) return basenameOnly(s);
  if (s.length > 40 && LONG_HASH_RE.test(s)) return "[REDACTED_HASH]";
  return s;
}

/** Recursively redact arbitrary data. Objects: keys matching REDACTED_KEY_RE
 * get their value replaced wholesale; other values recurse. */
export function redactValue(
  input: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") return redactString(input);
  if (typeof input !== "object") return input;
  if (seen.has(input as object)) return "[CIRCULAR]";
  seen.add(input as object);
  if (Array.isArray(input)) {
    return input.map((v) => redactValue(v, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (REDACTED_KEY_RE.test(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    out[k] = redactValue(v, seen);
  }
  return out;
}

/** Shape of the assembled bundle. Stable — external tools may grep it. */
export interface BugReportBundle {
  generatedAt: number;
  schemaVersion: 1;
  version: {
    app: string | null;
    node: string | null;
    buildTime: number | null;
  };
  browser: {
    userAgent: string;
    language: string;
    viewport: { width: number; height: number };
    devicePixelRatio: number;
    memory: number | null;
    online: boolean;
    platform: string | null;
  };
  client: {
    activeSid: string | null;
    sessionCount: number;
    sessions: Array<{
      id: string;
      title?: string;
      status: string;
      driver: string;
      createdAt: number;
      projectId?: string;
      peerId?: string;
    }>;
    prefs: unknown;
    deviceId: string | null;
    deviceName: string | null;
  };
  auditEntries: AuditEntry[];
  chatHistory: {
    included: boolean;
    sid: string | null;
    messageCount: number;
    messages: ChatMessage[];
  };
}

export interface VersionInfoInput {
  version?: string;
  node?: string;
  buildTime?: number;
}

export interface DeviceInput {
  id?: string;
  name?: string;
}

export interface BuildBundleInput {
  versionInfo: VersionInfoInput | null;
  sessions: readonly SessionMeta[];
  activeSid: string | null;
  prefs: unknown;
  device: DeviceInput | null;
  auditEntries: readonly AuditEntry[];
  includeChat: boolean;
  chatSid: string | null;
  chatMessages: readonly ChatMessage[];
}

/** Browser snapshot — best-effort, every field degrades gracefully on
 * headless / SSR / partial APIs. */
export function snapshotBrowser(): BugReportBundle["browser"] {
  const nav: Navigator | undefined =
    typeof navigator !== "undefined" ? navigator : undefined;
  const win: Window | undefined = typeof window !== "undefined" ? window : undefined;
  // deviceMemory is GB, not widely typed — cast.
  const mem = nav
    ? ((nav as unknown as { deviceMemory?: number }).deviceMemory ?? null)
    : null;
  return {
    userAgent: nav?.userAgent ?? "unknown",
    language: nav?.language ?? "unknown",
    viewport: {
      width: win?.innerWidth ?? 0,
      height: win?.innerHeight ?? 0,
    },
    devicePixelRatio: win?.devicePixelRatio ?? 1,
    memory: mem,
    online: typeof nav?.onLine === "boolean" ? nav.onLine : true,
    platform: nav?.platform ?? null,
  };
}

/** Assemble the bundle, then redact the whole thing in one pass. Input is
 * already narrowed to what we want (no tokens in prefs, etc.), but we still
 * redact defensively: prefs is typed `unknown` and future schema additions
 * could smuggle a secret. */
export function buildBugReport(input: BuildBundleInput): BugReportBundle {
  const limitedAudit = input.auditEntries.slice(-100);
  const limitedMessages = input.includeChat
    ? input.chatMessages.slice(-50)
    : [];

  const rawSessions = input.sessions.map((s) => ({
    id: s.id,
    title: s.title,
    status: s.status,
    driver: s.driver,
    createdAt: s.createdAt,
    projectId: s.projectId,
    peerId: s.peerId,
  }));

  const raw: BugReportBundle = {
    generatedAt: Date.now(),
    schemaVersion: 1,
    version: {
      app: input.versionInfo?.version ?? null,
      node: input.versionInfo?.node ?? null,
      buildTime: input.versionInfo?.buildTime ?? null,
    },
    browser: snapshotBrowser(),
    client: {
      activeSid: input.activeSid,
      sessionCount: input.sessions.length,
      sessions: rawSessions,
      prefs: input.prefs,
      deviceId: input.device?.id ?? null,
      deviceName: input.device?.name ?? null,
    },
    auditEntries: [...limitedAudit],
    chatHistory: {
      included: input.includeChat,
      sid: input.includeChat ? input.chatSid : null,
      messageCount: limitedMessages.length,
      messages: [...limitedMessages],
    },
  };

  return redactValue(raw) as BugReportBundle;
}

/** Pretty-printed JSON with a trailing newline (makes paste-into-file nicer). */
export function serializeBundle(bundle: BugReportBundle): string {
  return JSON.stringify(bundle, null, 2) + "\n";
}

/** Stable filename: `rcc-bug-report-YYYYMMDD-HHmmss.json`. */
export function suggestFilename(now: number = Date.now()): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, "0");
  const ts =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `rcc-bug-report-${ts}.json`;
}
