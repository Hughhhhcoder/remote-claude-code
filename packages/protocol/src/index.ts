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

export const SessionMeta = z.object({
  id: z.string(),
  cwd: z.string(),
  title: z.string().optional(),
  cols: z.number().int().positive().default(120),
  rows: z.number().int().positive().default(32),
  createdAt: z.number(),
  status: z.enum(["running", "exited"]).default("running"),
  permissionMode: PermissionMode.default("default"),
});
export type SessionMeta = z.infer<typeof SessionMeta>;

export const TunnelInfo = z.object({
  state: z.enum(["disabled", "starting", "ready", "error"]),
  url: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.number().nullable(),
});
export type TunnelInfo = z.infer<typeof TunnelInfo>;

const base = { v: z.literal(1).default(1) };

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
    })
    .nullable()
    .optional(),
  /** Pinned slash command ids (scope:name) for the chat quick-button bar. */
  pinnedCommands: z.array(z.string()).optional(),
});

export const SessionNew = z.object({
  ...base,
  t: z.literal("session.new"),
  cwd: z.string().optional(),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  permissionMode: PermissionMode.optional(),
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

// ──────────────────────────────────────────────────────────────────────────

export const Frame = z.discriminatedUnion("t", [
  Hello,
  SessionNew,
  SessionCreated,
  SessionList,
  SessionAttach,
  SessionClose,
  SessionExited,
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
