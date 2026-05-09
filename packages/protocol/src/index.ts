import { z } from "zod";

export const PROTOCOL_VERSION = "rcc/1" as const;

export const PermissionMode = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "auto",
  "dontAsk",
]);
export type PermissionMode = z.infer<typeof PermissionMode>;

export const PERMISSION_MODES: readonly PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "auto",
  "dontAsk",
] as const;

export const PERMISSION_MODE_INFO: Record<
  PermissionMode,
  { label: string; description: string; tone: "safe" | "neutral" | "warn" | "danger" }
> = {
  default: {
    label: "Default",
    description: "每个操作都按规则 / 按需询问。最安全。",
    tone: "safe",
  },
  plan: {
    label: "Plan",
    description: "只读 + 展示计划。不会修改任何文件。",
    tone: "safe",
  },
  acceptEdits: {
    label: "Accept Edits",
    description: "文件编辑自动允许；其他高风险操作仍需确认。",
    tone: "neutral",
  },
  auto: {
    label: "Auto",
    description: "已配置规则允许的操作自动放行。",
    tone: "neutral",
  },
  dontAsk: {
    label: "Don't Ask",
    description: "不再弹出确认。谨慎使用。",
    tone: "warn",
  },
  bypassPermissions: {
    label: "Bypass Permissions",
    description: "绕过全部权限检查。仅用于沙盒。危险。",
    tone: "danger",
  },
};

const base = { v: z.literal(1).default(1) };

// [sdk-driver] Added in M6: which runtime is driving the session.
//   - "cli"  — node-pty spawns the `claude` binary and the host scrapes a
//              rendered terminal byte stream (legacy; still the default so
//              existing sessions parse without a driver field).
//   - "sdk"  — host calls @anthropic-ai/claude-agent-sdk `query()` directly
//              and consumes a structured event stream. No pty, no xterm.
export const SessionDriver = z.enum(["cli", "sdk"]);
export type SessionDriver = z.infer<typeof SessionDriver>;

// [summary] Added in M6 batch 9: AI-generated session summary. Stored in the
// persisted snapshot and surfaced inline on SessionMeta so sidebar rendering
// doesn't need a separate fetch. Old hosts/clients omit the field.
export const SessionSummary = z.object({
  title: z.string(),
  bullets: z.array(z.string()),
  updatedAt: z.number(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const SessionMeta = z.object({
  id: z.string(),
  cwd: z.string(),
  title: z.string().optional(),
  cols: z.number().int().positive().default(120),
  rows: z.number().int().positive().default(32),
  createdAt: z.number(),
  status: z.enum(["running", "exited"]).default("running"),
  permissionMode: PermissionMode.default("default"),
  /**
   * Added in M4 batch 3: the project this session belongs to. Optional so old
   * hosts/clients still parse; undefined means "default project" on the host.
   */
  projectId: z.string().optional(),
  /**
   * Added in M6: "cli" (pty) or "sdk" (agent sdk). Default "cli" so sessions
   * created by older hosts / sent without a driver hint still parse.
   */
  driver: SessionDriver.default("cli"),
  /**
   * Added in M6 batch 9: AI session summary. Optional for back-compat; generated
   * on session.exit or explicit summary.refresh.
   */
  summary: SessionSummary.optional(),
});
export type SessionMeta = z.infer<typeof SessionMeta>;

// [projects] — M4 batch 3
//
// Users can manage multiple workspaces, each with its own cwd. Sessions bind
// to a project at creation; new sessions inherit that project's cwd unless
// the client passes one. The host persists projects in ~/.rcc/config.json
// under the `projects` key and broadcasts `project.list` on every mutation
// so every connected device stays in sync.

export const PROJECT_COLORS = ["orange", "teal", "violet", "pink", "green"] as const;
export const ProjectColor = z.enum(PROJECT_COLORS);
export type ProjectColor = z.infer<typeof ProjectColor>;

export const ProjectMeta = z.object({
  id: z.string(),
  name: z.string(),
  cwd: z.string(),
  color: ProjectColor.optional(),
  isDefault: z.boolean().optional(),
});
export type ProjectMeta = z.infer<typeof ProjectMeta>;

export const ProjectListRequest = z.object({
  ...base,
  t: z.literal("project.list.request"),
});

export const ProjectList = z.object({
  ...base,
  t: z.literal("project.list"),
  projects: z.array(ProjectMeta),
});

export const ProjectAdd = z.object({
  ...base,
  t: z.literal("project.add"),
  name: z.string().min(1).max(64),
  cwd: z.string().min(1).max(1024),
  color: ProjectColor.optional(),
});

export const ProjectAdded = z.object({
  ...base,
  t: z.literal("project.added"),
  project: ProjectMeta,
});

export const ProjectRemove = z.object({
  ...base,
  t: z.literal("project.remove"),
  id: z.string(),
});

export const ProjectRemoved = z.object({
  ...base,
  t: z.literal("project.removed"),
  id: z.string(),
});

export const ProjectRename = z.object({
  ...base,
  t: z.literal("project.rename"),
  id: z.string(),
  name: z.string().min(1).max(64),
});

export const ProjectRenamed = z.object({
  ...base,
  t: z.literal("project.renamed"),
  project: ProjectMeta,
});

export const ProjectUpdate = z.object({
  ...base,
  t: z.literal("project.update"),
  id: z.string(),
  cwd: z.string().min(1).max(1024).optional(),
  color: ProjectColor.nullable().optional(),
});

export const ProjectUpdated = z.object({
  ...base,
  t: z.literal("project.updated"),
  project: ProjectMeta,
});

export const TunnelInfo = z.object({
  state: z.enum(["disabled", "starting", "ready", "error"]),
  url: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.number().nullable(),
  // [tunnel-config] named-tunnel metadata — optional so old hosts still parse.
  mode: z.enum(["try", "named"]).optional(),
  hostname: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
});
export type TunnelInfo = z.infer<typeof TunnelInfo>;

export const Hello = z.object({
  ...base,
  t: z.literal("hello"),
  protocol: z.literal(PROTOCOL_VERSION),
  sessions: z.array(SessionMeta),
  tunnel: TunnelInfo.optional(),
  /** The device this client is authenticated as, or null for loopback. */
  device: z
    .object({
      id: z.string(),
      name: z.string(),
      /**
       * Added in M5 batch 6: whether this device has a passkey registered. The
       * client uses this to decide whether high-risk approvals should take the
       * WebAuthn path.
       */
      hasPasskey: z.boolean().optional(),
    })
    .nullable()
    .optional(),
  /** Pinned slash command ids (scope:name) for the chat quick-button bar. */
  pinnedCommands: z.array(z.string()).optional(),
  /** Added in M4 batch 3: known projects (workspaces). Optional for old hosts. */
  projects: z.array(ProjectMeta).optional(),
  /**
   * Added in M6 batch 9: when this ws connection is a share-token readonly
   * guest, the host sets this to true and scopes `sessions` to the single
   * shared sid. The client uses it to hide all mutation UI.
   */
  sharedReadonly: z.boolean().optional(),
  /** The sid the guest is pinned to when sharedReadonly is true. */
  sharedSid: z.string().optional(),
  /** Expiry timestamp (ms) of the active share token, for countdown UI. */
  sharedExpiresAt: z.number().optional(),
});

export const SessionNew = z.object({
  ...base,
  t: z.literal("session.new"),
  cwd: z.string().optional(),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  permissionMode: PermissionMode.optional(),
  /** Added in M4 batch 3: which project this session belongs to. */
  projectId: z.string().optional(),
  /**
   * Added in M6: pick the runtime. Defaults to "cli" host-side when omitted so
   * legacy clients keep spawning pty-backed sessions.
   */
  driver: SessionDriver.optional(),
});

export const SessionCreated = z.object({
  ...base,
  t: z.literal("session.created"),
  session: SessionMeta,
});

export const SessionList = z.object({
  ...base,
  t: z.literal("session.list"),
  sessions: z.array(SessionMeta),
});

export const SessionAttach = z.object({
  ...base,
  t: z.literal("session.attach"),
  sid: z.string(),
  /** last-seen seq; omit or pass null to receive full replay */
  since: z.number().int().nonnegative().nullish(),
});

export const SessionClose = z.object({
  ...base,
  t: z.literal("session.close"),
  sid: z.string(),
});

export const SessionExited = z.object({
  ...base,
  t: z.literal("session.exited"),
  sid: z.string(),
  code: z.number().int().nullable(),
});

// [persistence] Added in M6 batch 8: resume an archived (status:"exited")
// session — the host reopens a pty / SDK query using the stored meta and keeps
// the same id so chat/ringTail continuity is preserved on every client.
export const SessionResume = z.object({
  ...base,
  t: z.literal("session.resume"),
  sid: z.string(),
});

export const SessionResumed = z.object({
  ...base,
  t: z.literal("session.resumed"),
  session: SessionMeta,
});

export const PtyIn = z.object({
  ...base,
  t: z.literal("pty.in"),
  sid: z.string(),
  data: z.string(),
});

export const PtyOut = z.object({
  ...base,
  t: z.literal("pty.out"),
  sid: z.string(),
  seq: z.number().int().nonnegative(),
  data: z.string(),
});

export const PtyResize = z.object({
  ...base,
  t: z.literal("pty.resize"),
  sid: z.string(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export const Ping = z.object({ ...base, t: z.literal("ping"), ts: z.number() });
export const Pong = z.object({ ...base, t: z.literal("pong"), ts: z.number() });

export const Error_ = z.object({
  ...base,
  t: z.literal("error"),
  code: z.string(),
  message: z.string(),
  sid: z.string().optional(),
});

export const TunnelStatus = z.object({
  ...base,
  t: z.literal("tunnel.status"),
  tunnel: TunnelInfo,
});

export const DeviceSummary = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  userAgent: z.string().nullable(),
  current: z.boolean().default(false),
});
export type DeviceSummary = z.infer<typeof DeviceSummary>;

export const DeviceList = z.object({
  ...base,
  t: z.literal("device.list"),
  devices: z.array(DeviceSummary),
});

export const DeviceListRequest = z.object({
  ...base,
  t: z.literal("device.list.request"),
});

export const DeviceRevoke = z.object({
  ...base,
  t: z.literal("device.revoke"),
  deviceId: z.string(),
});

export const DeviceRename = z.object({
  ...base,
  t: z.literal("device.rename"),
  deviceId: z.string(),
  name: z.string().min(1).max(64),
});

// ─── config feature frames ────────────────────────────────────────────────
// Each config agent (Skills / MCP / Slash / Subagents / Hooks) appends its
// frames below as a self-contained block. Keep within-block additions
// alphabetical so merges are predictable.

// [skills] — filled by M4A

export const SkillScope = z.enum(["user", "project"]);
export type SkillScope = z.infer<typeof SkillScope>;

export const SkillSummary = z.object({
  id: z.string(),
  name: z.string(),
  scope: SkillScope,
  dir: z.string(),
  displayPath: z.string(),
  description: z.string().default(""),
  tags: z.array(z.string()).default([]),
  enabled: z.boolean(),
  version: z.string().optional(),
});
export type SkillSummary = z.infer<typeof SkillSummary>;

export const SkillListRequest = z.object({
  ...base,
  t: z.literal("skill.list.request"),
});

export const SkillList = z.object({
  ...base,
  t: z.literal("skill.list"),
  skills: z.array(SkillSummary),
});

export const SkillToggle = z.object({
  ...base,
  t: z.literal("skill.toggle"),
  id: z.string(),
  enabled: z.boolean(),
});

export const SkillReadRequest = z.object({
  ...base,
  t: z.literal("skill.read.request"),
  id: z.string(),
});

export const SkillRead = z.object({
  ...base,
  t: z.literal("skill.read"),
  id: z.string(),
  content: z.string(),
});

export const SkillSave = z.object({
  ...base,
  t: z.literal("skill.save"),
  scope: SkillScope,
  name: z.string().min(1).max(128),
  description: z.string().default(""),
  body: z.string().default(""),
  tags: z.array(z.string()).optional(),
});

export const SkillDelete = z.object({
  ...base,
  t: z.literal("skill.delete"),
  id: z.string(),
});

export const SkillDeleted = z.object({
  ...base,
  t: z.literal("skill.deleted"),
  id: z.string(),
});

// [mcp] — filled by M4B

export const McpScope = z.enum(["local", "user", "project"]);
export type McpScope = z.infer<typeof McpScope>;

export const McpTransport = z.enum(["stdio", "sse", "http"]);
export type McpTransport = z.infer<typeof McpTransport>;

export const McpStatus = z.enum(["ready", "failed", "disabled", "unknown"]);
export type McpStatus = z.infer<typeof McpStatus>;

export const McpServerSummary = z.object({
  name: z.string(),
  transport: McpTransport,
  scope: McpScope,
  status: McpStatus,
  commandOrUrl: z.string(),
  disabled: z.boolean(),
  statusMessage: z.string().optional(),
  toolCount: z.number().int().nonnegative().optional(),
});
export type McpServerSummary = z.infer<typeof McpServerSummary>;

export const McpEnvPair = z.object({
  key: z.string(),
  value: z.string(),
  isSecret: z.boolean(),
  length: z.number().int().nonnegative(),
});
export type McpEnvPair = z.infer<typeof McpEnvPair>;

export const McpServerDetail = McpServerSummary.extend({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: z.array(McpEnvPair),
  rawStatus: z.string(),
});
export type McpServerDetail = z.infer<typeof McpServerDetail>;

export const McpListRequest = z.object({
  ...base,
  t: z.literal("mcp.list.request"),
});

export const McpList = z.object({
  ...base,
  t: z.literal("mcp.list"),
  servers: z.array(McpServerSummary),
});

export const McpGetRequest = z.object({
  ...base,
  t: z.literal("mcp.get.request"),
  name: z.string(),
});

export const McpGet = z.object({
  ...base,
  t: z.literal("mcp.get"),
  server: McpServerDetail.nullable(),
});

export const McpAdd = z.object({
  ...base,
  t: z.literal("mcp.add"),
  name: z.string(),
  transport: McpTransport,
  scope: McpScope,
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
});

export const McpAdded = z.object({
  ...base,
  t: z.literal("mcp.added"),
  server: McpServerSummary,
});

export const McpRemove = z.object({
  ...base,
  t: z.literal("mcp.remove"),
  name: z.string(),
  scope: McpScope.optional(),
});

export const McpRemoved = z.object({
  ...base,
  t: z.literal("mcp.removed"),
  name: z.string(),
});

export const McpToggle = z.object({
  ...base,
  t: z.literal("mcp.toggle"),
  name: z.string(),
  enabled: z.boolean(),
});


// [commands] — filled by M4C
export const CommandScope = z.enum(["builtin", "user", "project"]);
export type CommandScope = z.infer<typeof CommandScope>;

export const CommandSummary = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  scope: CommandScope,
  pinned: z.boolean(),
});
export type CommandSummary = z.infer<typeof CommandSummary>;

export const CmdListRequest = z.object({
  ...base,
  t: z.literal("cmd.list.request"),
});
export const CmdList = z.object({
  ...base,
  t: z.literal("cmd.list"),
  commands: z.array(CommandSummary),
});
export const CmdReadRequest = z.object({
  ...base,
  t: z.literal("cmd.read.request"),
  id: z.string(),
});
export const CmdRead = z.object({
  ...base,
  t: z.literal("cmd.read"),
  id: z.string(),
  content: z.string(),
  description: z.string(),
  scope: CommandScope,
});
export const CmdSave = z.object({
  ...base,
  t: z.literal("cmd.save"),
  scope: z.enum(["user", "project"]),
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  body: z.string(),
  originalId: z.string().optional(),
});
export const CmdSaved = z.object({
  ...base,
  t: z.literal("cmd.saved"),
  command: CommandSummary,
});
export const CmdDelete = z.object({
  ...base,
  t: z.literal("cmd.delete"),
  id: z.string(),
});
export const CmdDeleted = z.object({
  ...base,
  t: z.literal("cmd.deleted"),
  id: z.string(),
});
export const CmdPin = z.object({
  ...base,
  t: z.literal("cmd.pin"),
  id: z.string(),
  pinned: z.boolean(),
});
export const CmdReorderPinned = z.object({
  ...base,
  t: z.literal("cmd.reorder-pinned"),
  ids: z.array(z.string()),
});
export const CmdPinned = z.object({
  ...base,
  t: z.literal("cmd.pinned"),
  ids: z.array(z.string()),
});

// [subagents] — filled by M4C
export const SubagentScope = z.enum(["user", "project"]);
export type SubagentScope = z.infer<typeof SubagentScope>;

export const SubagentSummary = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  scope: SubagentScope,
  model: z.string().nullable(),
  tools: z.string().nullable(),
});
export type SubagentSummary = z.infer<typeof SubagentSummary>;

export const SubagentListRequest = z.object({
  ...base,
  t: z.literal("subagent.list.request"),
});
export const SubagentList = z.object({
  ...base,
  t: z.literal("subagent.list"),
  agents: z.array(SubagentSummary),
});
export const SubagentReadRequest = z.object({
  ...base,
  t: z.literal("subagent.read.request"),
  id: z.string(),
});
export const SubagentRead = z.object({
  ...base,
  t: z.literal("subagent.read"),
  id: z.string(),
  content: z.string(),
  meta: SubagentSummary,
});
export const SubagentSave = z.object({
  ...base,
  t: z.literal("subagent.save"),
  scope: SubagentScope,
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  model: z.string().max(64).optional(),
  tools: z.string().max(500).optional(),
  body: z.string(),
  originalId: z.string().optional(),
});
export const SubagentSaved = z.object({
  ...base,
  t: z.literal("subagent.saved"),
  agent: SubagentSummary,
});
export const SubagentDelete = z.object({
  ...base,
  t: z.literal("subagent.delete"),
  id: z.string(),
});
export const SubagentDeleted = z.object({
  ...base,
  t: z.literal("subagent.deleted"),
  id: z.string(),
});

// [hooks] — filled by M4 batch 2

export const HookScope = z.enum(["user", "project"]);
export type HookScope = z.infer<typeof HookScope>;

export const HookEventName = z.enum([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
]);
export type HookEventName = z.infer<typeof HookEventName>;

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

export const HookAction = z.object({
  type: z.literal("command"),
  command: z.string(),
  timeout: z.number().int().positive().optional(),
  truncated: z.boolean().optional(),
});
export type HookAction = z.infer<typeof HookAction>;

export const HookMatcher = z.object({
  matcher: z.string().optional(),
  hooks: z.array(HookAction),
});
export type HookMatcher = z.infer<typeof HookMatcher>;

export const HookConfig = z.object({
  scope: HookScope,
  event: HookEventName,
  index: z.number().int().nonnegative(),
  matcher: z.string().optional(),
  hooks: z.array(HookAction),
});
export type HookConfig = z.infer<typeof HookConfig>;

export const HookListRequest = z.object({
  ...base,
  t: z.literal("hook.list.request"),
  scope: z.enum(["user", "project", "all"]).optional(),
});

export const HookList = z.object({
  ...base,
  t: z.literal("hook.list"),
  configs: z.array(HookConfig),
});

export const HookWrite = z.object({
  ...base,
  t: z.literal("hook.write"),
  scope: HookScope,
  event: HookEventName,
  index: z.number().int(),
  matcher: z.string().optional(),
  hooks: z.array(HookAction),
});

export const HookWritten = z.object({
  ...base,
  t: z.literal("hook.written"),
  scope: HookScope,
  event: HookEventName,
});

export const HookDelete = z.object({
  ...base,
  t: z.literal("hook.delete"),
  scope: HookScope,
  event: HookEventName,
  index: z.number().int().nonnegative(),
});

export const HookDeleted = z.object({
  ...base,
  t: z.literal("hook.deleted"),
  scope: HookScope,
  event: HookEventName,
  index: z.number().int().nonnegative(),
});

export const HookTest = z.object({
  ...base,
  t: z.literal("hook.test"),
  scope: HookScope,
  event: HookEventName,
  index: z.number().int().nonnegative(),
  hookIndex: z.number().int().nonnegative().optional(),
});

export const HookTested = z.object({
  ...base,
  t: z.literal("hook.tested"),
  scope: HookScope,
  event: HookEventName,
  index: z.number().int().nonnegative(),
  ok: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
  truncated: z.boolean().optional(),
});

// [permissions] — filled by M4 batch 2

export const PermissionScope = z.enum(["user", "project", "local"]);
export type PermissionScope = z.infer<typeof PermissionScope>;

export const PermissionBucket = z.enum(["allow", "deny", "ask"]);
export type PermissionBucket = z.infer<typeof PermissionBucket>;

export const PermissionDefaultMode = z.enum([
  "default",
  "plan",
  "acceptEdits",
  "bypassPermissions",
]);
export type PermissionDefaultMode = z.infer<typeof PermissionDefaultMode>;

export const PermissionsConfig = z.object({
  scope: PermissionScope,
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
  ask: z.array(z.string()).default([]),
  defaultMode: PermissionDefaultMode.optional(),
  additionalDirectories: z.array(z.string()).default([]),
});
export type PermissionsConfig = z.infer<typeof PermissionsConfig>;

export const PermListRequest = z.object({
  ...base,
  t: z.literal("perm.list.request"),
});

export const PermList = z.object({
  ...base,
  t: z.literal("perm.list"),
  configs: z.array(PermissionsConfig),
});

export const PermAdd = z.object({
  ...base,
  t: z.literal("perm.add"),
  scope: PermissionScope,
  bucket: PermissionBucket,
  rule: z.string().min(1).max(1024),
});

export const PermAdded = z.object({
  ...base,
  t: z.literal("perm.added"),
  scope: PermissionScope,
  bucket: PermissionBucket,
  rule: z.string(),
});

export const PermRemove = z.object({
  ...base,
  t: z.literal("perm.remove"),
  scope: PermissionScope,
  bucket: PermissionBucket,
  rule: z.string(),
});

export const PermRemoved = z.object({
  ...base,
  t: z.literal("perm.removed"),
  scope: PermissionScope,
  bucket: PermissionBucket,
  rule: z.string(),
});

export const PermSetDefault = z.object({
  ...base,
  t: z.literal("perm.set-default"),
  scope: PermissionScope,
  mode: PermissionDefaultMode.nullable(),
});

export const PermDefaultSet = z.object({
  ...base,
  t: z.literal("perm.default-set"),
  scope: PermissionScope,
  mode: PermissionDefaultMode.nullable(),
});

export const PermAddDir = z.object({
  ...base,
  t: z.literal("perm.add-dir"),
  scope: PermissionScope,
  path: z.string().min(1).max(1024),
});

export const PermRemoveDir = z.object({
  ...base,
  t: z.literal("perm.remove-dir"),
  scope: PermissionScope,
  path: z.string(),
});

export const PermDirAck = z.object({
  ...base,
  t: z.literal("perm.dir-ack"),
  scope: PermissionScope,
  path: z.string(),
  action: z.enum(["added", "removed"]),
});

// [approvals] — filled by M3 batch 1
//
// Claude CLI asks `y/n` on stdin for some tool uses. The host scans pty.out
// for those prompts (heuristic regex + tool-name inference) and surfaces a
// structured request so clients can display a dedicated, mobile-friendly
// approval UI. The user's answer is echoed back into the pty's stdin.

export const ApprovalRisk = z.enum(["low", "medium", "high"]);
export type ApprovalRisk = z.infer<typeof ApprovalRisk>;

export const ApprovalRequest = z.object({
  ...base,
  t: z.literal("approval.request"),
  id: z.string(),
  sid: z.string(),
  tool: z.string(),
  risk: ApprovalRisk,
  summary: z.string(),
  raw: z.string(),
  timestamp: z.number(),
});

export const ApprovalResponse = z.object({
  ...base,
  t: z.literal("approval.response"),
  id: z.string(),
  sid: z.string(),
  approve: z.boolean(),
  /**
   * When the approval is gated on WebAuthn (high-risk + device has a passkey),
   * the client runs the WebAuthn assertion flow first and only sends this
   * response once the host has marked the gate open. `webauthnToken` echoes
   * the approval id as confirmation that assertion succeeded; the server-side
   * gate is keyed by approvalId.
   */
  webauthnToken: z.string().optional(),
});

export const ApprovalCleared = z.object({
  ...base,
  t: z.literal("approval.cleared"),
  id: z.string(),
  sid: z.string(),
});

// [push] — filled by M3 batch 2
//
// Web Push: host owns a VAPID keypair (generated on first boot, persisted in
// ~/.rcc/config.json with 0600), clients subscribe through the service worker
// pushManager and send the subscription up via `push.subscribe`. The host
// stores subs in ~/.rcc/push-subs.json and uses `web-push` to notify the
// browser (which then invokes the SW's `push` event → showNotification,
// which can wake the lock screen). The private VAPID key never leaves host.

export const PushPublicKeyRequest = z.object({
  ...base,
  t: z.literal("push.public-key.request"),
});

export const PushPublicKey = z.object({
  ...base,
  t: z.literal("push.public-key"),
  key: z.string(),
});

export const PushSubscribe = z.object({
  ...base,
  t: z.literal("push.subscribe"),
  endpoint: z.string(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
  deviceId: z.string().optional(),
});

export const PushSubscribed = z.object({
  ...base,
  t: z.literal("push.subscribed"),
  ok: z.boolean(),
});

export const PushUnsubscribe = z.object({
  ...base,
  t: z.literal("push.unsubscribe"),
  endpoint: z.string(),
});

export const PushUnsubscribed = z.object({
  ...base,
  t: z.literal("push.unsubscribed"),
});

export const PushTest = z.object({
  ...base,
  t: z.literal("push.test"),
});

// [messages] — filled by M3 batch 2
//
// Claude Code CLI emits a rendered terminal byte stream (ANSI colors, cursor
// control codes), not a structured event stream. To surface a "semantic chat"
// view without re-authoring the CLI, the host runs a heuristic parser over
// pty.out (see packages/host/src/chat-parser.ts) that strips ANSI, splits the
// tail of the recent output into paragraphs, and classifies each one into one
// of the segment kinds below. This is inherently lossy — tool invocations can
// be missed, diffs can be mistaken for code, and only the most recent ~256KB
// of output per session is retained. Clients must offer a fall-back to the
// raw xterm view. A structured stream via the Claude Agent SDK is a M5 goal.
//
// A ChatMessage is a coherent unit from one role (user / assistant / system).
// `segments` are ordered; rendering glues them bottom-up in the message card.

export const ChatSegmentText = z.object({
  kind: z.literal("text"),
  content: z.string(),
});
export const ChatSegmentCode = z.object({
  kind: z.literal("code"),
  lang: z.string().optional(),
  content: z.string(),
});
export const ChatSegmentDiff = z.object({
  kind: z.literal("diff"),
  path: z.string().optional(),
  content: z.string(),
});
export const ChatSegmentToolUse = z.object({
  kind: z.literal("tool_use"),
  tool: z.string(),
  input: z.string(),
  output: z.string().optional(),
  collapsed: z.boolean().default(true),
  /**
   * Added in M6: SDK-driver sets this so tool_result segments can be linked
   * back to the tool_use that spawned them. Absent for CLI-driver tool_use
   * segments (which don't carry an id through the pty stream).
   */
  toolUseId: z.string().optional(),
});
// [sdk-driver] Two new segment kinds backed by real SDK events.
// `thinking` wraps extended-thinking blocks; `tool_result` is paired to the
// tool_use segment via toolUseId so the UI can show output next to input.
export const ChatSegmentThinking = z.object({
  kind: z.literal("thinking"),
  content: z.string(),
});
export const ChatSegmentToolResult = z.object({
  kind: z.literal("tool_result"),
  toolUseId: z.string(),
  content: z.string(),
  isError: z.boolean().optional(),
});
export const ChatSegment = z.discriminatedUnion("kind", [
  ChatSegmentText,
  ChatSegmentCode,
  ChatSegmentDiff,
  ChatSegmentToolUse,
  ChatSegmentThinking,
  ChatSegmentToolResult,
]);
export type ChatSegment = z.infer<typeof ChatSegment>;

export const ChatMessage = z.object({
  id: z.string(),
  sid: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  segments: z.array(ChatSegment),
  timestamp: z.number(),
  /**
   * Added in M6: assistant messages are incrementally filled while the SDK
   * streams text_delta / content-block events. Flips to false (or omitted) on
   * the final `chat.append` once the message is complete. CLI driver never
   * sets this.
   */
  streaming: z.boolean().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatListRequest = z.object({
  ...base,
  t: z.literal("chat.list.request"),
  sid: z.string(),
});

export const ChatList = z.object({
  ...base,
  t: z.literal("chat.list"),
  sid: z.string(),
  messages: z.array(ChatMessage),
});

export const ChatAppend = z.object({
  ...base,
  t: z.literal("chat.append"),
  sid: z.string(),
  message: ChatMessage,
});

// [sdk-driver] Incremental segment patch for an already-appended streaming
// message. The SDK driver sends one `chat.append` with streaming:true when a
// new assistant message starts, then a flurry of `chat.update` frames as
// text_delta / content-block events arrive, then a final `chat.append`
// (streaming:false) with the completed message. Clients reconcile by looking
// up messageId and replacing segments[segmentIndex].
export const ChatUpdate = z.object({
  ...base,
  t: z.literal("chat.update"),
  sid: z.string(),
  messageId: z.string(),
  segmentIndex: z.number().int().nonnegative(),
  segment: ChatSegment,
});

export const ChatReset = z.object({
  ...base,
  t: z.literal("chat.reset"),
  sid: z.string(),
});

export const ChatResetted = z.object({
  ...base,
  t: z.literal("chat.resetted"),
  sid: z.string(),
});

// [files] — filled by M4 batch 2

export const FileEntry = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["file", "dir"]),
  size: z.number().int().nonnegative().optional(),
  mtime: z.number().optional(),
});
export type FileEntry = z.infer<typeof FileEntry>;

export const FsLsRequest = z.object({
  ...base,
  t: z.literal("fs.ls.request"),
  path: z.string(),
});

export const FsLs = z.object({
  ...base,
  t: z.literal("fs.ls"),
  path: z.string(),
  entries: z.array(FileEntry),
});

export const FsReadRequest = z.object({
  ...base,
  t: z.literal("fs.read.request"),
  path: z.string(),
});

export const FsRead = z.object({
  ...base,
  t: z.literal("fs.read"),
  path: z.string(),
  content: z.string(),
  size: z.number().int().nonnegative(),
  encoding: z.enum(["utf8", "base64"]),
  truncated: z.boolean().optional(),
});

export const FsStatRequest = z.object({
  ...base,
  t: z.literal("fs.stat.request"),
  path: z.string(),
});

export const FsStat = z.object({
  ...base,
  t: z.literal("fs.stat"),
  entry: FileEntry,
});

// [crdt] — filled by M4 batch 3
//
// Shared editing state (e.g. the chat input draft) lives in a Y.Doc on the
// client. The host is a dumb relay: it keeps a per-`sid:docId` ring of the
// last 200 update byte blobs so late joiners can fast-forward by replaying
// them. The host never loads yjs — it only forwards base64-encoded bytes.

export const CrdtUpdate = z.object({
  ...base,
  t: z.literal("crdt.update"),
  sid: z.string(),
  docId: z.string(),
  update: z.string(),
  origin: z.string().optional(),
});

export const CrdtSync = z.object({
  ...base,
  t: z.literal("crdt.sync"),
  sid: z.string(),
  docId: z.string(),
  state: z.string(),
});

export const CrdtSyncRequest = z.object({
  ...base,
  t: z.literal("crdt.sync.request"),
  sid: z.string(),
  docId: z.string(),
});

// [marketplace] — filled by M4 batch 3
//
// Manifest-driven catalog of Skills + MCP servers. The host fetches one or
// more JSON manifest URLs (configured in ~/.rcc/config.json → marketplace.
// manifestUrls), merges them with a hard-coded seed, caches for 1h, and
// serves the combined catalog. Install actions reuse `skills.ts` /
// `mcp.ts` writers; the host never downloads or runs arbitrary binaries —
// MCP manifest entries MUST use `npx | uvx | node | python | python3` as
// command or they are rejected during manifest parsing.

export const MarketScope = z.enum(["user", "project"]);
export type MarketScope = z.infer<typeof MarketScope>;

export const MarketSkillEntry = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  source: z.string(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
});
export type MarketSkillEntry = z.infer<typeof MarketSkillEntry>;

export const MarketMcpEntry = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  transport: McpTransport,
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  envHints: z.array(z.string()).optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type MarketMcpEntry = z.infer<typeof MarketMcpEntry>;

export const MarketSource = z.object({
  url: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type MarketSource = z.infer<typeof MarketSource>;

export const MarketCatalogRequest = z.object({
  ...base,
  t: z.literal("market.catalog.request"),
  force: z.boolean().optional(),
});

export const MarketCatalog = z.object({
  ...base,
  t: z.literal("market.catalog"),
  skills: z.array(MarketSkillEntry),
  mcps: z.array(MarketMcpEntry),
  sources: z.array(MarketSource),
  fetchedAt: z.number(),
});

export const MarketInstallSkill = z.object({
  ...base,
  t: z.literal("market.install.skill"),
  id: z.string(),
  scope: MarketScope,
});

export const MarketSkillInstalled = z.object({
  ...base,
  t: z.literal("market.skill.installed"),
  id: z.string(),
  ok: z.boolean(),
  installedName: z.string().optional(),
  error: z.string().optional(),
});

export const MarketInstallMcp = z.object({
  ...base,
  t: z.literal("market.install.mcp"),
  id: z.string(),
  scope: MarketScope,
  env: z.record(z.string(), z.string()).optional(),
});

export const MarketMcpInstalled = z.object({
  ...base,
  t: z.literal("market.mcp.installed"),
  id: z.string(),
  ok: z.boolean(),
  installedName: z.string().optional(),
  error: z.string().optional(),
});

// [ui-prefs] — per-user UI preferences (accent color / font scale / custom
// terminal key buttons / theme placeholder). Persisted server-side at
// ~/.rcc/ui-prefs.json and mirrored in localStorage. All connected clients
// share the same prefs for now; `prefs` frames broadcast after mutation.

export const UI_ACCENT_COLORS = [
  "orange",
  "cyan",
  "violet",
  "pink",
  "emerald",
] as const;
export const UiAccent = z.enum(UI_ACCENT_COLORS);
export type UiAccent = z.infer<typeof UiAccent>;

export const UiTheme = z.enum(["dark", "light", "system"]);
export type UiTheme = z.infer<typeof UiTheme>;

export const UiCustomKey = z.object({
  label: z.string().min(1).max(32),
  send: z.string().min(1).max(64),
  hint: z.string().max(120).optional(),
});
export type UiCustomKey = z.infer<typeof UiCustomKey>;

export const UiPrefs = z.object({
  accent: UiAccent.default("orange"),
  fontScale: z.number().min(0.8).max(1.4).default(1.0),
  customKeys: z.array(UiCustomKey).max(32).default([]),
  theme: UiTheme.default("dark"),
});
export type UiPrefs = z.infer<typeof UiPrefs>;

export const UiPrefsPartial = UiPrefs.partial();
export type UiPrefsPartial = z.infer<typeof UiPrefsPartial>;

export const PrefsRequest = z.object({
  ...base,
  t: z.literal("prefs.request"),
});

export const Prefs = z.object({
  ...base,
  t: z.literal("prefs"),
  prefs: UiPrefs,
});

export const PrefsUpdate = z.object({
  ...base,
  t: z.literal("prefs.update"),
  prefs: UiPrefsPartial,
});

export const PrefsUpdated = z.object({
  ...base,
  t: z.literal("prefs.updated"),
  prefs: UiPrefs,
});

// [health] — filled by M5 batch 6
//
// Host captures uncaughtException / unhandledRejection, writes JSONL to
// ~/.rcc/crashes.log, and broadcasts a one-shot `health.crash` frame so
// connected clients can toast the event. The host does NOT exit — this is
// purely a notification channel; users recover by restarting.

export const HealthCrash = z.object({
  ...base,
  t: z.literal("health.crash"),
  at: z.number(),
  message: z.string(),
  type: z.string().optional(),
});

// [metrics] — observability panel
//
// MetricsCollector on host keeps a 60-sample rolling window (1s resolution)
// of process / session / ws / pty stats plus monotonic counters (crashes,
// replay rejects, decrypt fails, auth fails). Clients opt in via
// `metrics.subscribe` and receive `metrics.tick` ~every 2s until
// `metrics.unsubscribe`. Same shape is served at `GET /metrics` for one-shot
// reads. Series arrays are exactly 60 entries (oldest → newest).

export const MetricsSnapshot = z.object({
  at: z.number(),
  uptimeSec: z.number(),
  process: z.object({
    rss: z.number(),
    heapUsed: z.number(),
    heapTotal: z.number(),
    external: z.number(),
    cpuPct: z.number(),
  }),
  rssSeries: z.array(z.number()),
  cpuSeries: z.array(z.number()),
  sessions: z.object({
    total: z.number(),
    running: z.number(),
    exited: z.number(),
    byDriver: z.object({ cli: z.number(), sdk: z.number() }),
  }),
  ws: z.object({
    connections: z.number(),
    subscribers: z.number(),
    bytesInPerSec: z.number(),
    bytesOutPerSec: z.number(),
    msgsInPerSec: z.number(),
    msgsOutPerSec: z.number(),
    bytesInSeries: z.array(z.number()),
    bytesOutSeries: z.array(z.number()),
  }),
  pty: z.object({
    bytesInPerSec: z.number(),
    bytesOutPerSec: z.number(),
  }),
  chat: z.object({
    msgsPerSec: z.number(),
  }),
  counters: z.object({
    crashes: z.number(),
    replayRejects: z.number(),
    decryptFails: z.number(),
    authFails: z.number(),
  }),
});
export type MetricsSnapshot = z.infer<typeof MetricsSnapshot>;

export const MetricsSubscribe = z.object({
  ...base,
  t: z.literal("metrics.subscribe"),
});

export const MetricsUnsubscribe = z.object({
  ...base,
  t: z.literal("metrics.unsubscribe"),
});

export const MetricsTick = z.object({
  ...base,
  t: z.literal("metrics.tick"),
  snapshot: MetricsSnapshot,
});

// [summary] — M6 batch 9: AI summary + cross-session search.
//
// SessionSummary is computed host-side (Anthropic Messages API when an apiKey
// is configured in ~/.rcc/config.json, heuristic fallback otherwise). The
// summary is cached on the session snapshot and broadcast so every client
// keeps its sidebar up to date.
//
// Cross-session search runs over an in-memory inverted index (token → sid
// set) built at boot from snapshot chat bodies and incrementally updated on
// chat.append. AND-match + hit-count ranking; 200-char excerpts.

export const SummaryRequest = z.object({
  ...base,
  t: z.literal("summary.request"),
  sid: z.string(),
});

export const SummaryRefresh = z.object({
  ...base,
  t: z.literal("summary.refresh"),
  sid: z.string(),
});

export const SummaryFrame = z.object({
  ...base,
  t: z.literal("summary"),
  sid: z.string(),
  summary: SessionSummary.nullable(),
});

export const SearchRequest = z.object({
  ...base,
  t: z.literal("search.request"),
  query: z.string().max(512),
});

export const SearchMatch = z.object({
  sid: z.string(),
  title: z.string(),
  score: z.number(),
  excerpts: z.array(z.string()),
});
export type SearchMatch = z.infer<typeof SearchMatch>;

export const SearchResult = z.object({
  ...base,
  t: z.literal("search.result"),
  query: z.string(),
  matches: z.array(SearchMatch),
});

// [shares] — M6 batch 9
//
// Session read-only sharing. A share token is a 32B random credential the
// host issues against an existing sid for a bounded TTL. Guests open
// `?share=<token>` and the client uses it (instead of a device token) to
// open a ws. The host stamps that connection readonly + pinned to the sid
// and filters all outbound frames. The token is hashed (sha256) in
// `~/.rcc/shares.json`; the plaintext only ever appears in the URL.

export const ShareSummary = z.object({
  id: z.string(),
  sid: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  createdBy: z.string().nullable(),
  revoked: z.boolean(),
});
export type ShareSummary = z.infer<typeof ShareSummary>;

export const ShareListRequest = z.object({
  ...base,
  t: z.literal("share.list.request"),
  sid: z.string().optional(),
});

export const ShareList = z.object({
  ...base,
  t: z.literal("share.list"),
  shares: z.array(ShareSummary),
});

// [git] — per-session git integration
//
// The host runs `git -C <session.cwd> ...` every 5s per session to publish
// branch / dirty / HEAD state. On HEAD change between polls, it surfaces the
// new commits inline as a system chat message ("✓ N commits"). The client
// can also request a one-shot read-only `git.exec` (status / diff / log /
// branch / blame / show) without going through the Claude pty — the result
// lands in chat as a code segment. Write operations (commit/push/…) are
// intentionally excluded; users still have the terminal for those.

export const GitStatusData = z.object({
  branch: z.string().nullable(),
  dirty: z.boolean(),
  ahead: z.number().int().nonnegative().optional(),
  behind: z.number().int().nonnegative().optional(),
  head: z.string().optional(),
});
export type GitStatusData = z.infer<typeof GitStatusData>;

export const GitCommitInfo = z.object({
  hash: z.string(),
  subject: z.string(),
  author: z.string(),
});
export type GitCommitInfo = z.infer<typeof GitCommitInfo>;

export const GitStatusRequest = z.object({
  ...base,
  t: z.literal("git.status.request"),
  sid: z.string(),
});

export const GitStatusFrame = z.object({
  ...base,
  t: z.literal("git.status"),
  sid: z.string(),
  status: GitStatusData.nullable(),
});

export const GitCommitsFrame = z.object({
  ...base,
  t: z.literal("git.commits"),
  sid: z.string(),
  commits: z.array(GitCommitInfo),
});

export const GitExecRequest = z.object({
  ...base,
  t: z.literal("git.exec.request"),
  sid: z.string(),
  args: z.array(z.string().max(512)).min(1).max(16),
});

export const GitExecResult = z.object({
  ...base,
  t: z.literal("git.exec.result"),
  sid: z.string(),
  args: z.array(z.string()),
  ok: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  code: z.number().int().nullable(),
});


// [activity] — M6 batch 10
//
// Host-side rolling feed of cross-session events (approvals / commits /
// crashes / update.available / session_exit). Populated by the existing emit
// sites (ApprovalWatcher, crash.ts, GitWatcher, version.ts, session.onExit)
// with a single `activity.append` call; not persisted across host restarts.
// Capped at 200 items, LRU shift on overflow. Clients pull the backlog once
// via `activity.list.request` and then consume `activity.append` live.

export const ActivityApproval = z.object({
  kind: z.literal("approval"),
  id: z.string(),
  sid: z.string(),
  risk: ApprovalRisk,
  tool: z.string(),
  summary: z.string(),
  timestamp: z.number(),
  status: z.enum(["pending", "resolved"]),
});
export const ActivityCommits = z.object({
  kind: z.literal("commits"),
  id: z.string(),
  sid: z.string(),
  count: z.number().int().nonnegative(),
  subjects: z.array(z.string()),
  timestamp: z.number(),
});
export const ActivityCrash = z.object({
  kind: z.literal("crash"),
  id: z.string(),
  at: z.number(),
  message: z.string(),
  type: z.string().optional(),
});
export const ActivityUpdate = z.object({
  kind: z.literal("update"),
  id: z.string(),
  latest: z.string(),
  notes: z.string().optional(),
  timestamp: z.number(),
});
export const ActivitySessionExit = z.object({
  kind: z.literal("session_exit"),
  id: z.string(),
  sid: z.string(),
  title: z.string(),
  timestamp: z.number(),
});
export const ActivityItem = z.discriminatedUnion("kind", [
  ActivityApproval,
  ActivityCommits,
  ActivityCrash,
  ActivityUpdate,
  ActivitySessionExit,
]);
export type ActivityItem = z.infer<typeof ActivityItem>;

export const ActivityListRequest = z.object({
  ...base,
  t: z.literal("activity.list.request"),
});
export const ActivityList = z.object({
  ...base,
  t: z.literal("activity.list"),
  items: z.array(ActivityItem),
});
export const ActivityAppend = z.object({
  ...base,
  t: z.literal("activity.append"),
  item: ActivityItem,
});

// [recording] — M6 batch 10: asciinema-format session recording + playback.
//
// A Recorder owns an append-only `~/.rcc/recordings/<sid>.cast` file in
// asciinema v2 format (header JSON line + `[t, "o", data]` JSONL). Start is
// per-session opt-in from the client; the host also auto-stops on 50MB cap or
// pty exit. The cast file itself is fetched over HTTP (authenticated) rather
// than streamed through ws — keeps ws small and lets the browser cache.

export const RecordingStatusData = z.object({
  sid: z.string(),
  recording: z.boolean(),
  size: z.number().int().nonnegative(),
  startedAt: z.number().nullable(),
  hasFile: z.boolean(),
  capped: z.boolean(),
});
export type RecordingStatusData = z.infer<typeof RecordingStatusData>;

export const RecordStart = z.object({
  ...base,
  t: z.literal("record.start"),
  sid: z.string(),
});

export const RecordStop = z.object({
  ...base,
  t: z.literal("record.stop"),
  sid: z.string(),
});

export const RecordStatusRequest = z.object({
  ...base,
  t: z.literal("record.status.request"),
  sid: z.string(),
});

export const RecordStatus = z.object({
  ...base,
  t: z.literal("record.status"),
  status: RecordingStatusData,
});

// ──────────────────────────────────────────────────────────────────────────

export const Frame = z.discriminatedUnion("t", [
  Hello,
  SessionNew,
  SessionCreated,
  SessionList,
  SessionAttach,
  SessionClose,
  SessionExited,
  SessionResume,
  SessionResumed,
  PtyIn,
  PtyOut,
  PtyResize,
  Ping,
  Pong,
  Error_,
  TunnelStatus,
  DeviceList,
  DeviceListRequest,
  DeviceRevoke,
  DeviceRename,
  ProjectListRequest,
  ProjectList,
  ProjectAdd,
  ProjectAdded,
  ProjectRemove,
  ProjectRemoved,
  ProjectRename,
  ProjectRenamed,
  ProjectUpdate,
  ProjectUpdated,
  // [config-frames] — each config agent adds its frames after this marker
  SkillListRequest,
  SkillList,
  SkillToggle,
  SkillReadRequest,
  SkillRead,
  SkillSave,
  SkillDelete,
  SkillDeleted,
  McpListRequest,
  McpList,
  McpGetRequest,
  McpGet,
  McpAdd,
  McpAdded,
  McpRemove,
  McpRemoved,
  McpToggle,
  CmdListRequest,
  CmdList,
  CmdReadRequest,
  CmdRead,
  CmdSave,
  CmdSaved,
  CmdDelete,
  CmdDeleted,
  CmdPin,
  CmdReorderPinned,
  CmdPinned,
  SubagentListRequest,
  SubagentList,
  SubagentReadRequest,
  SubagentRead,
  SubagentSave,
  SubagentSaved,
  SubagentDelete,
  SubagentDeleted,
  HookListRequest,
  HookList,
  HookWrite,
  HookWritten,
  HookDelete,
  HookDeleted,
  HookTest,
  HookTested,
  PermListRequest,
  PermList,
  PermAdd,
  PermAdded,
  PermRemove,
  PermRemoved,
  PermSetDefault,
  PermDefaultSet,
  PermAddDir,
  PermRemoveDir,
  PermDirAck,
  FsLsRequest,
  FsLs,
  FsReadRequest,
  FsRead,
  FsStatRequest,
  FsStat,
  ApprovalRequest,
  ApprovalResponse,
  ApprovalCleared,
  ChatListRequest,
  ChatList,
  ChatAppend,
  ChatUpdate,
  ChatReset,
  ChatResetted,
  PushPublicKeyRequest,
  PushPublicKey,
  PushSubscribe,
  PushSubscribed,
  PushUnsubscribe,
  PushUnsubscribed,
  PushTest,
  CrdtUpdate,
  CrdtSync,
  CrdtSyncRequest,
  MarketCatalogRequest,
  MarketCatalog,
  MarketInstallSkill,
  MarketSkillInstalled,
  MarketInstallMcp,
  MarketMcpInstalled,
  HealthCrash,
  PrefsRequest,
  Prefs,
  PrefsUpdate,
  PrefsUpdated,
  MetricsSubscribe,
  MetricsUnsubscribe,
  MetricsTick,
  SummaryRequest,
  SummaryRefresh,
  SummaryFrame,
  SearchRequest,
  SearchResult,
  ShareListRequest,
  ShareList,
  GitStatusRequest,
  GitStatusFrame,
  GitCommitsFrame,
  GitExecRequest,
  GitExecResult,
  ActivityListRequest,
  ActivityList,
  ActivityAppend,
  RecordStart,
  RecordStop,
  RecordStatusRequest,
  RecordStatus,
]);
export type Frame = z.infer<typeof Frame>;

export type FrameByT<T extends Frame["t"]> = Extract<Frame, { t: T }>;

export function encode(frame: Frame): string {
  return JSON.stringify(frame);
}

export function decode(raw: string | ArrayBuffer | Uint8Array): Frame {
  let text: string;
  if (typeof raw === "string") text = raw;
  else if (raw instanceof Uint8Array) text = new TextDecoder().decode(raw);
  else text = new TextDecoder().decode(new Uint8Array(raw));
  const obj = JSON.parse(text);
  return Frame.parse(obj);
}

export function tryDecode(raw: string | ArrayBuffer | Uint8Array): Frame | null {
  try {
    return decode(raw);
  } catch {
    return null;
  }
}
