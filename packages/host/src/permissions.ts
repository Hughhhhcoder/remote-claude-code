import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type PermissionScope = "user" | "project" | "local";
export type PermissionBucket = "allow" | "deny" | "ask";
export type PermissionDefaultMode =
  | "default"
  | "plan"
  | "acceptEdits"
  | "bypassPermissions";

export interface PermissionsConfig {
  scope: PermissionScope;
  allow: string[];
  deny: string[];
  ask: string[];
  defaultMode?: PermissionDefaultMode;
  additionalDirectories: string[];
}

interface PermissionsBlock {
  allow?: unknown;
  deny?: unknown;
  ask?: unknown;
  defaultMode?: unknown;
  additionalDirectories?: unknown;
  disableBypassPermissionsMode?: unknown;
  [k: string]: unknown;
}

interface SettingsFile {
  permissions?: PermissionsBlock;
  [k: string]: unknown;
}

const MAX_RULE_LEN = 1024;
const DEFAULT_MODES: readonly PermissionDefaultMode[] = [
  "default",
  "plan",
  "acceptEdits",
  "bypassPermissions",
];

function settingsPath(scope: PermissionScope, projectCwd: string): string {
  if (scope === "user") return join(homedir(), ".claude", "settings.json");
  if (scope === "project") return join(projectCwd, ".claude", "settings.json");
  return join(projectCwd, ".claude", "settings.local.json");
}

async function readSettings(path: string): Promise<SettingsFile> {
  try {
    const raw = await readFile(path, "utf8");
    if (!raw.trim()) return {};
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return obj as SettingsFile;
    }
    return {};
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") return {};
    throw err;
  }
}

async function writeSettings(path: string, settings: SettingsFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const text = JSON.stringify(settings, null, 2) + "\n";
  await writeFile(path, text, "utf8");
}

function toStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter((v): v is string => typeof v === "string");
}

function parseDefaultMode(x: unknown): PermissionDefaultMode | undefined {
  if (typeof x !== "string") return undefined;
  return (DEFAULT_MODES as readonly string[]).includes(x)
    ? (x as PermissionDefaultMode)
    : undefined;
}

function parseConfig(scope: PermissionScope, file: SettingsFile): PermissionsConfig {
  const perms = (file.permissions ?? {}) as PermissionsBlock;
  return {
    scope,
    allow: toStringArray(perms.allow),
    deny: toStringArray(perms.deny),
    ask: toStringArray(perms.ask),
    defaultMode: parseDefaultMode(perms.defaultMode),
    additionalDirectories: toStringArray(perms.additionalDirectories),
  };
}

export async function listPermissions(projectCwd: string): Promise<PermissionsConfig[]> {
  const scopes: PermissionScope[] = ["user", "project", "local"];
  const out: PermissionsConfig[] = [];
  for (const scope of scopes) {
    const file = await readSettings(settingsPath(scope, projectCwd));
    out.push(parseConfig(scope, file));
  }
  return out;
}

function validateRule(rule: string): string {
  const trimmed = rule.trim();
  if (!trimmed) throw new Error("empty rule");
  if (trimmed.length > MAX_RULE_LEN) throw new Error("rule too long");
  if (/[\n\r]/.test(trimmed)) throw new Error("rule must not contain newlines");
  return trimmed;
}

async function mutate(
  scope: PermissionScope,
  projectCwd: string,
  fn: (perms: PermissionsBlock) => void,
): Promise<void> {
  const path = settingsPath(scope, projectCwd);
  const file = await readSettings(path);
  const perms: PermissionsBlock = (file.permissions ?? {}) as PermissionsBlock;
  fn(perms);
  file.permissions = perms;
  await writeSettings(path, file);
}

export async function addRule(
  scope: PermissionScope,
  bucket: PermissionBucket,
  rule: string,
  projectCwd: string,
): Promise<string> {
  const clean = validateRule(rule);
  await mutate(scope, projectCwd, (perms) => {
    const list = toStringArray(perms[bucket]);
    if (!list.includes(clean)) list.push(clean);
    perms[bucket] = list;
  });
  return clean;
}

export async function removeRule(
  scope: PermissionScope,
  bucket: PermissionBucket,
  rule: string,
  projectCwd: string,
): Promise<void> {
  await mutate(scope, projectCwd, (perms) => {
    const list = toStringArray(perms[bucket]).filter((r) => r !== rule);
    perms[bucket] = list;
  });
}

export async function setDefaultMode(
  scope: PermissionScope,
  mode: PermissionDefaultMode | null,
  projectCwd: string,
): Promise<void> {
  if (scope === "local") {
    throw new Error("defaultMode is not configurable for local scope");
  }
  await mutate(scope, projectCwd, (perms) => {
    if (mode === null) {
      delete perms.defaultMode;
    } else {
      perms.defaultMode = mode;
    }
  });
}

function expandUser(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

export async function addDir(
  scope: PermissionScope,
  path: string,
  projectCwd: string,
): Promise<string> {
  const clean = validateRule(path);
  const expanded = expandUser(clean);
  await mutate(scope, projectCwd, (perms) => {
    const list = toStringArray(perms.additionalDirectories);
    if (!list.includes(expanded)) list.push(expanded);
    perms.additionalDirectories = list;
  });
  return expanded;
}

export async function removeDir(
  scope: PermissionScope,
  path: string,
  projectCwd: string,
): Promise<void> {
  await mutate(scope, projectCwd, (perms) => {
    const list = toStringArray(perms.additionalDirectories).filter((r) => r !== path);
    perms.additionalDirectories = list;
  });
}
