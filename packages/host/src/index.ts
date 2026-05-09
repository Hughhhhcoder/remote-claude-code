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
import { SessionRegistry, type AnySession, Session } from "./session.ts";
import { startTunnel, type Tunnel } from "./tunnel.ts";
import { loadConfig, resolveTunnelConfig } from "./config.ts";
import { ProjectStore } from "./projects.ts";
import { TrustStore, PairingCodes, type PairedDevice } from "./trust.ts";
import { handlePairRoute } from "./pair.ts";
import { handleWhisperRoute } from "./whisper.ts";
import {
  loadOrCreateHostKeys,
  isEnvelope,
  encryptFrame,
  decryptEnvelope,
  ensureSodiumReady,
  ReplayWindow,
  timestampWithinSkew,
} from "./e2e.ts";
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
import { CrdtRelay, isUpdateTooLarge } from "./crdt.ts";
import { WebAuthnService, rpIdFromHost, originFromReq } from "./webauthn.ts";
import { installCrashHandler } from "./crash.ts";
import { checkForUpdates, versionSummary } from "./version.ts";
import {
  fetchCatalogs,
  installSkillFromCatalog,
  installMcpFromCatalog,
} from "./marketplace.ts";

interface WsState {
  attached: Set<string>;
  unsubs: Map<string, () => void>;
  device: PairedDevice | null;
}

const CLAUDE_COMMAND = process.env.RCC_CLAUDE_CMD ?? "claude";
const CLAUDE_ARGS = (process.env.RCC_CLAUDE_ARGS ?? "").split(" ").filter(Boolean);
const PORT = Number(process.env.RCC_PORT ?? 7777);
const BOOT_CWD = process.env.RCC_CWD ?? process.cwd();
const RCC_CONFIG = await loadConfig();
const TUNNEL_CONFIG = resolveTunnelConfig(RCC_CONFIG, process.env);
const projects = await ProjectStore.load(BOOT_CWD);
const DEFAULT_CWD = projects.getDefault().cwd;

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
await ensureSodiumReady();
const hostKeys = await loadOrCreateHostKeys();
const webauthn = new WebAuthnService(trust);

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
const crdt = new CrdtRelay();

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
      client.send(frameForClient(client as E2EWebSocket, frame));
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

function attachApprovalWatcher(session: AnySession): void {
  // ApprovalWatcher scrapes pty.out for Claude CLI y/n prompts — only the CLI
  // driver emits those. SDK driver surfaces permission decisions via the
  // canUseTool callback path (not yet wired into RCC's approval UI).
  if (!(session instanceof Session)) {
    // Still wire session-exited push so users on SDK sessions hear "done".
    session.onExit((code) => {
      const short = session.id.slice(0, 8);
      const codeStr = code === null ? "signal" : `exit ${code}`;
      void push.broadcast("all", {
        title: "✓ 会话已结束",
        body: `session ${short} · ${codeStr}`,
        tag: `session-exit-${session.id}`,
        data: { sid: session.id, kind: "session.exited" },
      });
    });
    return;
  }
  const watcher = new ApprovalWatcher(session, broadcastApproval, (id, risk) => {
    if (risk !== "high") return;
    // Gate only if at least one currently-connected device has a passkey —
    // otherwise there's nobody to satisfy the challenge.
    let gateable = false;
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const d = (client as E2EWebSocket).rccDevice;
      if (d?.passkey) {
        gateable = true;
        break;
      }
    }
    if (gateable) webauthn.requireGate(id);
  });
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

// [messages] Bridge each session's ChatParser to a websocket broadcast so
// every attached client sees assistant messages as they're classified.
function attachChatBroadcast(session: AnySession): void {
  const unsub = session.chat.onMessage((message) => {
    broadcast({ v: 1, t: "chat.append", sid: session.id, message });
  });
  // SDK driver also fires streaming segment updates; CLI driver never does.
  const unsubUpdate = session.chat.onUpdate((messageId, segmentIndex, segment) => {
    broadcast({
      v: 1,
      t: "chat.update",
      sid: session.id,
      messageId,
      segmentIndex,
      segment,
    });
  });
  session.onExit(() => {
    unsub();
    unsubUpdate();
  });
}

// Pinned slash command ids — loaded once from ~/.rcc/pinned-commands.json, kept
// in memory, and broadcast via `cmd.pinned` whenever mutated.
let pinnedCommandsCache: string[] = await loadPinned();

const boot = registry.create({
  driver: "cli",
  command: CLAUDE_COMMAND,
  args: CLAUDE_ARGS,
  cwd: DEFAULT_CWD,
  permissionMode: DEFAULT_PERMISSION_MODE,
  projectId: projects.getDefault().id,
});
attachApprovalWatcher(boot);
attachChatBroadcast(boot);
console.log(
  `[rcc-host] bootstrapped session ${boot.id} at ${boot.cwd} (permission: ${boot.permissionMode})`,
);

type E2EWebSocket = WebSocket & {
  rccDevice?: PairedDevice | null;
  rccSharedKey?: string | null;
  /** Last seq we issued outbound on this connection. Starts at 0; first send
   * uses 1. uint32, wraps at 2^32 (practically unreachable). */
  rccOutboundSeq?: number;
  /** Per-connection replay state for inbound frames. Only populated when the
   * connection has a shared key (i.e. E2E is active). */
  rccReplay?: ReplayWindow;
};

/**
 * Return the serialized ws payload for this client, honouring E2E. Plain
 * JSON for clients without a shared key (loopback / legacy), secretbox
 * envelope `{e2e:1,n,c,s,ts}` otherwise. Mutates the ws to bump outbound seq.
 */
function frameForClient(ws: E2EWebSocket, frame: Frame): string {
  const key = ws.rccSharedKey;
  if (key) {
    const seq = ((ws.rccOutboundSeq ?? 0) + 1) >>> 0;
    ws.rccOutboundSeq = seq;
    return encryptFrame(key, frame, seq, Date.now());
  }
  return encode(frame);
}

function send(ws: WebSocket, frame: Frame): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(frameForClient(ws as E2EWebSocket, frame));
  } catch (err) {
    console.error("[rcc-host] send error", err);
  }
}

function attach(ws: WebSocket, state: WsState, session: AnySession, since: number | null): void {
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
      // Project binding rules:
      //  - projectId given  → use that project's cwd (or the explicit cwd if
      //    caller also passed one; client opt-in to override).
      //  - cwd only         → match cwd against known projects; fall back to
      //    default project but stamp the explicit cwd.
      //  - neither          → default project.
      let project = frame.projectId ? projects.getById(frame.projectId) : undefined;
      if (!project && frame.cwd) project = projects.findByCwd(frame.cwd);
      if (!project) project = projects.getDefault();
      const cwd = frame.cwd ?? project.cwd;
      const driver = frame.driver ?? "cli";
      const s = registry.create({
        driver,
        command: driver === "cli" ? CLAUDE_COMMAND : undefined,
        args: driver === "cli" ? CLAUDE_ARGS : undefined,
        cwd,
        cols: frame.cols,
        rows: frame.rows,
        permissionMode: frame.permissionMode ?? DEFAULT_PERMISSION_MODE,
        projectId: project.id,
      });
      attachApprovalWatcher(s);
      attachChatBroadcast(s);
      send(ws, { v: 1, t: "session.created", session: s.meta() });
      send(ws, { v: 1, t: "session.list", sessions: registry.list().map((x) => x.meta()) });
      attach(ws, state, s, null);
      // SDK sessions need an explicit `start()` to open the query stream.
      // Failures surface as system chat messages (and close the session); we
      // also emit a one-shot error frame so the client doesn't have to
      // parse chat to discover the problem.
      if (s.driver === "sdk") {
        s.start().catch((err: Error) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "sdk_start_failed",
            message: err.message,
            sid: s.id,
          });
        });
      }
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
      crdt.dropSession(frame.sid);
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
      const gate = webauthn.consumeGate(frame.id, frame.webauthnToken);
      if (!gate.open) {
        send(ws, {
          v: 1,
          t: "error",
          code: "approval_gate_blocked",
          message: gate.reason,
          sid: frame.sid,
        });
        // Tell every client this approval is no longer live so UIs reset.
        broadcastApproval({ v: 1, t: "approval.cleared", id: frame.id, sid: frame.sid });
        const w = approvalWatchers.get(frame.sid);
        if (w) w.resolve(frame.id, false);
        return;
      }
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
          const d = (client as E2EWebSocket).rccDevice;
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
    case "project.list.request": {
      send(ws, { v: 1, t: "project.list", projects: projects.list() });
      return;
    }
    case "project.add": {
      projects
        .create({ name: frame.name, cwd: frame.cwd, color: frame.color })
        .then((p) => {
          send(ws, { v: 1, t: "project.added", project: p });
          broadcastProjectList();
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "project_add_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "project.remove": {
      projects
        .remove(frame.id)
        .then((ok) => {
          if (!ok) {
            send(ws, { v: 1, t: "error", code: "project_not_found", message: frame.id });
            return;
          }
          send(ws, { v: 1, t: "project.removed", id: frame.id });
          broadcastProjectList();
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "project_remove_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "project.rename": {
      projects
        .rename(frame.id, frame.name)
        .then((p) => {
          send(ws, { v: 1, t: "project.renamed", project: p });
          broadcastProjectList();
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "project_rename_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "project.update": {
      projects
        .update(frame.id, { cwd: frame.cwd, color: frame.color ?? undefined })
        .then((p) => {
          send(ws, { v: 1, t: "project.updated", project: p });
          broadcastProjectList();
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "project_update_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
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
    case "chat.list.request": {
      const s = registry.get(frame.sid);
      if (!s) {
        send(ws, { v: 1, t: "chat.list", sid: frame.sid, messages: [] });
        return;
      }
      send(ws, { v: 1, t: "chat.list", sid: frame.sid, messages: s.chat.list() });
      return;
    }
    case "chat.reset": {
      const s = registry.get(frame.sid);
      if (s) s.chat.reset();
      send(ws, { v: 1, t: "chat.resetted", sid: frame.sid });
      return;
    }
    case "crdt.update": {
      if (isUpdateTooLarge(frame.update)) {
        send(ws, {
          v: 1,
          t: "error",
          code: "crdt_update_too_large",
          message: `update exceeds 64KB cap`,
          sid: frame.sid,
        });
        return;
      }
      crdt.append(frame.sid, frame.docId, { update: frame.update, origin: frame.origin });
      for (const client of wss.clients) {
        if (client === ws) continue;
        if (client.readyState !== WebSocket.OPEN) continue;
        try {
          client.send(frameForClient(client as E2EWebSocket, frame));
        } catch {
          // ignore
        }
      }
      return;
    }
    case "crdt.sync.request": {
      for (const entry of crdt.replay(frame.sid, frame.docId)) {
        send(ws, {
          v: 1,
          t: "crdt.update",
          sid: frame.sid,
          docId: frame.docId,
          update: entry.update,
          origin: entry.origin,
        });
      }
      return;
    }
    case "market.catalog.request": {
      fetchCatalogs(!!frame.force)
        .then((cat) =>
          send(ws, {
            v: 1,
            t: "market.catalog",
            skills: cat.skills,
            mcps: cat.mcps,
            sources: cat.sources,
            fetchedAt: cat.fetchedAt,
          }),
        )
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "market_catalog_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "market.install.skill": {
      installSkillFromCatalog(frame.id, frame.scope, DEFAULT_CWD)
        .then((res) => {
          if (res.ok) {
            send(ws, {
              v: 1,
              t: "market.skill.installed",
              id: frame.id,
              ok: true,
              installedName: res.installedName,
            });
            return listSkills(DEFAULT_CWD).then((skills) =>
              send(ws, { v: 1, t: "skill.list", skills }),
            );
          }
          send(ws, {
            v: 1,
            t: "market.skill.installed",
            id: frame.id,
            ok: false,
            error: res.error,
          });
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "market.skill.installed",
            id: frame.id,
            ok: false,
            error: err?.message ?? String(err),
          });
        });
      return;
    }
    case "market.install.mcp": {
      installMcpFromCatalog(frame.id, frame.scope, frame.env ?? {}, DEFAULT_CWD)
        .then((res) => {
          if (res.ok) {
            send(ws, {
              v: 1,
              t: "market.mcp.installed",
              id: frame.id,
              ok: true,
              installedName: res.installedName,
            });
            return listMcp(DEFAULT_CWD).then((servers) => broadcastMcpList(servers));
          }
          send(ws, {
            v: 1,
            t: "market.mcp.installed",
            id: frame.id,
            ok: false,
            error: res.error,
          });
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "market.mcp.installed",
            id: frame.id,
            ok: false,
            error: err?.message ?? String(err),
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
      client.send(frameForClient(client as E2EWebSocket, { v: 1, t: "mcp.list", servers }));
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
      client.send(frameForClient(client as E2EWebSocket, frame));
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
          client.send(frameForClient(client as E2EWebSocket, frame));
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
          client.send(frameForClient(client as E2EWebSocket, frame));
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
          client.send(frameForClient(client as E2EWebSocket, frame));
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
        client.send(frameForClient(client as E2EWebSocket, { v: 1, t: "mcp.added", server }));
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
      client.send(frameForClient(client as E2EWebSocket, { v: 1, t: "mcp.removed", name }));
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
          client.send(frameForClient(client as E2EWebSocket, frame));
        } catch {
          // ignore
        }
      }
    })
    .catch(() => {});
}

function broadcastProjectList(): void {
  const frame: Frame = { v: 1, t: "project.list", projects: projects.list() };
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    try {
      client.send(frameForClient(client as E2EWebSocket, frame));
    } catch {
      // ignore
    }
  }
}

function broadcastDeviceList(): void {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const d = (client as E2EWebSocket).rccDevice;
    try {
      client.send(
        frameForClient(client as E2EWebSocket, {
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

function readJsonBody<T>(req: import("node:http").IncomingMessage, max = 256 * 1024): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? (JSON.parse(text) as T) : ({} as T));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function handleWebAuthnRoute(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  deviceId: string,
  rpId: string,
  origin: string,
): Promise<void> {
  const url = req.url ?? "";
  const writeJson = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (url === "/webauthn/register/begin") {
    const body = await readJsonBody<{ deviceId?: string }>(req);
    const targetId = body.deviceId ?? deviceId;
    if (targetId !== deviceId) {
      writeJson(403, { error: "cannot register passkey for another device" });
      return;
    }
    const options = await webauthn.beginRegistration(targetId, rpId, "RCC");
    writeJson(200, options);
    return;
  }
  if (url === "/webauthn/register/complete") {
    const body = await readJsonBody<{ deviceId?: string; response?: unknown }>(req);
    const targetId = body.deviceId ?? deviceId;
    if (targetId !== deviceId || !body.response) {
      writeJson(400, { error: "invalid body" });
      return;
    }
    const result = await webauthn.completeRegistration(
      targetId,
      body.response as Parameters<typeof webauthn.completeRegistration>[1],
      rpId,
      origin,
    );
    await trust.addPasskey(targetId, result);
    broadcastDeviceList();
    writeJson(200, { ok: true });
    return;
  }
  if (url === "/webauthn/assert/begin") {
    const body = await readJsonBody<{ deviceId?: string; approvalId?: string }>(req);
    const targetId = body.deviceId ?? deviceId;
    if (targetId !== deviceId || !body.approvalId) {
      writeJson(400, { error: "invalid body" });
      return;
    }
    const options = await webauthn.beginAssertion(targetId, body.approvalId, rpId);
    writeJson(200, options);
    return;
  }
  if (url === "/webauthn/assert/complete") {
    const body = await readJsonBody<{
      deviceId?: string;
      approvalId?: string;
      response?: unknown;
    }>(req);
    const targetId = body.deviceId ?? deviceId;
    if (targetId !== deviceId || !body.approvalId || !body.response) {
      writeJson(400, { error: "invalid body" });
      return;
    }
    const ok = await webauthn.completeAssertion(
      targetId,
      body.approvalId,
      body.response as Parameters<typeof webauthn.completeAssertion>[2],
      rpId,
      origin,
    );
    writeJson(ok ? 200 : 401, { ok, webauthnToken: ok ? body.approvalId : null });
    return;
  }
  if (url === "/webauthn/clear") {
    await trust.clearPasskey(deviceId);
    broadcastDeviceList();
    writeJson(200, { ok: true });
    return;
  }
  writeJson(404, { error: "unknown webauthn route" });
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
      hostKeys,
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

  // Version & update-check. Authenticated so a public tunnel doesn't expose
  // internal version info to unpaired callers.
  if (req.url === "/version" && req.method === "GET") {
    const auth = authenticate(req);
    if (!auth.ok) {
      res.writeHead(401, { "content-type": "application/json", "x-rcc-auth-reason": auth.reason });
      res.end(JSON.stringify({ error: auth.reason }));
      return;
    }
    const summary = await versionSummary();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(summary));
    return;
  }
  if (req.url?.startsWith("/version/check") && req.method === "GET") {
    const auth = authenticate(req);
    if (!auth.ok) {
      res.writeHead(401, { "content-type": "application/json", "x-rcc-auth-reason": auth.reason });
      res.end(JSON.stringify({ error: auth.reason }));
      return;
    }
    const force = req.url.includes("force=1");
    const result = await checkForUpdates(force);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  // WebAuthn: passkey registration + high-risk approval assertion. Both
  // require a valid device token; the RP ID is derived from the Host header
  // so the host works on both `localhost` and a cloudflared hostname.
  if (req.url?.startsWith("/webauthn/") && req.method === "POST") {
    const auth = authenticate(req);
    if (!auth.ok || !auth.device) {
      res.writeHead(401, {
        "content-type": "application/json",
        "x-rcc-auth-reason": auth.ok ? "device_required" : auth.reason,
      });
      res.end(JSON.stringify({ error: auth.ok ? "device_required" : auth.reason }));
      return;
    }
    const rpId = rpIdFromHost(req.headers["host"] as string | undefined);
    const origin = originFromReq(req);
    try {
      await handleWebAuthnRoute(req, res, auth.device.id, rpId, origin);
    } catch (err: any) {
      if (!res.headersSent) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err?.message ?? "webauthn failed" }));
      }
    }
    return;
  }

  // Whisper transcription proxy. Authenticated so remote callers must
  // present a device token — we don't want an open proxy to someone's paid
  // OpenAI key.
  if (req.url?.startsWith("/whisper") && req.method === "POST") {
    const auth = authenticate(req);
    if (!auth.ok) {
      res.writeHead(401, {
        "content-type": "application/json",
        "x-rcc-auth-reason": auth.reason,
      });
      res.end(JSON.stringify({ error: auth.reason }));
      return;
    }
    try {
      await handleWhisperRoute(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err?.message ?? "whisper failed" }));
      }
    }
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
    // Attach device info and E2E shared key for later (so device.list etc. can
    // read it, and the send helpers can encrypt per-client).
    const eWs = ws as E2EWebSocket;
    eWs.rccDevice = auth.device;
    eWs.rccSharedKey = auth.device?.sharedKey ?? null;
    eWs.rccOutboundSeq = 0;
    if (eWs.rccSharedKey) eWs.rccReplay = new ReplayWindow();
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
        client.send(frameForClient(client as E2EWebSocket, frame));
      } catch {
        // socket going away; ignore
      }
    }
  }
}

installCrashHandler((frame) => broadcast(frame));

if (tunnel) {
  tunnel.on("status", (s) => {
    broadcast({ v: 1, t: "tunnel.status", tunnel: s });
  });
  tunnel.start();
}

trust.onExternalChange(() => {
  console.log("[rcc-host] trust store changed on disk, re-broadcasting device list");
  for (const client of wss.clients) {
    const d = (client as E2EWebSocket).rccDevice;
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
  const eWs = ws as E2EWebSocket;
  const device = eWs.rccDevice ?? null;
  const state: WsState = { attached: new Set(), unsubs: new Map(), device };
  if (device && !eWs.rccSharedKey) {
    console.warn(
      `[rcc-host] device ${device.id} (${device.name}) paired before E2E — falling back to plaintext. Ask user to re-pair.`,
    );
  }

  send(ws, {
    v: 1,
    t: "hello",
    protocol: PROTOCOL_VERSION,
    sessions: registry.list().map((s) => s.meta()),
    tunnel: currentTunnelInfo(),
    device: device ? { id: device.id, name: device.name, hasPasskey: !!device.passkey } : null,
    pinnedCommands: pinnedCommandsCache,
    projects: projects.list(),
  });

  ws.on("message", (raw) => {
    let text: string;
    if (typeof raw === "string") text = raw;
    else if (Array.isArray(raw)) text = Buffer.concat(raw).toString("utf8");
    else text = (raw as Buffer).toString("utf8");

    // E2E: the outer message may be a secretbox envelope. Try to unwrap it
    // first. We still accept plaintext in two cases: (a) loopback/legacy
    // clients with no shared key, (b) a bare `{hello:1}` bootstrap marker
    // from the client (reserved for future handshake — ignored for now).
    let outer: unknown;
    try {
      outer = JSON.parse(text);
    } catch {
      send(ws, { v: 1, t: "error", code: "decode", message: "invalid frame" });
      return;
    }
    if (isEnvelope(outer)) {
      if (!eWs.rccSharedKey) {
        send(ws, { v: 1, t: "error", code: "e2e_no_key", message: "e2e envelope received but no shared key" });
        return;
      }
      if (!timestampWithinSkew(outer.ts)) {
        try {
          ws.close(4402, "timestamp_skew");
        } catch {
          // ignore
        }
        return;
      }
      const replay = eWs.rccReplay;
      if (replay) {
        const check = replay.check(outer.s);
        if (check !== "ok") {
          try {
            ws.close(4402, check === "replay" ? "replay" : "too_old");
          } catch {
            // ignore
          }
          return;
        }
      }
      const decrypted = decryptEnvelope(eWs.rccSharedKey, outer);
      if (!decrypted) {
        // Auth failure on the E2E envelope — either key rotated or tampering.
        // Close with the unauthorized code so the client drops its token and
        // re-pairs.
        try {
          ws.close(4401, "e2e_decrypt_failed");
        } catch {
          // ignore
        }
        return;
      }
      if (replay) replay.apply(outer.s);
      const frame = tryDecode(JSON.stringify(decrypted.obj));
      if (!frame) {
        send(ws, { v: 1, t: "error", code: "decode", message: "invalid frame" });
        return;
      }
      handle(ws, state, frame);
      return;
    }
    // Bootstrap marker — client may send `{hello:1}` before switching to
    // encrypted mode. No-op; host has already sent its hello.
    if (outer && typeof outer === "object" && (outer as { hello?: unknown }).hello === 1) {
      return;
    }
    // Plain frame. Only accept when this connection has no E2E key
    // (loopback, or pre-E2E device not yet re-paired).
    if (eWs.rccSharedKey) {
      send(ws, { v: 1, t: "error", code: "e2e_required", message: "plain frame rejected; re-pair this device" });
      return;
    }
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
