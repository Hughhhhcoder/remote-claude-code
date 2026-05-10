// [B31-C · logs-export] Gather + redact + bundle ~/.rcc/{audit.jsonl,crashes.log,config.json}
// plus host versionSummary() into a single JSON document. Exposed via
// GET /api/v1/logs/export (authenticated); the web client downloads the
// returned document as rcc-logs-<ts>.json. Sensitive fields (token /
// password / secret / key / credentials / cert / vapid — case-insensitive)
// are recursively replaced with "[REDACTED]" before the config is
// emitted; the audit/crash streams are included verbatim as they already
// redact at write time.

import { readFile } from "node:fs/promises";
import { auditLogPath } from "./audit.ts";
import { crashLogPath } from "./crash.ts";
import { configPath } from "./config.ts";
import { versionSummary } from "./version.ts";

const AUDIT_TAIL = 1000;
const CRASH_TAIL = 500;
const REDACT_KEY_RE = /token|password|secret|key|credentials|cert|vapid/i;
const REDACT_PLACEHOLDER = "[REDACTED]";

export interface LogsExportBundle {
  v: 1;
  exportedAt: number;
  version: Awaited<ReturnType<typeof versionSummary>>;
  audit: {
    path: string;
    lineCount: number;
    entries: unknown[];
  };
  crashes: {
    path: string;
    lineCount: number;
    lines: string[];
  };
  config: {
    path: string;
    redacted: unknown;
  };
}

/**
 * Recursively walk an arbitrary JSON value, replacing any value whose key
 * matches REDACT_KEY_RE with REDACT_PLACEHOLDER. Handles arrays, plain
 * objects, null, primitives. Cycles are unlikely in a JSON config but we
 * still guard against them with a visited WeakSet.
 */
export function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEY_RE.test(k)) {
      out[k] = REDACT_PLACEHOLDER;
    } else {
      out[k] = redact(v, seen);
    }
  }
  return out;
}

async function tailLines(path: string, n: number): Promise<{ lines: string[]; total: number }> {
  try {
    const raw = await readFile(path, "utf8");
    // Split but drop the empty trailing element that `raw.endsWith("\n")`
    // produces — it would be counted as an extra empty "line".
    const all = raw.split("\n");
    if (all.length > 0 && all[all.length - 1] === "") all.pop();
    const total = all.length;
    const sliced = all.slice(Math.max(0, total - n));
    return { lines: sliced, total };
  } catch (err: any) {
    if (err?.code === "ENOENT") return { lines: [], total: 0 };
    throw err;
  }
}

function parseAuditLines(lines: string[]): unknown[] {
  const out: unknown[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Preserve malformed lines so the bug reporter can see them.
      out.push({ __unparsed: trimmed });
    }
  }
  return out;
}

export async function buildLogsExport(): Promise<LogsExportBundle> {
  const [audit, crash, version, configRaw] = await Promise.all([
    tailLines(auditLogPath, AUDIT_TAIL),
    tailLines(crashLogPath, CRASH_TAIL),
    versionSummary(),
    readFile(configPath(), "utf8").catch((err: any) => {
      if (err?.code === "ENOENT") return "";
      throw err;
    }),
  ]);

  let cfgParsed: unknown = {};
  if (configRaw) {
    try {
      cfgParsed = JSON.parse(configRaw);
    } catch {
      // Keep the raw text under a stub key so the user can still see it
      // was present even if corrupt — redaction still applies to nested
      // parseable structures, but here we just mark it unparseable.
      cfgParsed = { __unparsed: "[config.json not valid JSON]" };
    }
  }

  return {
    v: 1,
    exportedAt: Date.now(),
    version,
    audit: {
      path: auditLogPath,
      lineCount: audit.total,
      entries: parseAuditLines(audit.lines),
    },
    crashes: {
      path: crashLogPath,
      lineCount: crash.total,
      lines: crash.lines,
    },
    config: {
      path: configPath(),
      redacted: redact(cfgParsed),
    },
  };
}
