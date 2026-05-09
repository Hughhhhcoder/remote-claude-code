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

// [mcp] — filled by M4B

// [commands] — filled by M4C

// [subagents] — filled by M4C

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
