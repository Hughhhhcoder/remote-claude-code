import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  type Frame,
  type PermissionMode,
  type TunnelInfo,
  tryDecode,
  encode,
  PROTOCOL_VERSION,
  PermissionMode as PermissionModeSchema,
} from "@rcc/protocol";
import { SessionRegistry, type Session } from "./session.ts";
import { startTunnel, type Tunnel } from "./tunnel.ts";
import { loadConfig, resolveTunnelConfig } from "./config.ts";
import { TrustStore, PairingCodes, type PairedDevice } from "./trust.ts";
import { handlePairRoute } from "./pair.ts";
import { listMcp, getMcp, addMcp, removeMcp, setMcpEnabled } from "./mcp.ts";
import {
  listSkills,
  toggleSkill,
  readSkillContent,
  writeSkill,
  deleteSkill,
} from "./skills.ts";
import {
  listCommands,
  readCommand,
  saveCommand,
  deleteCommand,
  pinCommand,
  reorderPinned,
  loadPinned,
} from "./commands.ts";
import {
  listSubagents,
  readSubagent,
  saveSubagent,
  deleteSubagent,
} from "./subagents.ts";
import {
  listPermissions,
  addRule as permAddRule,
  removeRule as permRemoveRule,
  setDefaultMode as permSetDefaultMode,
  addDir as permAddDir,
  removeDir as permRemoveDir,
} from "./permissions.ts";
import { listHooks, writeHook, deleteHook, testHook } from "./hooks.ts";
import { ls as fsLs, read as fsRead, statEntry as fsStat } from "./fs.ts";
import { ApprovalWatcher } from "./approvals.ts";
import { PushService, type PushPayload } from "./push.ts";

interface WsState {
  attached: Set<string>;
  unsubs: Map<string, () => void>;
  device: PairedDevice | null;
}

const CLAUDE_COMMAND = process.env.RCC_CLAUDE_CMD ?? "claude";
const CLAUDE_ARGS = (process.env.RCC_CLAUDE_ARGS ?? "").split(" ").filter(Boolean);
const PORT = Number(process.env.RCC_PORT ?? 7777);
const DEFAULT_CWD = process.env.RCC_CWD ?? process.cwd();
const RCC_CONFIG = await loadConfig();
const TUNNEL_CONFIG = resolveTunnelConfig(RCC_CONFIG, process.env);

// Auth: every non-loopback connection must present a device token obtained
// via the pairing flow. Set RCC_TRUST_LOOPBACK=0 to also require auth on
// localhost connections (useful if someone on the same machine should not
// have implicit access).
const TRUST_LOOPBACK = process.env.RCC_TRUST_LOOPBACK !== "0";

// Web bundle: if `@rcc/web` has been built (`pnpm -F @rcc/web build`), the
// host will serve its dist/ directly so a single public URL ships both the
// UI and the websocket.
const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_DIST = resolve(HERE, "..", "..", "web", "dist");
const SERVE_WEB = existsSync(join(WEB_DIST, "index.html"));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

async function serveStatic(urlPath: string): Promise<{ body: Buffer; headers: Record<string, string> } | null> {
  if (!SERVE_WEB) return null;
  const clean = decodeURIComponent(urlPath.split("?")[0]!);
  let rel = clean === "/" ? "/index.html" : clean;
  // prevent escape
  rel = normalize(rel);
  if (rel.includes("..")) return null;
  let filePath = join(WEB_DIST, rel);
  try {
    const st = await stat(filePath);
    if (st.isDirectory()) filePath = join(filePath, "index.html");
  } catch {
    // fallthrough to SPA
    filePath = join(WEB_DIST, "index.html");
  }
  try {
    const body = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    return {
      body,
      headers: {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600",
      },
    };
  } catch {
    return null;
  }
}
const DEFAULT_PERMISSION_MODE: PermissionMode = (() => {
  const raw = process.env.RCC_PERMISSION_MODE;
  if (!raw) return "default";
  const parsed = PermissionModeSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`[rcc-host] invalid RCC_PERMISSION_MODE="${raw}", falling back to default`);
    return "default";
  }
  return parsed.data;
})();

const trust = await TrustStore.load();
const codes = new PairingCodes();
const push = await PushService.load();

function isLoopback(req: { socket: { remoteAddress?: string | undefined } }): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1" ||
    addr.startsWith("fe80::")
  );
}

function tokenFromReq(req: { url?: string; headers: { [key: string]: any } }): string | null {
  // 1. Authorization: Bearer <token>
  const auth = req.headers["authorization"] as string | undefined;
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  // 2. ?token=<token> (useful for WS from browser which can't set headers)
  if (req.url) {
    const qIdx = req.url.indexOf("?");
    if (qIdx >= 0) {
      const params = new URLSearchParams(req.url.slice(qIdx + 1));
      const t = params.get("token");
      if (t) return t;
    }
  }
  return null;
}

function authenticate(req: { url?: string; headers: { [key: string]: any }; socket: { remoteAddress?: string | undefined } }): {
  ok: true;
  device: PairedDevice | null;
} | {
  ok: false;
  reason: string;
} {
  const token = tokenFromReq(req);
  if (token) {
    const device = trust.authenticate(token);
    if (device) {
      trust.touch(device.id).catch(() => {});
      return { ok: true, device };
    }
    return { ok: false, reason: "invalid_token" };
  }
  if (TRUST_LOOPBACK && isLoopback(req)) {
    return { ok: true, device: null };
  }
  return { ok: false, reason: "auth_required" };
}

const registry = new SessionRegistry();

// Approval watchers: one per session. Scan pty.out for Claude CLI y/n prompts
// and surface structured `approval.request` frames to all clients. The actual
// `broadcast()` function is defined further down; we route through a shim that
// captures the `wss` reference in its closure so watchers can be created
// before the ws server exists.
const approvalWatchers = new Map<string, ApprovalWatcher>();

function broadcastApproval(frame: Frame): void {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    try {
      client.send(encode(frame));
    } catch {
      // ignore
    }
  }
  // Side-effect: kick a Web Push on high-risk approval requests so users get
  // a lock-screen nudge. Low/medium pass silently to avoid notification
  // fatigue — the in-app approval sheet handles those.
  if (frame.t === "approval.request" && frame.risk === "high") {
    const title = "⚠ 高风险审批";
    const body = `${frame.tool} · ${frame.summary}`.slice(0, 240);
    void push.broadcast("all", {
      title,
      body,
      tag: `approval-${frame.id}`,
      data: { sid: frame.sid, id: frame.id, kind: "approval" },
      requireInteraction: true,
    });
  }
}

function attachApprovalWatcher(session: Session): void {
  const watcher = new ApprovalWatcher(session, broadcastApproval);
  approvalWatchers.set(session.id, watcher);
  const unsub = session.subscribe((chunk) => watcher.feed(chunk.data));
  session.onExit((code) => {
    unsub();
    watcher.dispose();
    approvalWatchers.delete(session.id);
    // Push a one-shot "session ended" notification. Tag by sid so repeat
    // exits (shouldn't happen, but) would dedupe in the OS tray.
    const short = session.id.slice(0, 8);
    const codeStr = code === null ? "signal" : `exit ${code}`;
    void push.broadcast("all", {
      title: "✓ 会话已结束",
      body: `session ${short} · ${codeStr}`,
      tag: `session-exit-${session.id}`,
      data: { sid: session.id, kind: "session.exited" },
    });
  });
}

// Pinned slash command ids — loaded once from ~/.rcc/pinned-commands.json, kept
// in memory, and broadcast via `cmd.pinned` whenever mutated.
let pinnedCommandsCache: string[] = await loadPinned();

const boot = registry.create({
  command: CLAUDE_COMMAND,
  args: CLAUDE_ARGS,
  cwd: DEFAULT_CWD,
  permissionMode: DEFAULT_PERMISSION_MODE,
});
attachApprovalWatcher(boot);
console.log(
  `[rcc-host] bootstrapped session ${boot.id} at ${boot.cwd} (permission: ${boot.permissionMode})`,
);

function send(ws: WebSocket, frame: Frame): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(encode(frame));
  } catch (err) {
    console.error("[rcc-host] send error", err);
  }
}

function attach(ws: WebSocket, state: WsState, session: Session, since: number | null): void {
  if (state.attached.has(session.id)) return;
  state.attached.add(session.id);

  for (const chunk of session.replay(since)) {
    send(ws, { v: 1, t: "pty.out", sid: session.id, seq: chunk.seq, data: chunk.data });
  }

  const unsub = session.subscribe((chunk) => {
    send(ws, { v: 1, t: "pty.out", sid: session.id, seq: chunk.seq, data: chunk.data });
  });
  state.unsubs.set(session.id, unsub);

  session.onExit((code) => {
    send(ws, { v: 1, t: "session.exited", sid: session.id, code });
  });
}

function handle(ws: WebSocket, state: WsState, frame: Frame): void {
  switch (frame.t) {
    case "session.new": {
      const s = registry.create({
        command: CLAUDE_COMMAND,
        args: CLAUDE_ARGS,
        cwd: frame.cwd ?? DEFAULT_CWD,
        cols: frame.cols,
        rows: frame.rows,
        permissionMode: frame.permissionMode ?? DEFAULT_PERMISSION_MODE,
      });
      attachApprovalWatcher(s);
      send(ws, { v: 1, t: "session.created", session: s.meta() });
      send(ws, { v: 1, t: "session.list", sessions: registry.list().map((x) => x.meta()) });
      attach(ws, state, s, null);
      return;
    }
    case "session.attach": {
      const s = registry.get(frame.sid);
      if (!s) {
        send(ws, { v: 1, t: "error", code: "no_such_session", message: frame.sid, sid: frame.sid });
        return;
      }
      attach(ws, state, s, frame.since ?? null);
      return;
    }
    case "session.close": {
      registry.close(frame.sid);
      send(ws, { v: 1, t: "session.list", sessions: registry.list().map((x) => x.meta()) });
      return;
    }
    case "pty.in": {
      registry.get(frame.sid)?.write(frame.data);
      return;
    }
    case "pty.resize": {
      registry.get(frame.sid)?.resize(frame.cols, frame.rows);
      return;
    }
    case "ping": {
      send(ws, { v: 1, t: "pong", ts: frame.ts });
      return;
    }
    case "approval.response": {
      const w = approvalWatchers.get(frame.sid);
      if (w) w.resolve(frame.id, frame.approve);
      return;
    }
    case "push.public-key.request": {
      send(ws, { v: 1, t: "push.public-key", key: push.getPublicKey() });
      return;
    }
    case "push.subscribe": {
      push
        .subscribe({
          endpoint: frame.endpoint,
          keys: frame.keys,
          deviceId: frame.deviceId ?? state.device?.id ?? null,
        })
        .then(() => send(ws, { v: 1, t: "push.subscribed", ok: true }))
        .catch((err) => {
          console.warn("[rcc-host] push.subscribe failed:", err?.message ?? err);
          send(ws, { v: 1, t: "push.subscribed", ok: false });
        });
      return;
    }
    case "push.unsubscribe": {
      push
        .unsubscribe(frame.endpoint)
        .then(() => send(ws, { v: 1, t: "push.unsubscribed" }))
        .catch(() => send(ws, { v: 1, t: "push.unsubscribed" }));
      return;
    }
    case "push.test": {
      // Send only to subs for the current device so devs don't spam everyone.
      const deviceId = state.device?.id;
      const payload: PushPayload = {
        title: "🔔 RCC 通知测试",
        body: "如果你在锁屏/桌面看到这条,推送通道已就绪。",
        tag: "push-test",
        data: { kind: "test" },
      };
      if (deviceId) {
        void push.broadcast([deviceId], payload);
      } else {
        // Loopback / unauthenticated — push to all subs.
        void push.broadcast("all", payload);
      }
      return;
    }
    case "device.list.request": {
      send(ws, {
        v: 1,
        t: "device.list",
        devices: trust.devices().map((d) => ({
          id: d.id,
          name: d.name,
          createdAt: d.createdAt,
          lastSeenAt: d.lastSeenAt,
          userAgent: d.userAgent,
          current: state.device?.id === d.id,
        })),
      });
      return;
    }
    case "device.revoke": {
      // Don't allow a device to revoke itself via this channel — too easy to
      // brick oneself. Do it from the CLI or from a different paired device.
      if (state.device && state.device.id === frame.deviceId) {
        send(ws, {
          v: 1,
          t: "error",
          code: "cannot_revoke_self",
          message: "revoke the current device from another paired device or the CLI",
        });
        return;
      }
      trust.revoke(frame.deviceId).then((ok) => {
        if (!ok) {
          send(ws, {
            v: 1,
            t: "error",
            code: "unknown_device",
            message: frame.deviceId,
          });
          return;
        }
        // Kick all live ws sessions belonging to that device.
        for (const client of wss.clients) {
          const d = (client as WebSocket & { rccDevice?: PairedDevice | null }).rccDevice;
          if (d && d.id === frame.deviceId) {
            try {
              client.close(4401, "device_revoked");
            } catch {
              // ignore
            }
          }
        }
        // Clean up push subscriptions tied to this device so we stop ringing
        // a device we've just locked out.
        void push.revokeDevice(frame.deviceId);
        broadcastDeviceList();
      });
      return;
    }
    case "device.rename": {
      trust.rename(frame.deviceId, frame.name).then((ok) => {
        if (!ok) {
          send(ws, {
            v: 1,
            t: "error",
            code: "unknown_device",
            message: frame.deviceId,
          });
          return;
        }
        broadcastDeviceList();
      });
      return;
    }
    // [config-handlers] — each config agent adds its case blocks below.
    // Keep handlers self-contained; if they need background state they
    // register it at module level (see SessionRegistry for the pattern).
    case "skill.list.request": {
      listSkills(DEFAULT_CWD)
        .then((skills) => send(ws, { v: 1, t: "skill.list", skills }))
        .catch((err) => {
          console.warn("[rcc-host] skill.list failed:", err?.message ?? err);
          send(ws, {
            v: 1,
            t: "error",
            code: "skill_list_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "skill.toggle": {
      toggleSkill(frame.id, frame.enabled, DEFAULT_CWD)
        .then(() => listSkills(DEFAULT_CWD))
        .then((skills) => send(ws, { v: 1, t: "skill.list", skills }))
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "skill_toggle_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "skill.read.request": {
      readSkillContent(frame.id, DEFAULT_CWD)
        .then((res) => {
          if (!res) {
            send(ws, {
              v: 1,
              t: "error",
              code: "skill_not_found",
              message: frame.id,
            });
            return;
          }
          send(ws, { v: 1, t: "skill.read", id: res.id, content: res.content });
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "skill_read_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "skill.save": {
      writeSkill(
        {
          scope: frame.scope,
          name: frame.name,
          description: frame.description,
          body: frame.body,
          tags: frame.tags,
        },
        DEFAULT_CWD,
      )
        .then(() => listSkills(DEFAULT_CWD))
        .then((skills) => send(ws, { v: 1, t: "skill.list", skills }))
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "skill_save_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "skill.delete": {
      deleteSkill(frame.id, DEFAULT_CWD)
        .then((ok) => {
          if (!ok) {
            send(ws, {
              v: 1,
              t: "error",
              code: "skill_not_found",
              message: frame.id,
            });
            return;
          }
          send(ws, { v: 1, t: "skill.deleted", id: frame.id });
          return listSkills(DEFAULT_CWD).then((skills) =>
            send(ws, { v: 1, t: "skill.list", skills }),
          );
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "skill_delete_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "mcp.list.request": {
      listMcp(DEFAULT_CWD)
        .then((servers) => send(ws, { v: 1, t: "mcp.list", servers }))
        .catch((err) => {
          console.warn("[rcc-host] mcp.list failed:", err?.message ?? err);
          send(ws, {
            v: 1,
            t: "error",
            code: "mcp_list_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "mcp.get.request": {
      getMcp(frame.name, DEFAULT_CWD)
        .then((server) => send(ws, { v: 1, t: "mcp.get", server }))
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "mcp_get_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "mcp.add": {
      addMcp(
        {
          name: frame.name,
          transport: frame.transport,
          scope: frame.scope,
          command: frame.command,
          args: frame.args,
          env: frame.env,
          headers: frame.headers,
          url: frame.url,
        },
        DEFAULT_CWD,
      )
        .then(() => listMcp(DEFAULT_CWD))
        .then((servers) => {
          const server = servers.find((s) => s.name === frame.name);
          if (server) broadcastMcp(server, "added");
          broadcastMcpList(servers);
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "mcp_add_failed",
            message: err?.stderr || err?.message || String(err),
          });
        });
      return;
    }
    case "mcp.remove": {
      removeMcp(frame.name, frame.scope, DEFAULT_CWD)
        .then(() => {
          broadcastMcpRemoved(frame.name);
          return listMcp(DEFAULT_CWD);
        })
        .then((servers) => broadcastMcpList(servers))
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "mcp_remove_failed",
            message: err?.stderr || err?.message || String(err),
          });
        });
      return;
    }
    case "mcp.toggle": {
      setMcpEnabled(frame.name, frame.enabled, null, DEFAULT_CWD)
        .then(() => listMcp(DEFAULT_CWD))
        .then((servers) => broadcastMcpList(servers))
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "mcp_toggle_failed",
            message: err?.stderr || err?.message || String(err),
          });
        });
      return;
    }
    case "cmd.list.request": {
      listCommands(DEFAULT_CWD)
        .then((commands) => {
          send(ws, {
            v: 1,
            t: "cmd.list",
            commands: commands.map((c) => ({
              id: c.id,
              name: c.name,
              description: c.description,
              scope: c.scope,
              pinned: c.pinned,
            })),
          });
        })
        .catch((err) => {
          send(ws, { v: 1, t: "error", code: "cmd_list_failed", message: err?.message ?? String(err) });
        });
      return;
    }
    case "cmd.read.request": {
      readCommand(frame.id, DEFAULT_CWD)
        .then((r) => {
          if (!r) {
            send(ws, { v: 1, t: "error", code: "cmd_not_found", message: frame.id });
            return;
          }
          send(ws, {
            v: 1,
            t: "cmd.read",
            id: r.id,
            content: r.content,
            description: r.description,
            scope: r.scope,
          });
        })
        .catch((err) => {
          send(ws, { v: 1, t: "error", code: "cmd_read_failed", message: err?.message ?? String(err) });
        });
      return;
    }
    case "cmd.save": {
      saveCommand(
        {
          scope: frame.scope,
          name: frame.name,
          description: frame.description,
          body: frame.body,
          originalId: frame.originalId,
        },
        DEFAULT_CWD,
      )
        .then(async (meta) => {
          send(ws, {
            v: 1,
            t: "cmd.saved",
            command: {
              id: meta.id,
              name: meta.name,
              description: meta.description,
              scope: meta.scope,
              pinned: meta.pinned,
            },
          });
          // If renamed, pinned list may hold a stale id — trim.
          if (frame.originalId && frame.originalId !== meta.id) {
            const trimmed = pinnedCommandsCache.filter((x) => x !== frame.originalId);
            if (trimmed.length !== pinnedCommandsCache.length) {
              pinnedCommandsCache = await reorderPinned(trimmed);
              broadcastPinned();
            }
          }
          broadcastCmdList();
        })
        .catch((err) => {
          send(ws, { v: 1, t: "error", code: "cmd_save_failed", message: err?.message ?? String(err) });
        });
      return;
    }
    case "cmd.delete": {
      deleteCommand(frame.id, DEFAULT_CWD)
        .then(async (ok) => {
          if (!ok) {
            send(ws, { v: 1, t: "error", code: "cmd_not_found", message: frame.id });
            return;
          }
          send(ws, { v: 1, t: "cmd.deleted", id: frame.id });
          // deleteCommand also prunes pinned; sync cache.
          pinnedCommandsCache = await loadPinned();
          broadcastPinned();
          broadcastCmdList();
        })
        .catch((err) => {
          send(ws, { v: 1, t: "error", code: "cmd_delete_failed", message: err?.message ?? String(err) });
        });
      return;
    }
    case "cmd.pin": {
      pinCommand(frame.id, frame.pinned)
        .then((ids) => {
          pinnedCommandsCache = ids;
          broadcastPinned();
        })
        .catch((err) => {
          send(ws, { v: 1, t: "error", code: "cmd_pin_failed", message: err?.message ?? String(err) });
        });
      return;
    }
    case "cmd.reorder-pinned": {
      reorderPinned(frame.ids)
        .then((ids) => {
          pinnedCommandsCache = ids;
          broadcastPinned();
        })
        .catch((err) => {
          send(ws, { v: 1, t: "error", code: "cmd_reorder_failed", message: err?.message ?? String(err) });
        });
      return;
    }
    case "subagent.list.request": {
      listSubagents(DEFAULT_CWD)
        .then((agents) => {
          send(ws, {
            v: 1,
            t: "subagent.list",
            agents: agents.map((a) => ({
              id: a.id,
              name: a.name,
              description: a.description,
              scope: a.scope,
              model: a.model,
              tools: a.tools,
            })),
          });
        })
        .catch((err) => {
          send(ws, { v: 1, t: "error", code: "subagent_list_failed", message: err?.message ?? String(err) });
        });
      return;
    }
    case "subagent.read.request": {
      readSubagent(frame.id, DEFAULT_CWD)
        .then((r) => {
          if (!r) {
            send(ws, { v: 1, t: "error", code: "subagent_not_found", message: frame.id });
            return;
          }
          send(ws, {
            v: 1,
            t: "subagent.read",
            id: r.id,
            content: r.content,
            meta: {
              id: r.meta.id,
              name: r.meta.name,
              description: r.meta.description,
              scope: r.meta.scope,
              model: r.meta.model,
              tools: r.meta.tools,
            },
          });
        })
        .catch((err) => {
          send(ws, { v: 1, t: "error", code: "subagent_read_failed", message: err?.message ?? String(err) });
        });
      return;
    }
    case "subagent.save": {
      saveSubagent(
        {
          scope: frame.scope,
          name: frame.name,
          description: frame.description,
          model: frame.model,
          tools: frame.tools,
          body: frame.body,
          originalId: frame.originalId,
        },
        DEFAULT_CWD,
      )
        .then((meta) => {
          send(ws, {
            v: 1,
            t: "subagent.saved",
            agent: {
              id: meta.id,
              name: meta.name,
              description: meta.description,
              scope: meta.scope,
              model: meta.model,
              tools: meta.tools,
            },
          });
          broadcastSubagentList();
        })
        .catch((err) => {
          send(ws, { v: 1, t: "error", code: "subagent_save_failed", message: err?.message ?? String(err) });
        });
      return;
    }
    case "subagent.delete": {
      deleteSubagent(frame.id, DEFAULT_CWD)
        .then((ok) => {
          if (!ok) {
            send(ws, { v: 1, t: "error", code: "subagent_not_found", message: frame.id });
            return;
          }
          send(ws, { v: 1, t: "subagent.deleted", id: frame.id });
          broadcastSubagentList();
        })
        .catch((err) => {
          send(ws, { v: 1, t: "error", code: "subagent_delete_failed", message: err?.message ?? String(err) });
        });
      return;
    }
    case "hook.list.request": {
      listHooks(frame.scope ?? "all", DEFAULT_CWD)
        .then((configs) => send(ws, { v: 1, t: "hook.list", configs }))
        .catch((err) => {
          send(ws, { v: 1, t: "error", code: "hook_list_failed", message: err?.message ?? String(err) });
        });
      return;
    }
    case "hook.write": {
      writeHook(frame.scope, frame.event, frame.index, frame.matcher, frame.hooks, DEFAULT_CWD)
        .then(() => {
          send(ws, { v: 1, t: "hook.written", scope: frame.scope, event: frame.event });
          broadcastHookList();
        })
        .catch((err) => {
          send(ws, { v: 1, t: "error", code: "hook_write_failed", message: err?.message ?? String(err) });
        });
      return;
    }
    case "hook.delete": {
      deleteHook(frame.scope, frame.event, frame.index, DEFAULT_CWD)
        .then((ok) => {
          if (!ok) {
            send(ws, { v: 1, t: "error", code: "hook_not_found", message: `${frame.scope}:${frame.event}[${frame.index}]` });
            return;
          }
          send(ws, {
            v: 1,
            t: "hook.deleted",
            scope: frame.scope,
            event: frame.event,
            index: frame.index,
          });
          broadcastHookList();
        })
        .catch((err) => {
          send(ws, { v: 1, t: "error", code: "hook_delete_failed", message: err?.message ?? String(err) });
        });
      return;
    }
    case "hook.test": {
      testHook(
        frame.scope,
        frame.event,
        frame.index,
        frame.hookIndex ?? 0,
        DEFAULT_CWD,
      )
        .then((res) => {
          send(ws, {
            v: 1,
            t: "hook.tested",
            scope: frame.scope,
            event: frame.event,
            index: frame.index,
            ok: res.ok,
            stdout: res.stdout,
            stderr: res.stderr,
            exitCode: res.exitCode,
            truncated: res.truncated,
          });
        })
        .catch((err) => {
          send(ws, { v: 1, t: "error", code: "hook_test_failed", message: err?.message ?? String(err) });
        });
      return;
    }
    case "perm.list.request": {
      listPermissions(DEFAULT_CWD)
        .then((configs) => send(ws, { v: 1, t: "perm.list", configs }))
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "perm_list_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "perm.add": {
      permAddRule(frame.scope, frame.bucket, frame.rule, DEFAULT_CWD)
        .then((rule) => {
          send(ws, {
            v: 1,
            t: "perm.added",
            scope: frame.scope,
            bucket: frame.bucket,
            rule,
          });
          broadcastPermList();
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "perm_add_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "perm.remove": {
      permRemoveRule(frame.scope, frame.bucket, frame.rule, DEFAULT_CWD)
        .then(() => {
          send(ws, {
            v: 1,
            t: "perm.removed",
            scope: frame.scope,
            bucket: frame.bucket,
            rule: frame.rule,
          });
          broadcastPermList();
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "perm_remove_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "perm.set-default": {
      permSetDefaultMode(frame.scope, frame.mode, DEFAULT_CWD)
        .then(() => {
          send(ws, {
            v: 1,
            t: "perm.default-set",
            scope: frame.scope,
            mode: frame.mode,
          });
          broadcastPermList();
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "perm_default_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "perm.add-dir": {
      permAddDir(frame.scope, frame.path, DEFAULT_CWD)
        .then((p) => {
          send(ws, {
            v: 1,
            t: "perm.dir-ack",
            scope: frame.scope,
            path: p,
            action: "added",
          });
          broadcastPermList();
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "perm_add_dir_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "perm.remove-dir": {
      permRemoveDir(frame.scope, frame.path, DEFAULT_CWD)
        .then(() => {
          send(ws, {
            v: 1,
            t: "perm.dir-ack",
            scope: frame.scope,
            path: frame.path,
            action: "removed",
          });
          broadcastPermList();
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "perm_remove_dir_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "fs.ls.request": {
      fsLs(frame.path, DEFAULT_CWD)
        .then((r) => send(ws, { v: 1, t: "fs.ls", path: r.path, entries: r.entries }))
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "fs_ls_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "fs.read.request": {
      fsRead(frame.path, DEFAULT_CWD)
        .then((r) => send(ws, {
          v: 1,
          t: "fs.read",
          path: r.path,
          content: r.content,
          size: r.size,
          encoding: r.encoding,
          truncated: r.truncated,
        }))
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "fs_read_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "fs.stat.request": {
      fsStat(frame.path, DEFAULT_CWD)
        .then((entry) => send(ws, { v: 1, t: "fs.stat", entry }))
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "fs_stat_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    default:
      return;
  }
}

function broadcastMcpList(servers: Parameters<typeof listMcp> extends any ? Awaited<ReturnType<typeof listMcp>> : never): void {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    try {
      client.send(encode({ v: 1, t: "mcp.list", servers }));
    } catch {
      // ignore
    }
  }
}

function broadcastPinned(): void {
  const frame: Frame = { v: 1, t: "cmd.pinned", ids: pinnedCommandsCache };
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    try {
      client.send(encode(frame));
    } catch {
      // ignore
    }
  }
}

function broadcastCmdList(): void {
  listCommands(DEFAULT_CWD)
    .then((commands) => {
      const payload = commands.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        scope: c.scope,
        pinned: c.pinned,
      }));
      const frame: Frame = { v: 1, t: "cmd.list", commands: payload };
      for (const client of wss.clients) {
        if (client.readyState !== WebSocket.OPEN) continue;
        try {
          client.send(encode(frame));
        } catch {
          // ignore
        }
      }
    })
    .catch(() => {});
}

function broadcastSubagentList(): void {
  listSubagents(DEFAULT_CWD)
    .then((agents) => {
      const payload = agents.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        scope: a.scope,
        model: a.model,
        tools: a.tools,
      }));
      const frame: Frame = { v: 1, t: "subagent.list", agents: payload };
      for (const client of wss.clients) {
        if (client.readyState !== WebSocket.OPEN) continue;
        try {
          client.send(encode(frame));
        } catch {
          // ignore
        }
      }
    })
    .catch(() => {});
}

function broadcastHookList(): void {
  listHooks("all", DEFAULT_CWD)
    .then((configs) => {
      const frame: Frame = { v: 1, t: "hook.list", configs };
      for (const client of wss.clients) {
        if (client.readyState !== WebSocket.OPEN) continue;
        try {
          client.send(encode(frame));
        } catch {
          // ignore
        }
      }
    })
    .catch(() => {});
}

function broadcastMcp(server: Awaited<ReturnType<typeof listMcp>>[number], kind: "added"): void {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    try {
      if (kind === "added") {
        client.send(encode({ v: 1, t: "mcp.added", server }));
      }
    } catch {
      // ignore
    }
  }
}

function broadcastMcpRemoved(name: string): void {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    try {
      client.send(encode({ v: 1, t: "mcp.removed", name }));
    } catch {
      // ignore
    }
  }
}

function broadcastPermList(): void {
  listPermissions(DEFAULT_CWD)
    .then((configs) => {
      const frame: Frame = { v: 1, t: "perm.list", configs };
      for (const client of wss.clients) {
        if (client.readyState !== WebSocket.OPEN) continue;
        try {
          client.send(encode(frame));
        } catch {
          // ignore
        }
      }
    })
    .catch(() => {});
}

function broadcastDeviceList(): void {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const d = (client as WebSocket & { rccDevice?: PairedDevice | null }).rccDevice;
    try {
      client.send(
        encode({
          v: 1,
          t: "device.list",
          devices: trust.devices().map((x) => ({
            id: x.id,
            name: x.name,
            createdAt: x.createdAt,
            lastSeenAt: x.lastSeenAt,
            userAgent: x.userAgent,
            current: d?.id === x.id,
          })),
        }),
      );
    } catch {
      // ignore
    }
  }
}

const httpServer = createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        sessions: registry.list().length,
        tunnel: tunnel?.getStatus() ?? null,
        devices: trust.devices().length,
      }),
    );
    return;
  }

  // Pairing endpoints — always unauthenticated (that's their whole point).
  if (
    handlePairRoute(req, res, {
      trust,
      codes,
      onCodeCreated: (code) => {
        console.log("");
        console.log(`[rcc-host] 🔑 Pairing code requested`);
        console.log(`[rcc-host]    code: ${code.slice(0, 3)} ${code.slice(3)}`);
        console.log(`[rcc-host]    valid for 5 minutes. Enter it on the remote device.`);
        console.log("");
      },
    })
  ) {
    return;
  }

  // A non-upgrade GET /ws is used by the client to probe auth status. Mirror
  // the same check the upgrade handler applies.
  if (req.url?.startsWith("/ws")) {
    const auth = authenticate(req);
    if (!auth.ok) {
      res.writeHead(401, {
        "content-type": "application/json",
        "x-rcc-auth-reason": auth.reason,
      });
      res.end(JSON.stringify({ error: auth.reason }));
      return;
    }
    // Reached via e.g. curl; no upgrade to do.
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ws endpoint (send Upgrade to connect)");
    return;
  }

  // Serve the built web bundle when present.
  const served = await serveStatic(req.url ?? "/");
  if (served) {
    res.writeHead(200, served.headers);
    res.end(served.body);
    return;
  }

  res.writeHead(200, { "content-type": "text/plain" });
  res.end("rcc-host");
});

// Gate WebSocket upgrades on auth. `noServer: true` + manual handleUpgrade
// is the standard pattern for pre-upgrade auth checks.
const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const url = req.url ?? "";
  if (!url.startsWith("/ws")) {
    socket.destroy();
    return;
  }
  const auth = authenticate(req);
  if (!auth.ok) {
    socket.write(
      `HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nX-RCC-Auth-Reason: ${auth.reason}\r\n\r\n`,
    );
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    // Attach device info for later (so device.list etc. can read it).
    (ws as WebSocket & { rccDevice?: PairedDevice | null }).rccDevice = auth.device;
    wss.emit("connection", ws, req);
  });
});

const tunnel: Tunnel | null = startTunnel(TUNNEL_CONFIG, PORT);

function currentTunnelInfo(): TunnelInfo | undefined {
  if (!tunnel) return undefined;
  return tunnel.getStatus();
}

function broadcast(frame: Frame): void {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(encode(frame));
      } catch {
        // socket going away; ignore
      }
    }
  }
}

if (tunnel) {
  tunnel.on("status", (s) => {
    broadcast({ v: 1, t: "tunnel.status", tunnel: s });
  });
  tunnel.start();
}

trust.onExternalChange(() => {
  console.log("[rcc-host] trust store changed on disk, re-broadcasting device list");
  for (const client of wss.clients) {
    const d = (client as WebSocket & { rccDevice?: PairedDevice | null }).rccDevice;
    if (d && !trust.devices().find((x) => x.id === d.id)) {
      try {
        client.close(4401, "device_revoked");
      } catch {
        // ignore
      }
    }
  }
  broadcastDeviceList();
});

wss.on("connection", (ws) => {
  const device = (ws as WebSocket & { rccDevice?: PairedDevice | null }).rccDevice ?? null;
  const state: WsState = { attached: new Set(), unsubs: new Map(), device };

  send(ws, {
    v: 1,
    t: "hello",
    protocol: PROTOCOL_VERSION,
    sessions: registry.list().map((s) => s.meta()),
    tunnel: currentTunnelInfo(),
    device: device ? { id: device.id, name: device.name } : null,
    pinnedCommands: pinnedCommandsCache,
  });

  ws.on("message", (raw) => {
    let text: string;
    if (typeof raw === "string") text = raw;
    else if (Array.isArray(raw)) text = Buffer.concat(raw).toString("utf8");
    else text = (raw as Buffer).toString("utf8");

    const frame = tryDecode(text);
    if (!frame) {
      send(ws, { v: 1, t: "error", code: "decode", message: "invalid frame" });
      return;
    }
    handle(ws, state, frame);
  });

  ws.on("close", () => {
    for (const unsub of state.unsubs.values()) unsub();
    state.unsubs.clear();
    state.attached.clear();
  });
});

httpServer.listen(PORT, () => {
  console.log(`[rcc-host] listening on http://localhost:${PORT}`);
  console.log(`[rcc-host] ws endpoint: ws://localhost:${PORT}/ws`);
  console.log(`[rcc-host] claude cmd: ${CLAUDE_COMMAND} ${CLAUDE_ARGS.join(" ")}`);
  console.log(`[rcc-host] cwd: ${DEFAULT_CWD}`);
  console.log(`[rcc-host] default permission mode: ${DEFAULT_PERMISSION_MODE}`);
  console.log(
    `[rcc-host] tunnel: ${
      TUNNEL_CONFIG.mode === "named"
        ? `named (${TUNNEL_CONFIG.name} → ${TUNNEL_CONFIG.hostname})`
        : TUNNEL_CONFIG.mode === "try"
          ? "enabled (trycloudflare)"
          : "disabled"
    }`,
  );
  console.log(`[rcc-host] web bundle: ${SERVE_WEB ? WEB_DIST : "not built (run `pnpm -F @rcc/web build`)"}`);
  console.log(
    `[rcc-host] auth: ${trust.devices().length} paired device(s)${TRUST_LOOPBACK ? ", loopback trusted" : ""}`,
  );
  console.log(`[rcc-host] host id: ${trust.hostId}`);
});

process.on("SIGINT", () => {
  console.log("\n[rcc-host] shutting down...");
  tunnel?.stop();
  registry.closeAll();
  process.exit(0);
});
