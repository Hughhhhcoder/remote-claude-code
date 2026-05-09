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
import { CloudflaredTunnel } from "./tunnel.ts";
import { TrustStore, PairingCodes, type PairedDevice } from "./trust.ts";
import { handlePairRoute } from "./pair.ts";

interface WsState {
  attached: Set<string>;
  unsubs: Map<string, () => void>;
  device: PairedDevice | null;
}

const CLAUDE_COMMAND = process.env.RCC_CLAUDE_CMD ?? "claude";
const CLAUDE_ARGS = (process.env.RCC_CLAUDE_ARGS ?? "").split(" ").filter(Boolean);
const PORT = Number(process.env.RCC_PORT ?? 7777);
const DEFAULT_CWD = process.env.RCC_CWD ?? process.cwd();
const TUNNEL_ENABLED =
  (process.env.RCC_TUNNEL ?? "").toLowerCase() === "1" ||
  (process.env.RCC_TUNNEL ?? "").toLowerCase() === "true";

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

const boot = registry.create({
  command: CLAUDE_COMMAND,
  args: CLAUDE_ARGS,
  cwd: DEFAULT_CWD,
  permissionMode: DEFAULT_PERMISSION_MODE,
});
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
    default:
      return;
  }
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

const tunnel: CloudflaredTunnel | null = TUNNEL_ENABLED
  ? new CloudflaredTunnel({ port: PORT })
  : null;

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
  console.log(`[rcc-host] tunnel: ${TUNNEL_ENABLED ? "enabled (cloudflared)" : "disabled"}`);
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
