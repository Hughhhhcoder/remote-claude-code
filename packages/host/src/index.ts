import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
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
import {
  SessionRegistry,
  type AnySession,
  Session,
  DeadSession,
  createSession,
} from "./session.ts";
import { SdkSession } from "./sdk-session.ts";
import { startTunnel, type Tunnel } from "./tunnel.ts";
import { loadConfig, resolveTunnelConfig } from "./config.ts";
import { ProjectStore } from "./projects.ts";
import { TrustStore, PairingCodes, type PairedDevice } from "./trust.ts";
import { handlePairRoute } from "./pair.ts";
import { handleWhisperRoute } from "./whisper.ts";
import { summarizeSession } from "./summary.ts";
import { SearchIndex } from "./search.ts";
import {
  Debouncer,
  deleteSnapshot,
  loadAllSnapshots,
  purgeStale,
  saveSnapshot,
  type SessionSnapshot,
} from "./persistence.ts";
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
import { Watchdog } from "./watchdog.ts";
import { checkForUpdates, versionSummary } from "./version.ts";
import { Updater } from "./updater.ts";
import {
  fetchCatalogs,
  installSkillFromCatalog,
  installMcpFromCatalog,
  installPluginFromCatalog,
} from "./marketplace.ts";
import { PrefsStore } from "./prefs.ts";
import { metrics } from "./metrics.ts";
import { usage } from "./usage.ts";
import { ShareStore } from "./shares.ts";
import { WorkflowStore } from "./workflows.ts";
import { NotebookStore } from "./notebooks.ts";
import { PromptStore } from "./prompts.ts";
import { StarterStore } from "./starters.ts";
import { AuditLog } from "./audit.ts";
import { GitWatcher } from "./git-watcher.ts";
import { runGit, isReadOnlyGitArgs, getStatus as getGitStatus } from "./git.ts";
import { ActivityFeed } from "./activity.ts";
import {
  recordingPathFor,
  recordingFileExists,
  recordingFileSize,
  deleteRecording,
} from "./recording.ts";
import {
  PeerStore,
  FederatedClient,
  parseSid,
  rewriteLocalToRemote,
  type PeerConfig,
} from "./federation.ts";
import { PluginHost, PluginEventBus } from "./plugins.ts";
import { handleRestRoute } from "./rest.ts";
import {
  BACKPRESSURE_DROP_THRESHOLD,
  BACKPRESSURE_CLOSE_THRESHOLD,
  WS_CLOSE_BACKPRESSURE,
  WS_CLOSE_RATE_LIMIT,
  createWsLimiters,
  isCriticalFrame,
  type WsLimiters,
} from "./backpressure.ts";
import { randomUUID } from "node:crypto";

interface WsState {
  attached: Set<string>;
  unsubs: Map<string, () => void>;
  /** Per-session exit-listener disposers so ws close doesn't leak session refs. */
  exitUnsubs: Map<string, () => void>;
  device: PairedDevice | null;
  metricsSubscribed: boolean;
  /** When set, this connection is a share-token guest: read-only, pinned to
   * a single sid, no E2E, all mutation frames rejected. */
  share: { id: string; sid: string; expiresAt: number } | null;
  /** Per-connection backpressure + rate-limiting state. */
  limiters: WsLimiters;
  /** Set true after we've emitted an error frame for current slow window;
   * reset once bufferedAmount drops back under the drop threshold. */
  bpNotified: boolean;
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
//
// Tunnel safety: when a public tunnel is enabled we default to NOT trusting
// loopback because cloudflared proxies remote traffic to 127.0.0.1:7777 —
// the socket would lie and every visitor would be "local". The per-request
// isProxiedRequest() check above catches header-tagged proxy traffic, but
// disabling loopback trust entirely in tunnel mode removes the attack
// surface if any edge case slips past the header detection. Users who need
// loopback trust even with the tunnel on can set RCC_TRUST_LOOPBACK=1
// explicitly.
const tunnelModeRequested =
  TUNNEL_CONFIG.mode === "try" || TUNNEL_CONFIG.mode === "named";
const TRUST_LOOPBACK_EXPLICIT = process.env.RCC_TRUST_LOOPBACK;
const TRUST_LOOPBACK =
  TRUST_LOOPBACK_EXPLICIT === "1"
    ? true
    : TRUST_LOOPBACK_EXPLICIT === "0"
      ? false
      : !tunnelModeRequested;

// Web bundle: if `@rcc/web` has been built (`pnpm -F @rcc/web build`), the
// host will serve its dist/ directly so a single public URL ships both the
// UI and the websocket.
const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_DIST = process.env.RCC_WEB_DIST
  ? resolve(process.env.RCC_WEB_DIST)
  : resolve(HERE, "..", "..", "web", "dist");
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

// Vite emits hashed filenames like `index-z4jiDD0n.js`, `monaco-xYz12Abc.js`.
// Matches `-<8+ alnum chars>.<ext>` — safe because real app filenames rarely
// contain a `-` immediately followed by 8+ base36-ish chars before the extension.
const HASHED_NAME = /-[A-Za-z0-9_]{8,}\.[A-Za-z0-9]+$/;

// Exts where on-the-fly compression pays off (text-shaped).
const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".map", ".webmanifest", ".txt"]);

function pickEncoding(accept: string | undefined): "br" | "gzip" | null {
  if (!accept) return null;
  const a = accept.toLowerCase();
  if (a.includes("br")) return "br";
  if (a.includes("gzip")) return "gzip";
  return null;
}

function cacheControlFor(rel: string, ext: string): string {
  if (ext === ".html") return "no-cache";
  // Hashed, content-addressed assets can be cached forever.
  if (HASHED_NAME.test(rel)) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

async function serveStatic(
  urlPath: string,
  acceptEncoding: string | undefined,
): Promise<{ body: Buffer; headers: Record<string, string> } | null> {
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
  const ext = extname(filePath).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  const cacheControl = cacheControlFor(rel, ext);
  const wantEnc = COMPRESSIBLE.has(ext) ? pickEncoding(acceptEncoding) : null;

  // Prefer a precomputed sibling if it exists and the client accepts it.
  if (wantEnc) {
    const sibling = filePath + (wantEnc === "br" ? ".br" : ".gz");
    try {
      const body = await readFile(sibling);
      return {
        body,
        headers: {
          "content-type": mime,
          "cache-control": cacheControl,
          "content-encoding": wantEnc,
          vary: "Accept-Encoding",
        },
      };
    } catch {
      // fall through to raw file; runtime compression is avoided to keep CPU
      // predictable — precompress step produces siblings at build time.
    }
  }

  try {
    const body = await readFile(filePath);
    const headers: Record<string, string> = {
      "content-type": mime,
      "cache-control": cacheControl,
    };
    if (COMPRESSIBLE.has(ext)) headers["vary"] = "Accept-Encoding";
    return { body, headers };
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
const prefs = await PrefsStore.load();
const shares = await ShareStore.load();
const workflows = await WorkflowStore.load();
const notebooks = await NotebookStore.load();
const prompts = await PromptStore.load();
const starters = await StarterStore.load();
const audit = await AuditLog.load();
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

/**
 * Returns true when the request arrived via the cloudflared tunnel (or any
 * reverse proxy) rather than a genuine local process. cloudflared terminates
 * TLS on its side and forwards to 127.0.0.1:7777 so req.socket.remoteAddress
 * would otherwise lie — callers still see "loopback". We distinguish:
 *
 *   1. `cf-connecting-ip` / `x-forwarded-for` headers (added by the tunnel)
 *   2. `Host:` header not in {localhost, 127.0.0.1, ::1} → request came
 *      addressed to a public domain, so it went through the tunnel.
 *
 * Any of these → treat as remote, require real device token, never grant
 * loopback trust.
 */
function isProxiedRequest(req: { headers: { [key: string]: any } }): boolean {
  const h = req.headers;
  if (h["cf-connecting-ip"]) return true;
  if (h["cf-ray"]) return true;
  if (h["x-forwarded-for"]) return true;
  if (h["x-forwarded-proto"]) return true;
  if (h["x-forwarded-host"]) return true;
  const host = typeof h["host"] === "string" ? (h["host"] as string).toLowerCase() : "";
  if (!host) return false;
  const bare = host.split(":")[0] ?? "";
  if (bare === "localhost" || bare === "127.0.0.1" || bare === "::1") return false;
  // Bare IP literal on a non-loopback address (LAN access) — still a real
  // client over the wire, but that's governed by isLoopback (will be false).
  // Anything else (trycloudflare, custom domain, …) is proxied.
  if (/^[0-9.]+$/.test(bare)) return false;
  return true;
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
    metrics.incr("auth.fails");
    return { ok: false, reason: "invalid_token" };
  }
  // Loopback trust ONLY when the request genuinely came from the local
  // machine. cloudflared forwards to 127.0.0.1:7777 so req.socket would lie
  // otherwise — isProxiedRequest catches tunnel ingress and requires token.
  if (TRUST_LOOPBACK && isLoopback(req) && !isProxiedRequest(req)) {
    return { ok: true, device: null };
  }
  metrics.incr("auth.fails");
  return { ok: false, reason: "auth_required" };
}

const registry = new SessionRegistry();
const crdt = new CrdtRelay();

// [persistence] Per-session debounced saver. Created lazily the first time a
// session is added / hydrated and torn down when the session is explicitly
// closed (`session.close`). Host restart leaves the snapshot file on disk so
// the next boot restores the archive.
const saveDebouncers = new Map<string, Debouncer>();

function snapshotFor(session: AnySession): SessionSnapshot {
  const meta = session.meta();
  const u = usage.get(session.id);
  return {
    meta: { ...meta, status: session.status, lastActiveAt: session.lastActiveAt },
    chat: session.chat.list(),
    ringTail: session.ringTail(),
    ...(u ? { usage: u } : {}),
  };
}

function scheduleSave(session: AnySession): void {
  let d = saveDebouncers.get(session.id);
  if (!d) {
    d = new Debouncer(() => saveSnapshot(snapshotFor(session)), 500);
    saveDebouncers.set(session.id, d);
  }
  d.schedule();
}

function flushSaveSync(session: AnySession): void {
  // Fire-and-forget immediate write — used for create/exit events where we
  // don't want to risk losing the snapshot to a 500ms jitter window.
  saveSnapshot(snapshotFor(session)).catch(() => {
    // persistence is best-effort
  });
}

function wirePersistence(session: AnySession): void {
  flushSaveSync(session);
  const unsubMsg = session.chat.onMessage(() => scheduleSave(session));
  const unsubUpd = session.chat.onUpdate(() => scheduleSave(session));
  if (session instanceof Session) {
    // Ring tail evolves with pty output; save debounced (message listener
    // already covers most mutations).
    const unsubOut = session.subscribe(() => scheduleSave(session));
    session.onExit(() => {
      unsubMsg();
      unsubUpd();
      unsubOut();
      flushSaveSync(session);
    });
    return;
  }
  session.onExit(() => {
    unsubMsg();
    unsubUpd();
    flushSaveSync(session);
  });
}

metrics.bindRegistry(registry);
metrics.start();

// [usage] Wire the per-session usage accumulator to broadcast every SDK
// result_message through to every connected client + re-render the session
// list so meta.usage propagates without an explicit refresh.
usage.setBroadcast((sid, u) => {
  broadcast({ v: 1, t: "usage.session", sid, usage: u });
  broadcast({ v: 1, t: "session.list", sessions: registry.list().map(sessionMetaWithSummary) });
});

// [federation] Remote host peers. Loaded from ~/.rcc/peers.json (0600). Each
// peer is a long-lived ws client against another RCC host; remote sessions
// are surfaced in the local sidebar with their sids prefixed `<peerId>:`
// and pty.in/session.attach/chat.* frames are transparently forwarded.
const peerStore = await PeerStore.load();
const peerClients = new Map<string, FederatedClient>();

function peersInfoList(): import("@rcc/protocol").PeerInfo[] {
  return [...peerClients.values()].map((c) => c.info());
}

function mergedSessionList(): import("@rcc/protocol").SessionMeta[] {
  const local = registry.list().map(sessionMetaWithSummary);
  const remote: import("@rcc/protocol").SessionMeta[] = [];
  for (const c of peerClients.values()) remote.push(...c.sessions());
  return [...local, ...remote];
}

function startPeer(cfg: PeerConfig): FederatedClient {
  const existing = peerClients.get(cfg.id);
  if (existing) existing.dispose();
  const client = new FederatedClient(
    cfg,
    (_peerId, frame) => {
      // Remote frame with sids already prefixed; relay to every local client.
      // We deliberately skip `hello` — the local hello is already sent with
      // its own session list, and re-broadcasting a remote hello would
      // confuse clients about tunnel / device / protocol metadata.
      if (frame.t === "hello") {
        // Use this as a signal the peer just (re)connected — refresh the
        // merged session list everyone sees.
        broadcast({ v: 1, t: "session.list", sessions: mergedSessionList() });
        return;
      }
      if (frame.t === "session.list") {
        // Re-merge: peer's list already stamped, but we want a unified list.
        broadcast({ v: 1, t: "session.list", sessions: mergedSessionList() });
        return;
      }
      if (frame.t === "session.created" || frame.t === "session.exited" || frame.t === "session.resumed") {
        broadcast(frame);
        broadcast({ v: 1, t: "session.list", sessions: mergedSessionList() });
        return;
      }
      broadcast(frame);
    },
    (info) => {
      broadcastFiltered({
        v: 1,
        t: "peer.status",
        peerId: info.id,
        connected: info.connected,
        error: info.error ?? null,
        sessionCount: info.sessionCount ?? 0,
      });
      // Session list may have changed (peer went from N → 0 sessions).
      broadcast({ v: 1, t: "session.list", sessions: mergedSessionList() });
    },
  );
  peerClients.set(cfg.id, client);
  client.start();
  return client;
}

for (const cfg of peerStore.list()) startPeer(cfg);
if (peerStore.list().length > 0) {
  console.log(`[rcc-host] federated peers: ${peerStore.list().map((p) => `${p.id}→${p.url}`).join(", ")}`);
}

// Approval watchers: one per session. Scan pty.out for Claude CLI y/n prompts
// and surface structured `approval.request` frames to all clients. The actual
// `broadcast()` function is defined further down; we route through a shim that
// captures the `wss` reference in its closure so watchers can be created
// before the ws server exists.
const approvalWatchers = new Map<string, ApprovalWatcher>();

// [activity] cross-session rolling event feed. Capped at 200, not persisted.
// Populated by approvals / crash / git.commits / version.check / session.exit
// emit sites via a single `activity.append` call. Clients pull the backlog
// with `activity.list.request` and then consume live `activity.append`.
const activity = new ActivityFeed((frame) => broadcast(frame));

// [updater] Real in-place self-upgrade. Owns a small state machine + abortable
// download. Broadcasts update.status / update.progress / update.ready so the
// web VersionBadge can render progress + "apply" UI. Initialised lazily below
// once the first request arrives so the host start path stays cheap.
let updaterInstance: Updater | null = null;
async function getUpdater(): Promise<Updater> {
  if (updaterInstance) return updaterInstance;
  updaterInstance = await Updater.create();
  updaterInstance.setHandlers({
    onStatus: (status) => broadcast({ v: 1, t: "update.status", status }),
    onProgress: (bytes, total) => broadcast({ v: 1, t: "update.progress", bytes, total }),
    onReady: (version) => broadcast({ v: 1, t: "update.ready", version }),
  });
  return updaterInstance;
}

// [plugins] M8 — dynamic-imported user plugins from ~/.rcc/plugins/*.
const pluginSessionCreatedBus = new PluginEventBus<import("@rcc/protocol").SessionMeta>();
const pluginSessionExitedBus = new PluginEventBus<string>();
const pluginHost = new PluginHost({
  listSessions: () => registry.list().map((s) => s.meta()),
  broadcastFrame: (frame) => broadcastFiltered(frame),
  onSessionCreatedBus: pluginSessionCreatedBus,
  onSessionExitedBus: pluginSessionExitedBus,
});
await pluginHost.loadAll();

function notifyPluginSessionCreated(s: AnySession): void {
  try {
    pluginSessionCreatedBus.emit(s.meta());
  } catch {
    // ignore
  }
  s.onExit(() => {
    try {
      pluginSessionExitedBus.emit(s.id);
    } catch {
      // ignore
    }
  });
}

function broadcastApproval(frame: Frame): void {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const share = (client as E2EWebSocket).rccShare;
    if (share && !isFrameAllowedForShare(frame, share.sid)) continue;
    sendToClient(client, frame);
  }
  // [activity] Mirror approval lifecycle into the inbox feed so Inbox 📥 sees
  // pending / resolved items without subscribing to approval.* directly.
  if (frame.t === "approval.request") {
    activity.append({
      kind: "approval",
      id: frame.id,
      sid: frame.sid,
      risk: frame.risk,
      tool: frame.tool,
      summary: frame.summary,
      timestamp: frame.timestamp,
      status: "pending",
    });
  } else if (frame.t === "approval.cleared") {
    activity.resolveApproval(frame.id);
  }
  // Side-effect: kick a Web Push on high-risk approval requests so users get
  // a lock-screen nudge. Low/medium pass silently to avoid notification
  // fatigue — the in-app approval sheet handles those. Throttled via a 5s
  // debounce: if multiple high-risk approvals arrive in that window, send one
  // aggregate notification instead of N individual pings (see pushHighRisk).
  if (frame.t === "approval.request" && frame.risk === "high") {
    pushHighRiskApproval(frame);
  }
}

// [push-throttle] Buffer high-risk approvals for 5s; on flush, emit either a
// single detailed notification (if exactly one in the window) or an aggregate
// count ("N 个高风险请求待审批"). Skips when no push subs exist, or when the
// only subscribed device is already actively connected via WebSocket (no point
// pushing to yourself — the in-app sheet is already visible).
interface PendingApproval {
  id: string;
  sid: string;
  tool: string;
  summary: string;
}
const PUSH_DEBOUNCE_MS = 5_000;
let pendingPushApprovals: PendingApproval[] = [];
let pushFlushTimer: ReturnType<typeof setTimeout> | null = null;
function pushHighRiskApproval(frame: Extract<Frame, { t: "approval.request" }>): void {
  pendingPushApprovals.push({
    id: frame.id,
    sid: frame.sid,
    tool: frame.tool,
    summary: frame.summary,
  });
  if (pushFlushTimer) return;
  pushFlushTimer = setTimeout(() => {
    pushFlushTimer = null;
    const batch = pendingPushApprovals;
    pendingPushApprovals = [];
    if (batch.length === 0) return;
    const subs = push.all();
    if (subs.length === 0) return;
    // "You're asking yourself" check: if every subscription maps to a device
    // that's currently connected, skip — the in-app UI has it covered.
    const connected = new Set<string>();
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const d = (client as E2EWebSocket).rccDevice;
      if (d?.id) connected.add(d.id);
    }
    const offlineSubs = subs.filter((s) => !s.deviceId || !connected.has(s.deviceId));
    if (offlineSubs.length === 0) return;
    let payload: PushPayload;
    if (batch.length === 1) {
      const a = batch[0]!;
      payload = {
        title: "⚠ 高风险审批",
        body: `${a.tool} · ${a.summary}`.slice(0, 80),
        tag: a.id,
        data: { url: "/#inbox", sid: a.sid, approvalId: a.id },
        requireInteraction: true,
      };
    } else {
      payload = {
        title: "⚠ 高风险审批",
        body: `${batch.length} 个高风险请求待审批`,
        tag: "approval-batch",
        data: { url: "/#inbox" },
        requireInteraction: true,
      };
    }
    const targetDeviceIds = offlineSubs
      .map((s) => s.deviceId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    // If some subs lack a deviceId, fall back to broadcast-all; 410 Gone is
    // auto-pruned by PushService.sendOne.
    const anyUnassigned = offlineSubs.some((s) => !s.deviceId);
    if (anyUnassigned || targetDeviceIds.length === 0) {
      void push.broadcast("all", payload);
    } else {
      void push.broadcast(targetDeviceIds, payload);
    }
  }, PUSH_DEBOUNCE_MS);
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
      activity.append({
        kind: "session_exit",
        id: randomUUID(),
        sid: session.id,
        title: session.meta().title ?? short,
        timestamp: Date.now(),
      });
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
    activity.append({
      kind: "session_exit",
      id: randomUUID(),
      sid: session.id,
      title: session.meta().title ?? short,
      timestamp: Date.now(),
    });
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
  // [B13-B] Every chat.* broadcast is stamped with a per-session monotonic
  // seq and pushed into the session's recent-frames ring. A reconnecting
  // client passes its last-seen seq via `session.attach.chatSince` and the
  // host replies with `chat.replay` to fill the gap.
  const unsub = session.chat.onMessage((message) => {
    metrics.incr("chat.msgs");
    indexChatAppend(session, message);
    // [B23-C] Auto-title from the very first user message on sessions that
    // don't have a manual title yet. Only runs for live sessions (DeadSession
    // never emits chat frames anyway) and only once per session — subsequent
    // user messages leave the title alone so edits stick.
    if (
      message.role === "user" &&
      !(session instanceof DeadSession) &&
      session.title === null
    ) {
      const derived = deriveAutoTitle(message);
      if (derived) {
        session.title = derived;
        scheduleSave(session);
        // Refresh the sidebar: title now differs from cwd-display.
        broadcast({ v: 1, t: "session.list", sessions: mergedSessionList() });
      }
    }
    const seq = session.nextChatFrameSeq();
    const frame: import("@rcc/protocol").ChatAppend = {
      v: 1,
      t: "chat.append",
      sid: session.id,
      message,
      seq,
    };
    session.recordChatFrame({ seq, frame });
    broadcast(frame);
  });
  // SDK driver also fires streaming segment updates; CLI driver never does.
  const unsubUpdate = session.chat.onUpdate((messageId, segmentIndex, segment) => {
    const seq = session.nextChatFrameSeq();
    const frame: import("@rcc/protocol").ChatUpdate = {
      v: 1,
      t: "chat.update",
      sid: session.id,
      messageId,
      segmentIndex,
      segment,
      seq,
    };
    session.recordChatFrame({ seq, frame });
    broadcast(frame);
  });
  // [B11-C] Fine-grained text-append deltas. Fires in addition to chat.update
  // for text segments that grow via pure append; lets future web-client
  // coalescers apply byte-level patches without re-sending segment state.
  // chat.update above remains the authoritative safety net for any client
  // that hasn't yet been wired to consume chat.delta.
  const unsubDelta = session.chat.onDelta((messageId, segmentIndex, textDelta) => {
    const seq = session.nextChatFrameSeq();
    const frame: import("@rcc/protocol").ChatDelta = {
      v: 1,
      t: "chat.delta",
      sid: session.id,
      messageId,
      segmentIndex,
      textDelta,
      seq,
    };
    session.recordChatFrame({ seq, frame });
    broadcast(frame);
  });
  session.onExit(() => {
    unsub();
    unsubUpdate();
    unsubDelta();
  });
}

// [metrics] Count pty output bytes once per session (host-side), not per
// subscriber, so the rate reflects raw Claude output volume.
function attachMetricsTap(session: AnySession): void {
  const unsub = session.subscribe((chunk) => {
    if (chunk.data) metrics.incr("pty.bytes.out", Buffer.byteLength(chunk.data, "utf8"));
  });
  session.onExit(() => unsub());
}

function attachSummaryOnExit(session: AnySession): void {
  if (session instanceof DeadSession) return;
  session.onExit(() => {
    void generateAndBroadcastSummary(session.id);
  });
}

// [git] Per-session GitWatcher. Polls branch/dirty/HEAD every 5s and broadcasts
// `git.status` on change; on new HEAD pushes a `git.commits` frame + appends a
// "✓ N commits during this session" system message into the chat. Non-git
// cwds silently report null status (client hides the widget).
const gitWatchers = new Map<string, GitWatcher>();

const searchIndex = new SearchIndex();
const sessionSummaries = new Map<string, import("@rcc/protocol").SessionSummary>();
const chatBySid = new Map<string, import("@rcc/protocol").ChatMessage[]>();

function indexChatAppend(session: AnySession, message: import("@rcc/protocol").ChatMessage): void {
  const list = chatBySid.get(session.id) ?? [];
  list.push(message);
  if (list.length > 200) list.shift();
  chatBySid.set(session.id, list);
  searchIndex.update(session.id, list, { id: session.id, title: session.meta().title, summaryTitle: sessionSummaries.get(session.id)?.title });
}

function sessionMetaWithSummary(session: AnySession): import("@rcc/protocol").SessionMeta {
  const base = session.meta();
  const summary = sessionSummaries.get(session.id);
  const u = usage.get(session.id);
  let out = base;
  if (summary) out = { ...out, summary };
  if (u) out = { ...out, usage: u };
  return out;
}

function buildRestCtx() {
  return {
    registry,
    projects,
    trust,
    shares,
    starters,
    defaultCwd: DEFAULT_CWD,
    defaultPermissionMode: DEFAULT_PERMISSION_MODE,
    claudeCommand: CLAUDE_COMMAND,
    claudeArgs: CLAUDE_ARGS,
    authenticate: (req: import("node:http").IncomingMessage) => {
      const r = authenticate(req);
      if (r.ok) return { ok: true, device: r.device ?? null };
      return { ok: false, device: null, reason: r.reason };
    },
    onSessionCreated: (s: AnySession) => {
      attachApprovalWatcher(s);
      attachChatBroadcast(s);
      attachMetricsTap(s);
      attachGitWatcher(s);
      attachSummaryOnExit(s);
      wirePersistence(s);
      broadcast({ v: 1, t: "session.created", session: s.meta() });
      broadcast({ v: 1, t: "session.list", sessions: mergedSessionList() });
      if (s instanceof SdkSession) {
        s.start().catch(() => {});
      }
    },
    resumeArchivedSession: (sid: string): AnySession | null => {
      const s = registry.get(sid);
      if (!(s instanceof DeadSession)) return null;
      const archivedChat = s.chat.list();
      const saver = saveDebouncers.get(s.id);
      if (saver) {
        saver.cancel();
        saveDebouncers.delete(s.id);
      }
      registry.remove(s.id);
      let live: AnySession;
      try {
        live = createSession({
          driver: s.driver,
          id: s.id,
          createdAt: s.createdAt,
          command: s.driver === "cli" ? CLAUDE_COMMAND : undefined,
          args: s.driver === "cli" ? CLAUDE_ARGS : undefined,
          cwd: s.cwd,
          cols: s.cols,
          rows: s.rows,
          permissionMode: s.permissionMode,
          projectId: s.projectId,
          initialChat: archivedChat,
        });
      } catch (err) {
        registry.add(s);
        throw err;
      }
      registry.add(live);
      // [B23-B/C] Preserve user-editable metadata (pinned/archived/tags/title)
      // across REST-initiated resume. The ws-side resume handler does this
      // inline; mirror it here so both paths behave identically.
      live.pinned = s.pinned;
      live.archived = s.archived;
      live.tags = [...s.tags];
      live.title = s.title;
      attachApprovalWatcher(live);
      attachChatBroadcast(live);
      attachMetricsTap(live);
      attachGitWatcher(live);
      attachSummaryOnExit(live);
      wirePersistence(live);
      broadcast({ v: 1, t: "session.resumed", session: live.meta() });
      broadcast({ v: 1, t: "session.list", sessions: mergedSessionList() });
      if (live instanceof SdkSession) {
        live.start().catch(() => {});
      }
      return live;
    },
    broadcast,
    sessionMetaWithSummary,
    mergedSessionList,
  };
}

async function generateAndBroadcastSummary(sid: string): Promise<void> {
  const chat = chatBySid.get(sid) ?? [];
  if (chat.length === 0) return;
  try {
    const summary = await summarizeSession({ sid, chat });
    sessionSummaries.set(sid, summary);
    const session = registry.get(sid);
    if (session) {
      searchIndex.setMeta(sid, { id: sid, title: session.meta().title, summaryTitle: summary.title });
    }
    broadcast({ v: 1, t: "summary", sid, summary });
    broadcast({ v: 1, t: "session.list", sessions: mergedSessionList() });
  } catch (err) {
    console.warn(`[rcc-host] summarize failed for ${sid}:`, err);
  }
}


/**
 * [B23-C] Derive a placeholder session title from the first user message.
 * Flattens the text segments, collapses whitespace, strips trailing sentence
 * punctuation, truncates at ~50 chars on a word boundary when possible, and
 * caps at 60 chars hard. Returns null when the message has no usable text.
 */
function deriveAutoTitle(message: import("@rcc/protocol").ChatMessage): string | null {
  const TARGET = 50;
  const HARD_CAP = 60;
  const text = message.segments
    .map((s) => {
      if (s.kind === "text" || s.kind === "thinking") return s.content;
      return "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (text.length <= TARGET) return text.slice(0, HARD_CAP);
  const slice = text.slice(0, TARGET);
  // Prefer cutting at the last word boundary so we don't split a word mid-way.
  // Fallback to a punctuation boundary, else a hard truncate with ellipsis.
  const ws = slice.lastIndexOf(" ");
  const trimmed = ws > TARGET * 0.6 ? slice.slice(0, ws) : slice;
  // Strip trailing punctuation the heuristic left behind (e.g. "help, ", "fix.").
  return trimmed.replace(/[\s,.;:!?·—–-]+$/u, "").slice(0, HARD_CAP) || null;
}

function gitLangFor(sub: string): string {
  if (sub === "diff" || sub === "show") return "diff";
  return "";
}

function attachGitWatcher(session: AnySession): void {
  if (session instanceof DeadSession) return;
  const watcher = new GitWatcher(session.cwd, {
    onStatus: (status) => {
      broadcast({ v: 1, t: "git.status", sid: session.id, status });
    },
    onCommits: (commits) => {
      broadcast({ v: 1, t: "git.commits", sid: session.id, commits });
      activity.append({
        kind: "commits",
        id: `commits-${session.id}-${commits[0]!.hash}`,
        sid: session.id,
        count: commits.length,
        subjects: commits.slice(0, 10).map((c) => c.subject),
        timestamp: Date.now(),
      });
      const lines = commits
        .slice(0, 20)
        .map((c) => `${c.hash}  ${c.subject}`)
        .join("\n");
      const more = commits.length > 20 ? `\n…(+${commits.length - 20} more)` : "";
      session.chat.appendMessage({
        id: `git-commit-${commits[0]!.hash}`,
        sid: session.id,
        role: "system",
        segments: [
          {
            kind: "text",
            content: `✓ ${commits.length} commit${commits.length === 1 ? "" : "s"} during this session`,
          },
          { kind: "code", lang: "", content: lines + more },
        ],
        timestamp: Date.now(),
      });
    },
  });
  gitWatchers.set(session.id, watcher);
  void watcher.start();
  session.onExit(() => {
    watcher.dispose();
    gitWatchers.delete(session.id);
  });
}

// Pinned slash command ids — loaded once from ~/.rcc/pinned-commands.json, kept
// in memory, and broadcast via `cmd.pinned` whenever mutated.
let pinnedCommandsCache: string[] = await loadPinned();

// [persistence] Sweep snapshots older than 30d before we load them — keeps
// ~/.rcc/sessions/ from growing unbounded across long host uptime.
void purgeStale().catch(() => {});

// [persistence] Restore exited-session archives from ~/.rcc/sessions/<sid>.json.
// Every snapshot is re-registered as a DeadSession regardless of the status it
// had on disk (previously-running sessions are dead because the host process
// is new). The client's hello frame advertises them with status:"exited" so
// the UI can show a "重开" button that fires `session.resume`.
const snapshots = await loadAllSnapshots().catch((err) => {
  console.warn("[rcc-host] failed to load session snapshots:", err);
  return [];
});
for (const snap of snapshots) {
  try {
    const dead = new DeadSession({
      id: snap.meta.id,
      createdAt: snap.meta.createdAt,
      meta: snap.meta,
      chat: snap.chat,
      ringTail: snap.ringTail,
    });
    registry.add(dead);
    chatBySid.set(snap.meta.id, [...snap.chat]);
    if (snap.meta.summary) sessionSummaries.set(snap.meta.id, snap.meta.summary);
    if (snap.usage) usage.hydrate(snap.meta.id, snap.usage);
    else if (snap.meta.usage) usage.hydrate(snap.meta.id, snap.meta.usage);
  } catch (err) {
    console.warn(`[rcc-host] failed to hydrate snapshot ${snap.meta.id}:`, err);
  }
}
searchIndex.rebuild(
  [...chatBySid.entries()].map(([sid, chat]) => ({
    sid,
    chat,
    meta: {
      id: sid,
      title: registry.get(sid)?.meta().title,
      summaryTitle: sessionSummaries.get(sid)?.title,
    },
  })),
);
if (snapshots.length > 0) {
  console.log(`[rcc-host] restored ${snapshots.length} session snapshot(s) from disk`);
}

// Only spawn a fresh bootstrap session on a truly cold start — otherwise the
// user reconnects to their archived set and picks one to resume.
if (registry.list().length === 0) {
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
  attachMetricsTap(boot);
  attachGitWatcher(boot);
  attachSummaryOnExit(boot);
  wirePersistence(boot);
  notifyPluginSessionCreated(boot);
  console.log(
    `[rcc-host] bootstrapped session ${boot.id} at ${boot.cwd} (permission: ${boot.permissionMode})`,
  );
}

type E2EWebSocket = WebSocket & {
  rccDevice?: PairedDevice | null;
  rccSharedKey?: string | null;
  /** Last seq we issued outbound on this connection. Starts at 0; first send
   * uses 1. uint32, wraps at 2^32 (practically unreachable). */
  rccOutboundSeq?: number;
  /** Per-connection replay state for inbound frames. Only populated when the
   * connection has a shared key (i.e. E2E is active). */
  rccReplay?: ReplayWindow;
  /** When set, this ws is a readonly share-token guest. No E2E, no mutations,
   * no frames for other sids ever get written. */
  rccShare?: { id: string; sid: string; expiresAt: number } | null;
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

/**
 * Fan-out helper that honours both E2E and share-guest filtering. Every
 * broadcast* function should route through this instead of hand-rolling a
 * `wss.clients` loop, otherwise share guests may leak config/mutation frames
 * they shouldn't see.
 */
function broadcastFiltered(frame: Frame): void {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const share = (client as E2EWebSocket).rccShare;
    if (share && !isFrameAllowedForShare(frame, share.sid)) continue;
    sendToClient(client, frame);
  }
}

function send(ws: WebSocket, frame: Frame): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  const share = (ws as E2EWebSocket).rccShare;
  if (share && !isFrameAllowedForShare(frame, share.sid)) return;
  sendToClient(ws, frame);
}

/**
 * Core outbound send with per-connection backpressure + rate limiting.
 *
 * - If `bufferedAmount` > 10MB, close(1013) and drop; ring buffer will
 *   replay lost pty.out on reconnect.
 * - If `bufferedAmount` > 1MB OR outbound byte budget exhausted, drop
 *   non-critical frames and emit a one-shot backpressure error so the UI
 *   can badge "slow". Critical frames (hello/error/approval.request/
 *   approval.cleared/update.ready) always go through.
 */
function sendToClient(ws: WebSocket, frame: Frame): void {
  const state = wsStates.get(ws);
  const critical = isCriticalFrame(frame.t);
  try {
    const buffered = (ws as WebSocket & { bufferedAmount?: number }).bufferedAmount ?? 0;
    if (buffered > BACKPRESSURE_CLOSE_THRESHOLD) {
      metrics.incr("ws.closes.backpressure");
      try {
        ws.close(WS_CLOSE_BACKPRESSURE, "backpressure");
      } catch {
        // ignore
      }
      return;
    }
    if (!critical && buffered > BACKPRESSURE_DROP_THRESHOLD) {
      metrics.incr("ws.drops.backpressure");
      if (state && !state.bpNotified) {
        state.bpNotified = true;
        try {
          const payload = frameForClient(ws as E2EWebSocket, {
            v: 1,
            t: "error",
            code: "backpressure",
            message: "client is slow; dropping non-critical frames",
          });
          ws.send(payload);
          metrics.incr("ws.bytes.out", Buffer.byteLength(payload, "utf8"));
          metrics.incr("ws.msgs.out");
        } catch {
          // ignore
        }
      }
      return;
    }
    if (state && buffered <= BACKPRESSURE_DROP_THRESHOLD && state.bpNotified) {
      state.bpNotified = false;
    }
    const payload = frameForClient(ws as E2EWebSocket, frame);
    const size = Buffer.byteLength(payload, "utf8");
    if (!critical && state && !state.limiters.outboundBytes.tryConsume(size)) {
      metrics.incr("ws.drops.rate_limit");
      return;
    }
    if (critical && state) {
      state.limiters.outboundBytes.tryConsume(size);
    }
    ws.send(payload);
    metrics.incr("ws.bytes.out", size);
    metrics.incr("ws.msgs.out");
  } catch (err) {
    console.error("[rcc-host] send error", err);
  }
}

/**
 * Filter outbound frames to what a readonly share guest is allowed to see.
 * Only frames scoped to the pinned sid (and benign meta like pong/error)
 * pass through. `session.list` is rewritten before reaching here — we don't
 * re-broadcast the full list to share guests; `send()` just drops it.
 */
function isFrameAllowedForShare(frame: Frame, sid: string): boolean {
  switch (frame.t) {
    case "pong":
    case "error":
    case "hello":
      return true;
    case "chat.append":
    case "chat.update":
    case "chat.delta":
    case "chat.list":
    case "chat.replay":
    case "chat.resetted":
    case "pty.out":
    case "session.exited":
      return frame.sid === sid;
    default:
      return false;
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

  const unsubExit = session.onExit((code) => {
    send(ws, { v: 1, t: "session.exited", sid: session.id, code });
  });
  state.exitUnsubs.set(session.id, unsubExit);
}

function auditCtx(_ws: WebSocket, state: WsState): { deviceId?: string; ip?: string } {
  return { deviceId: state.device?.id };
}

function handle(ws: WebSocket, state: WsState, frame: Frame): void {
  if (state.share) {
    // Readonly share guest. Only a tiny whitelist of frames is tolerated —
    // everything else (pty.in, session.*, approval.*, any config mutation)
    // is silently ignored. This is defense-in-depth: the client UI also
    // guards against sending these.
    switch (frame.t) {
      case "ping": {
        send(ws, { v: 1, t: "pong", ts: frame.ts });
        return;
      }
      case "session.attach": {
        // Only the pinned sid. Otherwise drop.
        if (frame.sid !== state.share.sid) return;
        const s = registry.get(state.share.sid);
        if (!s) return;
        if (s instanceof DeadSession) {
          send(ws, { v: 1, t: "chat.list", sid: s.id, messages: s.chat.list() });
        } else if (typeof frame.chatSince === "number") {
          // [B13-B] Same delta-replay path as the authenticated handler.
          const replay = s.replayChatFrames(frame.chatSince);
          send(ws, {
            v: 1,
            t: "chat.replay",
            sid: s.id,
            frames: replay.frames.map((f) => f.frame),
            lostCount: replay.lostCount,
            oldestSeq: replay.oldestSeq,
          });
        }
        attach(ws, state, s, frame.since ?? null);
        return;
      }
      case "chat.list.request": {
        if (frame.sid !== state.share.sid) return;
        const s = registry.get(frame.sid);
        if (!s) {
          send(ws, { v: 1, t: "chat.list", sid: frame.sid, messages: [] });
          return;
        }
        send(ws, { v: 1, t: "chat.list", sid: frame.sid, messages: s.chat.list() });
        return;
      }
      default:
        return;
    }
  }
  // [federation] If the frame carries a prefixed sid, route it to the owning
  // peer instead of the local registry. The peer will handle pty.in / attach
  // / etc. transparently and the response flows back via the peer frame
  // relay (which re-prefixes sids before forwarding to local clients).
  const sidBearing = (frame as Frame & { sid?: string }).sid;
  if (typeof sidBearing === "string") {
    const parsed = parseSid(sidBearing);
    if (parsed) {
      const peer = peerClients.get(parsed.peerId);
      if (peer) {
        const rewritten = rewriteLocalToRemote(frame, parsed.peerId);
        if (rewritten) peer.forward(rewritten);
        return;
      }
    }
  }
  switch (frame.t) {
    case "peer.list.request": {
      send(ws, { v: 1, t: "peer.list", peers: peersInfoList() });
      return;
    }
    case "peer.add": {
      const cfg: PeerConfig = {
        id: frame.id,
        url: frame.url,
        token: frame.token,
        label: frame.label,
        color: frame.color,
      };
      peerStore
        .add(cfg)
        .then(() => {
          startPeer(cfg);
          broadcastFiltered({ v: 1, t: "peer.list", peers: peersInfoList() });
          audit.write({
            kind: "peer.add",
            ...auditCtx(ws, state),
            details: { id: cfg.id, url: cfg.url, label: cfg.label },
          });
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "peer_add_failed",
            message: (err as Error).message,
          });
        });
      return;
    }
    case "peer.remove": {
      const existing = peerClients.get(frame.id);
      if (existing) {
        existing.dispose();
        peerClients.delete(frame.id);
      }
      peerStore
        .remove(frame.id)
        .then(() => {
          broadcastFiltered({ v: 1, t: "peer.list", peers: peersInfoList() });
          broadcast({ v: 1, t: "session.list", sessions: mergedSessionList() });
          audit.write({
            kind: "peer.remove",
            ...auditCtx(ws, state),
            details: { id: frame.id },
          });
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "peer_remove_failed",
            message: (err as Error).message,
          });
        });
      return;
    }
  }
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
      attachMetricsTap(s);
      attachGitWatcher(s);
      attachSummaryOnExit(s);
      wirePersistence(s);
      notifyPluginSessionCreated(s);
      send(ws, { v: 1, t: "session.created", session: s.meta() });
      send(ws, { v: 1, t: "session.list", sessions: mergedSessionList() });
      attach(ws, state, s, null);
      audit.write({
        kind: "session.new",
        ...auditCtx(ws, state),
        details: { sid: s.id, cwd, driver, projectId: project.id, starterId: frame.starterId },
      });
      // SDK sessions need an explicit `start()` to open the query stream.
      // Failures surface as system chat messages (and close the session); we
      // also emit a one-shot error frame so the client doesn't have to
      // parse chat to discover the problem.
      if (s instanceof SdkSession) {
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
      // DeadSession archives ship their chat history in one go so reattaching
      // clients see the full timeline without a separate chat.list.request.
      if (s instanceof DeadSession) {
        send(ws, { v: 1, t: "chat.list", sid: s.id, messages: s.chat.list() });
      } else if (typeof frame.chatSince === "number") {
        // [B13-B] Live session + client has a chat-frame cursor — send the
        // delta since that seq so the transcript catches up without a full
        // chat.list re-render. lostCount > 0 signals a ring-buffer miss and
        // the client falls back to chat.list.request on its own.
        const replay = s.replayChatFrames(frame.chatSince);
        send(ws, {
          v: 1,
          t: "chat.replay",
          sid: s.id,
          frames: replay.frames.map((f) => f.frame),
          lostCount: replay.lostCount,
          oldestSeq: replay.oldestSeq,
        });
      }
      attach(ws, state, s, frame.since ?? null);
      return;
    }
    case "session.resume": {
      const s = registry.get(frame.sid);
      if (!(s instanceof DeadSession)) {
        send(ws, {
          v: 1,
          t: "error",
          code: "session_not_resumable",
          message: frame.sid,
          sid: frame.sid,
        });
        return;
      }
      // Snapshot the archive before we swap it out — we need its chat history
      // to seed the new live session so the timeline continues uninterrupted.
      const archivedChat = s.chat.list();
      const saver = saveDebouncers.get(s.id);
      if (saver) {
        saver.cancel();
        saveDebouncers.delete(s.id);
      }
      registry.remove(s.id);
      let live: AnySession;
      try {
        live = createSession({
          driver: s.driver,
          id: s.id,
          createdAt: s.createdAt,
          command: s.driver === "cli" ? CLAUDE_COMMAND : undefined,
          args: s.driver === "cli" ? CLAUDE_ARGS : undefined,
          cwd: s.cwd,
          cols: s.cols,
          rows: s.rows,
          permissionMode: s.permissionMode,
          projectId: s.projectId,
          initialChat: archivedChat,
          // We intentionally don't replay the old ringTail here — the CLI
          // writes a fresh banner on start and the archive was already shown
          // once via attach().
        });
      } catch (err) {
        // Put the archive back so the UI still has something to show.
        registry.add(s);
        send(ws, {
          v: 1,
          t: "error",
          code: "session_resume_failed",
          message: (err as Error).message,
          sid: frame.sid,
        });
        return;
      }
      registry.add(live);
      // [B23-B] Preserve user-editable metadata across resume.
      live.pinned = s.pinned;
      live.archived = s.archived;
      live.tags = [...s.tags];
      // [B23-C] Carry over the custom title (manual rename / auto-title)
      // across resume so the sidebar stays stable.
      live.title = s.title;
      attachApprovalWatcher(live);
      attachChatBroadcast(live);
      attachMetricsTap(live);
      attachGitWatcher(live);
      attachSummaryOnExit(live);
      wirePersistence(live);
      notifyPluginSessionCreated(live);
      // Notify every client so their sidebars flip running/dot colour.
      broadcast({ v: 1, t: "session.resumed", session: live.meta() });
      broadcast({ v: 1, t: "session.list", sessions: mergedSessionList() });
      audit.write({
        kind: "session.resume",
        ...auditCtx(ws, state),
        details: { sid: live.id, driver: live.driver },
      });
      // Caller attaches to the resumed session so pty output starts flowing.
      attach(ws, state, live, null);
      if (live instanceof SdkSession) {
        live.start().catch((err: Error) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "sdk_start_failed",
            message: err.message,
            sid: live.id,
          });
        });
      }
      return;
    }
    case "session.fork": {
      // [B23-A] Fork: create a new session seeded with the source's chat
      // messages up to and including `uptoMessageId`. Inherits cwd / project /
      // permissionMode / driver from the source. Falls back to default cwd
      // when inheritCwd === false.
      const src = registry.get(frame.sid);
      if (!src) {
        send(ws, { v: 1, t: "error", code: "no_such_session", message: frame.sid, sid: frame.sid });
        return;
      }
      const all = src.chat.list();
      const idx = all.findIndex((m) => m.id === frame.uptoMessageId);
      if (idx < 0) {
        send(ws, {
          v: 1,
          t: "error",
          code: "no_such_message",
          message: frame.uptoMessageId,
          sid: frame.sid,
        });
        return;
      }
      const sliced = all.slice(0, idx + 1);
      const inheritCwd = frame.inheritCwd !== false;
      const driver = src.driver;
      const forkCwd = inheritCwd ? src.cwd : projects.getDefault().cwd;
      const s = registry.create({
        driver,
        command: driver === "cli" ? CLAUDE_COMMAND : undefined,
        args: driver === "cli" ? CLAUDE_ARGS : undefined,
        cwd: forkCwd,
        cols: src.cols,
        rows: src.rows,
        permissionMode: src.permissionMode,
        projectId: inheritCwd ? src.projectId : null,
        initialChat: sliced,
      });
      attachApprovalWatcher(s);
      attachChatBroadcast(s);
      attachMetricsTap(s);
      attachGitWatcher(s);
      attachSummaryOnExit(s);
      wirePersistence(s);
      notifyPluginSessionCreated(s);
      broadcast({ v: 1, t: "session.created", session: s.meta() });
      broadcast({ v: 1, t: "session.list", sessions: mergedSessionList() });
      attach(ws, state, s, null);
      audit.write({
        kind: "session.fork",
        ...auditCtx(ws, state),
        details: { sid: s.id, sourceSid: frame.sid, uptoMessageId: frame.uptoMessageId, count: sliced.length },
      });
      if (s instanceof SdkSession) {
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
    case "session.close": {
      registry.close(frame.sid);
      crdt.dropSession(frame.sid);
      const saver = saveDebouncers.get(frame.sid);
      if (saver) {
        saver.cancel();
        saveDebouncers.delete(frame.sid);
      }
      // Per-session in-memory state: drop so long-lived hosts don't accumulate
      // unbounded entries across many create/close cycles.
      chatBySid.delete(frame.sid);
      sessionSummaries.delete(frame.sid);
      usage.reset(frame.sid);
      searchIndex.remove(frame.sid);
      void deleteSnapshot(frame.sid).catch(() => {});
      send(ws, { v: 1, t: "session.list", sessions: mergedSessionList() });
      audit.write({ kind: "session.close", ...auditCtx(ws, state), details: { sid: frame.sid } });
      return;
    }
    case "session.meta.set": {
      // [B23-B] Partial update of user-editable session metadata (pinned /
      // archived / tags). Silently ignores unknown sids so stale clients don't
      // blow up the host; broadcasts the refreshed session.list on success.
      // [B23-C] Also accepts `title`: a non-empty string becomes the new
      // display title; `null` clears any custom title so the sidebar falls
      // back to the cwd-display.
      const s = registry.get(frame.sid);
      if (!s) return;
      if (frame.pinned !== undefined) s.pinned = frame.pinned;
      if (frame.archived !== undefined) s.archived = frame.archived;
      if (frame.tags !== undefined) {
        // Normalize: trim, drop empties, dedupe.
        const seen = new Set<string>();
        s.tags = frame.tags
          .map((t) => t.trim())
          .filter((t) => t.length > 0 && !seen.has(t) && seen.add(t));
      }
      if (frame.title !== undefined) {
        if (frame.title === null) {
          s.title = null;
        } else {
          const trimmed = frame.title.trim().slice(0, 200);
          s.title = trimmed.length > 0 ? trimmed : null;
        }
      }
      scheduleSave(s);
      broadcast({ v: 1, t: "session.list", sessions: mergedSessionList() });
      return;
    }
    case "pty.in": {
      registry.get(frame.sid)?.write(frame.data);
      metrics.incr("pty.bytes.in", Buffer.byteLength(frame.data, "utf8"));
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
    case "metrics.subscribe": {
      state.metricsSubscribed = true;
      send(ws, { v: 1, t: "metrics.tick", snapshot: metrics.snapshot() });
      return;
    }
    case "metrics.unsubscribe": {
      state.metricsSubscribed = false;
      return;
    }
    case "git.status.request": {
      const s = registry.get(frame.sid);
      if (!s) {
        send(ws, { v: 1, t: "git.status", sid: frame.sid, status: null });
        return;
      }
      // Fire a fresh read — the watcher may be seconds away from its next poll
      // and the client asked for current state.
      getGitStatus(s.cwd).then(
        (status) => send(ws, { v: 1, t: "git.status", sid: frame.sid, status }),
        () => send(ws, { v: 1, t: "git.status", sid: frame.sid, status: null }),
      );
      return;
    }
    case "git.exec.request": {
      const s = registry.get(frame.sid);
      if (!s) {
        send(ws, {
          v: 1,
          t: "git.exec.result",
          sid: frame.sid,
          args: frame.args,
          ok: false,
          stdout: "",
          stderr: "no such session",
          code: null,
        });
        return;
      }
      if (!isReadOnlyGitArgs(frame.args)) {
        send(ws, {
          v: 1,
          t: "git.exec.result",
          sid: frame.sid,
          args: frame.args,
          ok: false,
          stdout: "",
          stderr: `refused: ${frame.args[0]} is not a read-only git subcommand`,
          code: null,
        });
        return;
      }
      runGit(s.cwd, frame.args).then((r) => {
        send(ws, {
          v: 1,
          t: "git.exec.result",
          sid: frame.sid,
          args: frame.args,
          ok: r.ok,
          stdout: r.stdout,
          stderr: r.stderr,
          code: r.code,
        });
        // Also drop the output into chat as a system message so it survives
        // across clients and shows up in session history / persistence.
        const label = `git ${frame.args.join(" ")}`;
        const body = (r.ok ? r.stdout : r.stderr) || (r.ok ? "(no output)" : "(failed)");
        s.chat.appendMessage({
          id: `git-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sid: s.id,
          role: "system",
          segments: [
            { kind: "text", content: label },
            { kind: "code", lang: gitLangFor(frame.args[0]!), content: body },
          ],
          timestamp: Date.now(),
        });
      });
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
          quietHours: frame.quietHours,
        })
        .then(() => send(ws, { v: 1, t: "push.subscribed", ok: true }))
        .catch((err) => {
          console.warn("[rcc-host] push.subscribe failed:", err?.message ?? err);
          send(ws, { v: 1, t: "push.subscribed", ok: false });
        });
      return;
    }
    case "push.preferences.set": {
      // [B22-C] Apply quiet-hours prefs. With no endpoint, target every sub
      // owned by the authenticated device (loopback = all).
      void push.setPrefs({
        endpoint: frame.endpoint,
        deviceId: state.device?.id ?? null,
        quietHours: frame.quietHours,
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
        audit.write({
          kind: "auth.revoke",
          ...auditCtx(ws, state),
          details: { target: frame.deviceId },
        });
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
        audit.write({
          kind: "auth.rename",
          ...auditCtx(ws, state),
          details: { target: frame.deviceId, name: frame.name },
        });
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
        .create({ name: frame.name, cwd: frame.cwd, color: frame.color, systemPrompt: frame.systemPrompt })
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
        .update(frame.id, {
          cwd: frame.cwd,
          color: frame.color ?? undefined,
          systemPrompt: frame.systemPrompt,
        })
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
        .then((skills) => {
          send(ws, { v: 1, t: "skill.list", skills });
          audit.write({
            kind: "config.skill.toggle",
            ...auditCtx(ws, state),
            details: { id: frame.id, enabled: frame.enabled },
          });
        })
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
        .then((skills) => {
          send(ws, { v: 1, t: "skill.list", skills });
          audit.write({
            kind: "config.skill.save",
            ...auditCtx(ws, state),
            details: { scope: frame.scope, name: frame.name },
          });
        })
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
          audit.write({
            kind: "config.skill.delete",
            ...auditCtx(ws, state),
            details: { id: frame.id },
          });
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
          audit.write({
            kind: "config.mcp.add",
            ...auditCtx(ws, state),
            details: { name: frame.name, scope: frame.scope, transport: frame.transport },
          });
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
          audit.write({
            kind: "config.mcp.remove",
            ...auditCtx(ws, state),
            details: { name: frame.name, scope: frame.scope ?? null },
          });
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
          audit.write({
            kind: "config.hook.write",
            ...auditCtx(ws, state),
            details: {
              scope: frame.scope,
              event: frame.event,
              index: frame.index,
              matcher: frame.matcher,
              count: frame.hooks.length,
            },
          });
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
          audit.write({
            kind: "config.hook.delete",
            ...auditCtx(ws, state),
            details: { scope: frame.scope, event: frame.event, index: frame.index },
          });
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
          audit.write({
            kind: "config.permission.add",
            ...auditCtx(ws, state),
            details: { scope: frame.scope, bucket: frame.bucket, rule },
          });
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
          audit.write({
            kind: "config.permission.remove",
            ...auditCtx(ws, state),
            details: { scope: frame.scope, bucket: frame.bucket, rule: frame.rule },
          });
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
          audit.write({
            kind: "config.permission.set-default",
            ...auditCtx(ws, state),
            details: { scope: frame.scope, mode: frame.mode },
          });
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
        if ((client as E2EWebSocket).rccShare) continue;
        sendToClient(client, frame);
      }
      return;
    }
    case "summary.request": {
      const summary = sessionSummaries.get(frame.sid) ?? null;
      send(ws, { v: 1, t: "summary", sid: frame.sid, summary });
      return;
    }
    case "summary.refresh": {
      void generateAndBroadcastSummary(frame.sid);
      return;
    }
    case "search.request": {
      const matches = searchIndex.search(frame.query);
      send(ws, { v: 1, t: "search.result", query: frame.query, matches });
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
            plugins: cat.plugins,
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
    case "market.install.plugin": {
      installPluginFromCatalog(frame.id)
        .then((res) => {
          if (res.ok) {
            send(ws, {
              v: 1,
              t: "market.plugin.installed",
              id: frame.id,
              ok: true,
              pluginId: res.pluginId,
            });
          } else {
            send(ws, {
              v: 1,
              t: "market.plugin.installed",
              id: frame.id,
              ok: false,
              error: res.error,
            });
          }
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "market.plugin.installed",
            id: frame.id,
            ok: false,
            error: err?.message ?? String(err),
          });
        });
      return;
    }
    case "prefs.request": {
      send(ws, { v: 1, t: "prefs", prefs: prefs.get() });
      return;
    }
    case "share.list.request": {
      send(ws, {
        v: 1,
        t: "share.list",
        shares: shares.list(frame.sid ? { sid: frame.sid } : undefined).map(shareSummaryFor),
      });
      return;
    }
    case "prefs.update": {
      prefs
        .update(frame.prefs)
        .then((next) => {
          broadcastFiltered({ v: 1, t: "prefs", prefs: next });
          send(ws, { v: 1, t: "prefs.updated", prefs: next });
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "prefs_update_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "activity.list.request": {
      send(ws, { v: 1, t: "activity.list", items: activity.list() });
      return;
    }
    case "update.check.request": {
      getUpdater()
        .then(async (u) => {
          const status = await u.check(frame.force ?? true);
          send(ws, { v: 1, t: "update.status", status });
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "update_check_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "update.download.request": {
      getUpdater()
        .then((u) => {
          const cur = u.getStatus();
          if (cur.state === "downloading") return;
          void u.download();
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "update_download_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "update.abort.request": {
      getUpdater()
        .then((u) => u.abortDownload())
        .catch(() => {});
      return;
    }
    case "update.apply.request": {
      getUpdater()
        .then((u) => {
          void u.apply();
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "update_apply_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "record.start": {
      const s = registry.get(frame.sid);
      if (!(s instanceof Session)) {
        send(ws, {
          v: 1,
          t: "error",
          code: "record_unsupported",
          message: "only CLI (pty) sessions are recordable",
          sid: frame.sid,
        });
        return;
      }
      s.startRecording(s.meta().title)
        .then(() => broadcastRecordingStatus(frame.sid))
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "record_start_failed",
            message: err?.message ?? String(err),
            sid: frame.sid,
          });
        });
      return;
    }
    case "record.stop": {
      const s = registry.get(frame.sid);
      if (!(s instanceof Session)) {
        // still honour the request — send a status frame so the UI settles.
        void sendRecordingStatus(ws, frame.sid);
        return;
      }
      s.stopRecording()
        .then(() => broadcastRecordingStatus(frame.sid))
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "record_stop_failed",
            message: err?.message ?? String(err),
            sid: frame.sid,
          });
        });
      return;
    }
    case "record.status.request": {
      void sendRecordingStatus(ws, frame.sid);
      return;
    }
    case "workflow.list.request": {
      send(ws, { v: 1, t: "workflow.list", workflows: workflows.list() });
      return;
    }
    case "workflow.save": {
      workflows
        .save({
          id: frame.id,
          name: frame.name,
          description: frame.description,
          steps: frame.steps,
          variables: frame.variables,
        })
        .then((wf) => {
          send(ws, { v: 1, t: "workflow.saved", workflow: wf });
          broadcastFiltered({ v: 1, t: "workflow.list", workflows: workflows.list() });
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "workflow_save_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "workflow.remove": {
      workflows
        .remove(frame.id)
        .then((ok) => {
          if (ok) {
            send(ws, { v: 1, t: "workflow.removed", id: frame.id });
            broadcastFiltered({ v: 1, t: "workflow.list", workflows: workflows.list() });
          } else {
            send(ws, {
              v: 1,
              t: "error",
              code: "workflow_not_found",
              message: `no workflow with id ${frame.id}`,
            });
          }
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "workflow_remove_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "prompt.list.request": {
      send(ws, { v: 1, t: "prompt.list", prompts: prompts.list() });
      return;
    }
    case "prompt.save": {
      prompts
        .save({
          id: frame.id,
          name: frame.name,
          template: frame.template,
          description: frame.description,
        })
        .then((p) => {
          send(ws, { v: 1, t: "prompt.saved", prompt: p });
          broadcastFiltered({ v: 1, t: "prompt.list", prompts: prompts.list() });
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "prompt_save_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "prompt.remove": {
      prompts
        .remove(frame.id)
        .then((ok) => {
          if (ok) {
            send(ws, { v: 1, t: "prompt.removed", id: frame.id });
            broadcastFiltered({ v: 1, t: "prompt.list", prompts: prompts.list() });
          } else {
            send(ws, {
              v: 1,
              t: "error",
              code: "prompt_not_found",
              message: `no prompt with id ${frame.id}`,
            });
          }
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "prompt_remove_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "starter.list.request": {
      send(ws, { v: 1, t: "starter.list", starters: starters.list() });
      return;
    }
    case "audit.query.request": {
      audit
        .query({
          kind: frame.kind,
          since: frame.since,
          until: frame.until,
          limit: frame.limit,
        })
        .then((entries) => {
          send(ws, { v: 1, t: "audit.entries", entries });
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "audit_query_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "starter.save": {
      starters
        .save({
          id: frame.id,
          name: frame.name,
          description: frame.description,
          systemPrompt: frame.systemPrompt,
          enableSkills: frame.enableSkills,
          firstSteps: frame.firstSteps,
          permissionMode: frame.permissionMode,
          icon: frame.icon,
          color: frame.color,
        })
        .then((starter) => {
          send(ws, { v: 1, t: "starter.saved", starter });
          broadcastFiltered({ v: 1, t: "starter.list", starters: starters.list() });
          audit.write({
            kind: "config.starter.save",
            ...auditCtx(ws, state),
            details: { id: starter.id, name: starter.name },
          });
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "starter_save_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "starter.remove": {
      starters
        .remove(frame.id)
        .then((ok) => {
          if (ok) {
            send(ws, { v: 1, t: "starter.removed", id: frame.id });
            broadcastFiltered({ v: 1, t: "starter.list", starters: starters.list() });
            audit.write({
              kind: "config.starter.remove",
              ...auditCtx(ws, state),
              details: { id: frame.id },
            });
          } else {
            send(ws, {
              v: 1,
              t: "error",
              code: "starter_not_found",
              message: `no starter with id ${frame.id}`,
            });
          }
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "starter_remove_failed",
            message: err?.message ?? String(err),
          });
        });
      return;
    }
    case "plugin.list.request": {
      send(ws, { v: 1, t: "plugin.list", plugins: pluginHost.list() });
      return;
    }
    case "plugin.call": {
      const MAX_PAYLOAD = 256 * 1024;
      try {
        const encoded = JSON.stringify(frame.payload ?? null);
        if (Buffer.byteLength(encoded, "utf8") > MAX_PAYLOAD) {
          send(ws, {
            v: 1,
            t: "plugin.result",
            callId: frame.callId,
            pluginId: frame.pluginId,
            ok: false,
            error: "payload too large (>256KB)",
          });
          return;
        }
      } catch {
        send(ws, {
          v: 1,
          t: "plugin.result",
          callId: frame.callId,
          pluginId: frame.pluginId,
          ok: false,
          error: "payload not serialisable",
        });
        return;
      }
      pluginHost
        .call(frame.pluginId, frame.method, frame.payload)
        .then((res) => {
          if (res.ok) {
            send(ws, {
              v: 1,
              t: "plugin.result",
              callId: frame.callId,
              pluginId: frame.pluginId,
              ok: true,
              data: res.data,
            });
          } else {
            send(ws, {
              v: 1,
              t: "plugin.result",
              callId: frame.callId,
              pluginId: frame.pluginId,
              ok: false,
              error: res.error,
            });
          }
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "plugin.result",
            callId: frame.callId,
            pluginId: frame.pluginId,
            ok: false,
            error: err?.message ?? String(err),
          });
        });
      return;
    }
    case "notebook.request": {
      notebooks
        .get(frame.sid)
        .then((notebook) => {
          send(ws, { v: 1, t: "notebook", sid: frame.sid, notebook: notebook ?? null });
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "notebook_load_failed",
            message: err?.message ?? String(err),
            sid: frame.sid,
          });
        });
      return;
    }
    case "notebook.upsert": {
      notebooks
        .upsert(frame.sid, frame.cells)
        .then((nb) => {
          send(ws, { v: 1, t: "notebook.upserted", sid: frame.sid, notebook: nb });
          broadcastFiltered({ v: 1, t: "notebook", sid: frame.sid, notebook: nb });
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "notebook_upsert_failed",
            message: err?.message ?? String(err),
            sid: frame.sid,
          });
        });
      return;
    }
    case "notebook.append": {
      notebooks
        .append(frame.sid, frame.cell)
        .then((nb) => {
          broadcastFiltered({ v: 1, t: "notebook", sid: frame.sid, notebook: nb });
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "notebook_append_failed",
            message: err?.message ?? String(err),
            sid: frame.sid,
          });
        });
      return;
    }
    case "notebook.delete": {
      notebooks
        .remove(frame.sid)
        .then(() => {
          send(ws, { v: 1, t: "notebook.deleted", sid: frame.sid });
          broadcastFiltered({ v: 1, t: "notebook", sid: frame.sid, notebook: null });
        })
        .catch((err) => {
          send(ws, {
            v: 1,
            t: "error",
            code: "notebook_delete_failed",
            message: err?.message ?? String(err),
            sid: frame.sid,
          });
        });
      return;
    }
    default:
      return;
  }
}

function broadcastMcpList(servers: Parameters<typeof listMcp> extends any ? Awaited<ReturnType<typeof listMcp>> : never): void {
  broadcastFiltered({ v: 1, t: "mcp.list", servers });
}

async function buildRecordingStatus(sid: string): Promise<import("@rcc/protocol").RecordingStatusData> {
  const s = registry.get(sid);
  const live = s instanceof Session ? s.recordingStatus() : null;
  const hasFile = await recordingFileExists(sid);
  const fileSize = hasFile ? await recordingFileSize(sid) : 0;
  return {
    sid,
    recording: !!live?.recording,
    // Prefer live in-memory byte count while recording (file is buffered by the
    // OS write stream) — falls back to on-disk size once sealed.
    size: live?.recording ? live.size : fileSize,
    startedAt: live?.startedAt ?? null,
    hasFile,
    capped: !!live?.capped,
  };
}

async function sendRecordingStatus(ws: WebSocket, sid: string): Promise<void> {
  const status = await buildRecordingStatus(sid);
  send(ws, { v: 1, t: "record.status", status });
}

async function broadcastRecordingStatus(sid: string): Promise<void> {
  const status = await buildRecordingStatus(sid);
  broadcastFiltered({ v: 1, t: "record.status", status });
}

function broadcastPinned(): void {
  broadcastFiltered({ v: 1, t: "cmd.pinned", ids: pinnedCommandsCache });
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
      broadcastFiltered({ v: 1, t: "cmd.list", commands: payload });
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
      broadcastFiltered({ v: 1, t: "subagent.list", agents: payload });
    })
    .catch(() => {});
}

function broadcastHookList(): void {
  listHooks("all", DEFAULT_CWD)
    .then((configs) => {
      broadcastFiltered({ v: 1, t: "hook.list", configs });
    })
    .catch(() => {});
}

function broadcastMcp(server: Awaited<ReturnType<typeof listMcp>>[number], kind: "added"): void {
  if (kind === "added") broadcastFiltered({ v: 1, t: "mcp.added", server });
}

function broadcastMcpRemoved(name: string): void {
  broadcastFiltered({ v: 1, t: "mcp.removed", name });
}

function broadcastPermList(): void {
  listPermissions(DEFAULT_CWD)
    .then((configs) => {
      broadcastFiltered({ v: 1, t: "perm.list", configs });
    })
    .catch(() => {});
}

function broadcastProjectList(): void {
  broadcastFiltered({ v: 1, t: "project.list", projects: projects.list() });
}

function broadcastDeviceList(): void {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if ((client as E2EWebSocket).rccShare) continue;
    const d = (client as E2EWebSocket).rccDevice;
    sendToClient(client, {
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
    });
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

async function handleShareRoute(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  createdBy: string | null,
): Promise<void> {
  const url = req.url ?? "";
  const writeJson = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (url === "/share/new" && req.method === "POST") {
    const body = await readJsonBody<{ sid?: string; ttlMinutes?: number }>(req);
    if (!body.sid || typeof body.sid !== "string") {
      writeJson(400, { error: "sid required" });
      return;
    }
    const s = registry.get(body.sid);
    if (!s) {
      writeJson(404, { error: "no_such_session" });
      return;
    }
    const ttl = Number.isFinite(body.ttlMinutes) ? Number(body.ttlMinutes) : 60;
    if (ttl <= 0 || ttl > 60 * 24 * 7) {
      writeJson(400, { error: "ttlMinutes out of range (1 .. 10080)" });
      return;
    }
    const { entry, token } = await shares.create({
      sid: body.sid,
      ttlMinutes: ttl,
      createdBy,
    });
    const host = (req.headers["host"] as string | undefined) ?? "localhost";
    const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
    const shareUrl = `${proto}://${host}/?share=${encodeURIComponent(token)}`;
    writeJson(200, {
      id: entry.id,
      token,
      url: shareUrl,
      sid: entry.sid,
      expiresAt: entry.expiresAt,
    });
    broadcastFiltered({
      v: 1,
      t: "share.list",
      shares: shares.list().map(shareSummaryFor),
    });
    audit.write({
      kind: "share.new",
      deviceId: createdBy ?? undefined,
      ip: req.socket.remoteAddress ?? undefined,
      details: { id: entry.id, sid: entry.sid, ttlMinutes: ttl, expiresAt: entry.expiresAt },
    });
    return;
  }
  if (url.startsWith("/share/list") && req.method === "GET") {
    const qIdx = url.indexOf("?");
    const params = qIdx >= 0 ? new URLSearchParams(url.slice(qIdx + 1)) : new URLSearchParams();
    const sid = params.get("sid") ?? undefined;
    writeJson(200, {
      shares: shares.list({ sid }).map(shareSummaryFor),
    });
    return;
  }
  const matchDel = /^\/share\/([^/?]+)(?:\?.*)?$/.exec(url);
  if (matchDel && req.method === "DELETE") {
    const id = decodeURIComponent(matchDel[1]!);
    const ok = await shares.revoke(id);
    if (!ok) {
      writeJson(404, { error: "unknown share" });
      return;
    }
    // Kick any live share ws bound to this id so access ends immediately.
    for (const client of wss.clients) {
      const s = (client as E2EWebSocket).rccShare;
      if (s && s.id === id) {
        try {
          client.close(4410, "share_revoked");
        } catch {
          // ignore
        }
      }
    }
    writeJson(200, { ok: true });
    broadcastFiltered({
      v: 1,
      t: "share.list",
      shares: shares.list().map(shareSummaryFor),
    });
    audit.write({
      kind: "share.revoke",
      deviceId: createdBy ?? undefined,
      ip: req.socket.remoteAddress ?? undefined,
      details: { id },
    });
    return;
  }
  writeJson(404, { error: "unknown share route" });
}

function shareSummaryFor(entry: import("./shares.ts").ShareEntry): {
  id: string;
  sid: string;
  createdAt: number;
  expiresAt: number;
  createdBy: string | null;
  revoked: boolean;
} {
  return {
    id: entry.id,
    sid: entry.sid,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    createdBy: entry.createdBy,
    revoked: entry.revoked,
  };
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
      onClaimed: (info) => {
        audit.write({
          kind: "auth.pair",
          deviceId: info.deviceId,
          ip: info.ip ?? undefined,
          details: { name: info.deviceName, userAgent: info.userAgent },
        });
      },
    })
  ) {
    return;
  }

  // REST API — /api/v1/* + /api/openapi.json. Dispatches to rest.ts which
  // mirrors the main ws frames over HTTP for curl / Postman / 3rd-party use.
  if (req.url?.startsWith("/api/v1/") || req.url?.startsWith("/api/openapi")) {
    await handleRestRoute(req, res, buildRestCtx());
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

  // [updater] POST /update/check | /update/download | /update/apply — drive
  // the real self-upgrade flow. Each action fires asynchronously; progress /
  // status / ready frames are pushed over ws. All three require a device
  // token (loopback is trusted the same as every other privileged endpoint)
  // so a public tunnel can't initiate an upgrade.
  if (req.url === "/update/check" && req.method === "POST") {
    const auth = authenticate(req);
    if (!auth.ok) {
      res.writeHead(401, { "content-type": "application/json", "x-rcc-auth-reason": auth.reason });
      res.end(JSON.stringify({ error: auth.reason }));
      return;
    }
    try {
      const u = await getUpdater();
      const status = await u.check(true);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(status));
    } catch (err: any) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err?.message ?? String(err) }));
    }
    return;
  }
  if (req.url === "/update/download" && req.method === "POST") {
    const auth = authenticate(req);
    if (!auth.ok) {
      res.writeHead(401, { "content-type": "application/json", "x-rcc-auth-reason": auth.reason });
      res.end(JSON.stringify({ error: auth.reason }));
      return;
    }
    try {
      const u = await getUpdater();
      void u.download();
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ accepted: true, status: u.getStatus() }));
    } catch (err: any) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err?.message ?? String(err) }));
    }
    return;
  }
  if (req.url === "/update/apply" && req.method === "POST") {
    const auth = authenticate(req);
    if (!auth.ok) {
      res.writeHead(401, { "content-type": "application/json", "x-rcc-auth-reason": auth.reason });
      res.end(JSON.stringify({ error: auth.reason }));
      return;
    }
    try {
      const u = await getUpdater();
      void u.apply();
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ accepted: true }));
    } catch (err: any) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err?.message ?? String(err) }));
    }
    return;
  }

  if (req.url === "/metrics" && req.method === "GET") {
    const auth = authenticate(req);
    if (!auth.ok) {
      res.writeHead(401, { "content-type": "application/json", "x-rcc-auth-reason": auth.reason });
      res.end(JSON.stringify({ error: auth.reason }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(metrics.snapshot()));
    return;
  }

  // [shares] — create / list / revoke readonly session share tokens.
  // All routes require a real device token (loopback too, same as every
  // other privileged endpoint). The resulting URL is built from the Host
  // header so tunneled / named-tunnel hosts return the right absolute URL.
  if (req.url?.startsWith("/share")) {
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
      await handleShareRoute(req, res, auth.device?.id ?? null);
    } catch (err: any) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err?.message ?? "share failed" }));
      }
    }
    return;
  }

  // [recording] GET /recording/<sid>.cast streams the asciinema v2 file for
  // playback, DELETE /recording/<sid> removes it. Both require a valid device
  // token; loopback is trusted the same as every other endpoint. The sid is
  // sanitised against traversal before it ever touches the filesystem.
  {
    const recUrl = req.url ?? "";
    const mGet = /^\/recording\/([A-Za-z0-9_-]+)\.cast(?:\?.*)?$/.exec(recUrl);
    const mDel = /^\/recording\/([A-Za-z0-9_-]+)(?:\?.*)?$/.exec(recUrl);
    if (mGet && req.method === "GET") {
      const auth = authenticate(req);
      if (!auth.ok) {
        res.writeHead(401, {
          "content-type": "application/json",
          "x-rcc-auth-reason": auth.reason,
        });
        res.end(JSON.stringify({ error: auth.reason }));
        return;
      }
      const sid = mGet[1]!;
      const path = recordingPathFor(sid);
      try {
        const st = await stat(path);
        res.writeHead(200, {
          "content-type": "application/x-asciicast; charset=utf-8",
          "content-length": String(st.size),
          "cache-control": "no-store",
        });
        const stream = createReadStream(path);
        stream.pipe(res);
        stream.on("error", () => {
          if (!res.writableEnded) res.end();
        });
      } catch {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "recording not found" }));
      }
      return;
    }
    if (mDel && req.method === "DELETE" && !recUrl.endsWith(".cast")) {
      const auth = authenticate(req);
      if (!auth.ok) {
        res.writeHead(401, {
          "content-type": "application/json",
          "x-rcc-auth-reason": auth.reason,
        });
        res.end(JSON.stringify({ error: auth.reason }));
        return;
      }
      const sid = mDel[1]!;
      const ok = await deleteRecording(sid);
      res.writeHead(ok ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(ok ? { ok: true } : { error: "not found" }));
      if (ok) void broadcastRecordingStatus(sid);
      return;
    }
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

  // [plugins] GET /plugins/:id/* — authenticated static file serving for a
  // plugin's UI bundle (if it declared a `ui` dir). iframe-hosted plugin UIs
  // pass the device token via ?token=... on the URL because iframes can't set
  // Authorization headers.
  {
    const m = /^\/plugins\/([a-z0-9-]+)\/(.*?)(?:\?.*)?$/.exec(req.url ?? "");
    if (m && req.method === "GET") {
      const auth = authenticate(req);
      if (!auth.ok) {
        res.writeHead(401, {
          "content-type": "application/json",
          "x-rcc-auth-reason": auth.reason,
        });
        res.end(JSON.stringify({ error: auth.reason }));
        return;
      }
      const pid = m[1]!;
      const rel = m[2] ?? "";
      const path = pluginHost.resolveUiAsset(pid, rel);
      if (!path) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "plugin asset not found" }));
        return;
      }
      try {
        const body = await readFile(path);
        const ext = extname(path).toLowerCase();
        res.writeHead(200, {
          "content-type": MIME[ext] ?? "application/octet-stream",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        res.end(body);
      } catch {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "plugin asset not found" }));
      }
      return;
    }
  }

  // Serve the built web bundle when present.
  const served = await serveStatic(
    req.url ?? "/",
    typeof req.headers["accept-encoding"] === "string" ? req.headers["accept-encoding"] : undefined,
  );
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
  // Share-token path: look for ?share=<token> before device auth. If it
  // verifies, skip the device token / E2E path entirely and stamp the ws
  // readonly. Valid share tokens implicitly grant ws access.
  const shareTok = shareTokenFromReq(req);
  if (shareTok) {
    const v = shares.verify(shareTok);
    if (!v.ok) {
      socket.write(
        `HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nX-RCC-Auth-Reason: share_${v.reason}\r\n\r\n`,
      );
      socket.destroy();
      return;
    }
    // Session must still exist (it could have been closed after the share
    // was minted). If so, reject rather than dropping into a broken hello.
    const s = registry.get(v.entry.sid);
    if (!s) {
      socket.write(
        `HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nX-RCC-Auth-Reason: share_session_gone\r\n\r\n`,
      );
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const eWs = ws as E2EWebSocket;
      eWs.rccDevice = null;
      eWs.rccSharedKey = null;
      eWs.rccOutboundSeq = 0;
      eWs.rccShare = {
        id: v.entry.id,
        sid: v.entry.sid,
        expiresAt: v.entry.expiresAt,
      };
      wss.emit("connection", ws, req);
    });
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
    eWs.rccShare = null;
    if (eWs.rccSharedKey) eWs.rccReplay = new ReplayWindow();
    wss.emit("connection", ws, req);
  });
});

function shareTokenFromReq(req: { url?: string }): string | null {
  if (!req.url) return null;
  const qIdx = req.url.indexOf("?");
  if (qIdx < 0) return null;
  const params = new URLSearchParams(req.url.slice(qIdx + 1));
  return params.get("share");
}

const tunnel: Tunnel | null = startTunnel(TUNNEL_CONFIG, PORT);

function currentTunnelInfo(): TunnelInfo | undefined {
  if (!tunnel) return undefined;
  return tunnel.getStatus();
}

// Track per-ws state so the outer loop (e.g. metrics ticker) can read
// subscription flags without threading WsState through every closure.
const wsStates = new WeakMap<WebSocket, WsState>();

function broadcast(frame: Frame): void {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const share = (client as E2EWebSocket).rccShare;
    if (share && !isFrameAllowedForShare(frame, share.sid)) continue;
    sendToClient(client, frame);
  }
}

metrics.bindWsStats(() => {
  let subscribers = 0;
  let connections = 0;
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    connections++;
    const st = wsStates.get(client);
    if (st?.metricsSubscribed) subscribers++;
  }
  return { connections, subscribers };
});

// Push metrics tick to subscribed clients every 2s. Interval is unref'd so it
// never blocks shutdown; subscribe gating keeps idle clients quiet.
const metricsTickTimer = setInterval(() => {
  let needed = false;
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const st = wsStates.get(client);
    if (st?.metricsSubscribed) {
      needed = true;
      break;
    }
  }
  if (!needed) return;
  const snapshot = metrics.snapshot();
  const frame: Frame = { v: 1, t: "metrics.tick", snapshot };
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const st = wsStates.get(client);
    if (!st?.metricsSubscribed) continue;
    sendToClient(client, frame);
  }
}, 2000);
if (typeof metricsTickTimer === "object" && metricsTickTimer && "unref" in metricsTickTimer) {
  (metricsTickTimer as { unref: () => void }).unref();
}

installCrashHandler((frame) => {
  metrics.incr("crashes");
  activity.append({
    kind: "crash",
    id: `crash-${frame.at}`,
    at: frame.at,
    message: frame.message,
    type: frame.type,
  });
  broadcast(frame);
  audit.write({
    kind: "crash",
    ts: frame.at,
    details: { message: frame.message, type: frame.type },
  });
});

// [watchdog] Sample RSS / active-handle count / session count every 60s and
// broadcast `health.warn` when any exceeds its threshold. Non-fatal — the
// host stays up; clients render a toast + badge so operators can intervene.
const watchdog = new Watchdog({
  sessionCount: () => registry.list().length,
  broadcast: (frame) => broadcast(frame),
});
watchdog.start();

// [activity] Periodic update probe — once at boot + every 6h. Only emits an
// item when the latest version differs from the last one we announced, so
// the inbox doesn't fill with repeats.
let lastAnnouncedUpdate: string | null = null;
async function probeUpdate(): Promise<void> {
  try {
    const r = await checkForUpdates(false);
    if (r.configured && "available" in r && r.available && r.latest !== lastAnnouncedUpdate) {
      lastAnnouncedUpdate = r.latest;
      activity.append({
        kind: "update",
        id: `update-${r.latest}`,
        latest: r.latest,
        notes: r.notes,
        timestamp: Date.now(),
      });
      audit.write({
        kind: "update.available",
        details: { current: r.current, latest: r.latest },
      });
    }
  } catch {
    // ignore — best-effort
  }
}
void probeUpdate();
const updateProbeTimer = setInterval(() => {
  void probeUpdate();
}, 6 * 60 * 60 * 1000);
if (typeof updateProbeTimer === "object" && updateProbeTimer && "unref" in updateProbeTimer) {
  (updateProbeTimer as { unref: () => void }).unref();
}

// [updater] Kick off an initial check once the server is up, then every 6h.
// Uses the new Updater (manifest with url/sha256) — failure is silent so an
// unconfigured or unreachable manifest doesn't spam the log.
async function probeUpdater(): Promise<void> {
  try {
    const u = await getUpdater();
    await u.check(false);
  } catch {
    // best-effort
  }
}
setTimeout(() => {
  void probeUpdater();
}, 5_000).unref?.();
const updaterProbeTimer = setInterval(() => {
  void probeUpdater();
}, 6 * 60 * 60 * 1000);
if (typeof updaterProbeTimer === "object" && updaterProbeTimer && "unref" in updaterProbeTimer) {
  (updaterProbeTimer as { unref: () => void }).unref();
}

// [shares] Sweep expired / revoked share ws every 30s. The host also
// re-verifies against the ShareStore so an external revoke (file edit or
// another paired device deleting the share) kicks in quickly. Code 4410 is
// reused for every share termination so the client can show a friendly
// "分享已过期或被撤销" message.
const shareSweepTimer = setInterval(() => {
  const now = Date.now();
  for (const client of wss.clients) {
    const share = (client as E2EWebSocket).rccShare;
    if (!share) continue;
    const entry = shares.findById(share.id);
    if (!entry || entry.revoked || entry.expiresAt <= now) {
      try {
        client.close(4410, "share_expired");
      } catch {
        // ignore
      }
    }
  }
}, 30_000);
if (typeof shareSweepTimer === "object" && shareSweepTimer && "unref" in shareSweepTimer) {
  (shareSweepTimer as { unref: () => void }).unref();
}

shares.onExternalChange(() => {
  // File-level change — re-check every live share ws.
  const now = Date.now();
  for (const client of wss.clients) {
    const share = (client as E2EWebSocket).rccShare;
    if (!share) continue;
    const entry = shares.findById(share.id);
    if (!entry || entry.revoked || entry.expiresAt <= now) {
      try {
        client.close(4410, "share_expired");
      } catch {
        // ignore
      }
    }
  }
});

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
  const share = eWs.rccShare ?? null;
  const state: WsState = {
    attached: new Set(),
    unsubs: new Map(),
    exitUnsubs: new Map(),
    device,
    metricsSubscribed: false,
    share,
    limiters: createWsLimiters(),
    bpNotified: false,
  };
  wsStates.set(ws, state);
  if (device && !eWs.rccSharedKey) {
    console.warn(
      `[rcc-host] device ${device.id} (${device.name}) paired before E2E — falling back to plaintext. Ask user to re-pair.`,
    );
  }

  if (share) {
    // Share guests get a scoped hello — only the one session, and no tunnel /
    // projects / pinned commands leak.
    const s = registry.get(share.sid);
    send(ws, {
      v: 1,
      t: "hello",
      protocol: PROTOCOL_VERSION,
      sessions: s ? [s.meta()] : [],
      device: null,
      sharedReadonly: true,
      sharedSid: share.sid,
      sharedExpiresAt: share.expiresAt,
    });
    // Auto-attach so the guest immediately sees chat history + live stream
    // without having to send session.attach (they can't send any frames anyway
    // besides ping).
    if (s) {
      send(ws, { v: 1, t: "chat.list", sid: s.id, messages: s.chat.list() });
      attach(ws, state, s, null);
    }
  } else {
    send(ws, {
      v: 1,
      t: "hello",
      protocol: PROTOCOL_VERSION,
      sessions: mergedSessionList(),
      tunnel: currentTunnelInfo(),
      device: device ? { id: device.id, name: device.name, hasPasskey: !!device.passkey } : null,
      pinnedCommands: pinnedCommandsCache,
      projects: projects.list(),
    });
    // Deliver current prefs so new clients can apply them immediately.
    send(ws, { v: 1, t: "prefs", prefs: prefs.get() });
    // [federation] Seed the new client with the current peer set so the
    // PeersModal / badge renders immediately without a round-trip.
    send(ws, { v: 1, t: "peer.list", peers: peersInfoList() });
  }

  ws.on("message", (raw) => {
    let text: string;
    if (typeof raw === "string") text = raw;
    else if (Array.isArray(raw)) text = Buffer.concat(raw).toString("utf8");
    else text = (raw as Buffer).toString("utf8");

    metrics.incr("ws.bytes.in", Buffer.byteLength(text, "utf8"));
    metrics.incr("ws.msgs.in");

    if (!state.limiters.inboundFrames.tryConsume(1)) {
      metrics.incr("ws.closes.rate_limit");
      try {
        ws.close(WS_CLOSE_RATE_LIMIT, "rate_limit");
      } catch {
        // ignore
      }
      return;
    }

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
        metrics.incr("replay.rejects");
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
          metrics.incr("replay.rejects");
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
        metrics.incr("decrypt.fails");
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
    for (const unsub of state.exitUnsubs.values()) unsub();
    state.exitUnsubs.clear();
    state.attached.clear();
    state.metricsSubscribed = false;
    wsStates.delete(ws);
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
  const loopbackNote = TRUST_LOOPBACK
    ? "loopback trusted"
    : tunnelModeRequested && TRUST_LOOPBACK_EXPLICIT !== "0"
      ? "loopback REQUIRES token (tunnel active — all traffic must authenticate)"
      : "loopback requires token";
  console.log(
    `[rcc-host] auth: ${trust.devices().length} paired device(s), ${loopbackNote}`,
  );
  console.log(`[rcc-host] host id: ${trust.hostId}`);
});

process.on("SIGINT", () => {
  console.log("\n[rcc-host] shutting down...");
  tunnel?.stop();
  // Flush any debounced snapshot writes so in-flight chat/ringTail changes
  // land on disk before we exit — otherwise a reconnect would miss the last
  // few hundred ms of output.
  const pending = [...saveDebouncers.values()].map((d) => d.flush());
  void Promise.allSettled(pending).then(() => {
    registry.closeAll();
    metrics.dispose();
    watchdog.dispose();
    clearInterval(metricsTickTimer);
    process.exit(0);
  });
});
