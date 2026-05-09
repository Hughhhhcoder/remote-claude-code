import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { WebSocket } from "ws";
import {
  type Frame,
  type PeerInfo,
  type SessionMeta,
  tryDecode,
  encode,
} from "@rcc/protocol";

// Per-peer credential record persisted to ~/.rcc/peers.json. `token` is the
// remote host's device token — it grants full control so users must treat
// this file as a secret (0600).
export interface PeerConfig {
  id: string;
  url: string;
  token: string;
  label: string;
  color?: string;
}

function isPeerConfig(x: unknown): x is PeerConfig {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    o.id.length > 0 &&
    o.id.length <= 64 &&
    typeof o.url === "string" &&
    o.url.length > 0 &&
    typeof o.token === "string" &&
    o.token.length > 0 &&
    typeof o.label === "string" &&
    o.label.length > 0 &&
    (o.color === undefined || typeof o.color === "string")
  );
}

export function peersPath(): string {
  return join(homedir(), ".rcc", "peers.json");
}

export class PeerStore {
  private peers: PeerConfig[];

  private constructor(peers: PeerConfig[]) {
    this.peers = peers;
  }

  static async load(): Promise<PeerStore> {
    try {
      const raw = await readFile(peersPath(), "utf8");
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        const valid = data.filter(isPeerConfig);
        if (valid.length !== data.length) {
          console.warn("[rcc-host] peers.json contained invalid entries, skipping them");
        }
        return new PeerStore(valid);
      }
      console.warn(`[rcc-host] peers.json is not an array, using empty list`);
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        console.warn(`[rcc-host] failed to read peers.json: ${err?.message ?? err}`);
      }
    }
    return new PeerStore([]);
  }

  list(): PeerConfig[] {
    return this.peers.slice();
  }

  findById(id: string): PeerConfig | undefined {
    return this.peers.find((p) => p.id === id);
  }

  async add(p: PeerConfig): Promise<void> {
    if (!isPeerConfig(p)) throw new Error("invalid peer config");
    this.peers = this.peers.filter((x) => x.id !== p.id);
    this.peers.push({ ...p });
    await this.persist();
  }

  async remove(id: string): Promise<void> {
    const before = this.peers.length;
    this.peers = this.peers.filter((p) => p.id !== id);
    if (this.peers.length !== before) await this.persist();
  }

  private async persist(): Promise<void> {
    const p = peersPath();
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(this.peers, null, 2) + "\n", { mode: 0o600 });
  }
}

const MAX_RECONNECT_MS = 30_000;

type IncomingHandler = (peerId: string, frame: Frame) => void;
type StatusHandler = (peer: PeerInfo) => void;

/**
 * Federated client: per-peer long-lived ws connection to a remote RCC host.
 *
 * Spawns a WebSocket to `<url>?token=<token>`, mirrors the remote session
 * list, and rewrites every frame touching a sid with a `<peerId>:<sid>`
 * prefix so local clients can address it globally. `pty.in` going the other
 * way has the prefix stripped before forwarding to the remote host.
 *
 * No E2E crypto (peers use a device token over TLS — see peers.json security
 * note in README). Auto-reconnect with exponential backoff capped at 30s.
 */
export class FederatedClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private closed = false;
  private outbox: Frame[] = [];
  private _sessions: SessionMeta[] = [];
  private _connected = false;
  private _error: string | null = null;

  constructor(
    readonly config: PeerConfig,
    private readonly onFrame: IncomingHandler,
    private readonly onStatus: StatusHandler,
  ) {}

  get peerId(): string {
    return this.config.id;
  }

  get connected(): boolean {
    return this._connected;
  }

  /** Session metas as published by the remote host, already prefixed with our
   * peerId so they can be merged straight into the local session list. */
  sessions(): SessionMeta[] {
    return this._sessions.slice();
  }

  info(): PeerInfo {
    return {
      id: this.config.id,
      url: this.config.url,
      label: this.config.label,
      color: this.config.color,
      connected: this._connected,
      error: this._error,
      sessionCount: this._sessions.length,
    };
  }

  start(): void {
    if (this.closed) return;
    this.connect();
  }

  dispose(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this._sessions = [];
    this._connected = false;
  }

  /** Forward a local frame (typically pty.in / session.attach / etc.) to the
   * remote host after stripping the peer prefix. Caller must already have
   * recognised the frame as belonging to this peer. */
  forward(frame: Frame): void {
    this.send(frame);
  }

  private wsUrl(): string {
    const base = this.config.url;
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}token=${encodeURIComponent(this.config.token)}`;
  }

  private send(frame: Frame): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Buffer small; drop pty.in under pressure to avoid unbounded growth.
      if (this.outbox.length < 256) this.outbox.push(frame);
      return;
    }
    try {
      this.ws.send(encode(frame));
    } catch (err) {
      console.warn(`[rcc-host] peer ${this.config.id} send failed:`, err);
    }
  }

  private connect(): void {
    if (this.closed) return;
    this._error = null;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl());
    } catch (err) {
      this._error = (err as Error).message;
      this.publishStatus();
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempts = 0;
      this._connected = true;
      this._error = null;
      this.publishStatus();
      // Drain outbox.
      while (this.outbox.length > 0) {
        const f = this.outbox.shift()!;
        try {
          ws.send(encode(f));
        } catch {
          // ignore
        }
      }
    });

    ws.on("message", (raw) => {
      let text: string;
      if (typeof raw === "string") text = raw;
      else if (Array.isArray(raw)) text = Buffer.concat(raw).toString("utf8");
      else text = (raw as Buffer).toString("utf8");

      // The remote host may wrap in an E2E envelope when talking to web
      // clients — but since we connect with a token without registering a
      // shared key, the remote host falls back to plaintext. If we see an
      // envelope, we simply can't decode it: skip.
      let outer: unknown;
      try {
        outer = JSON.parse(text);
      } catch {
        return;
      }
      if (outer && typeof outer === "object" && (outer as { e2e?: unknown }).e2e === 1) {
        // Remote host has E2E enforced for this device — peer federation
        // can't participate without sharing keys. Surface as an error so
        // the user sees why nothing shows up.
        this._error = "remote host requires E2E; peer federation not supported";
        this.publishStatus();
        return;
      }
      const frame = tryDecode(text);
      if (!frame) return;
      this.handleRemoteFrame(frame);
    });

    ws.on("close", () => {
      this._connected = false;
      this._sessions = [];
      this.publishStatus();
      this.ws = null;
      this.scheduleReconnect();
    });

    ws.on("error", (err) => {
      this._error = err.message;
      // close will follow
    });
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = Math.min(
      MAX_RECONNECT_MS,
      500 * 2 ** Math.min(6, this.reconnectAttempts++),
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    if (typeof this.reconnectTimer === "object" && this.reconnectTimer && "unref" in this.reconnectTimer) {
      (this.reconnectTimer as { unref: () => void }).unref();
    }
  }

  private publishStatus(): void {
    try {
      this.onStatus(this.info());
    } catch (err) {
      console.warn(`[rcc-host] peer ${this.config.id} status handler threw:`, err);
    }
  }

  private handleRemoteFrame(frame: Frame): void {
    // Rewrite sid-bearing frames so local clients see globally unique ids.
    const rewritten = rewriteRemoteToLocal(frame, this.config);
    if (!rewritten) return;
    // Maintain our own session list mirror from session.list / session.created
    // / session.exited so the host can merge it into its broadcast.
    if (rewritten.t === "hello" || rewritten.t === "session.list") {
      this._sessions = rewritten.sessions.slice();
      this.publishStatus();
    } else if (rewritten.t === "session.created") {
      this._sessions = [
        ...this._sessions.filter((s) => s.id !== rewritten.session.id),
        rewritten.session,
      ];
      this.publishStatus();
    } else if (rewritten.t === "session.exited") {
      this._sessions = this._sessions.map((s) =>
        s.id === rewritten.sid ? { ...s, status: "exited" as const } : s,
      );
      this.publishStatus();
    }
    this.onFrame(this.config.id, rewritten);
  }
}

/** Prefix a local sid (from the remote host's POV) with `<peerId>:` so it's
 * globally unique. Local sessions never carry a prefix. */
export function prefixSid(peerId: string, sid: string): string {
  return `${peerId}:${sid}`;
}

/** Detect whether a sid looks like a federated (remote) sid. If so returns
 * the (peerId, localSid) pair; otherwise null. The split is on the *first*
 * colon only, since the remote host's local sids are UUIDs that also contain
 * dashes but no colons. */
export function parseSid(sid: string): { peerId: string; localSid: string } | null {
  const idx = sid.indexOf(":");
  if (idx <= 0 || idx === sid.length - 1) return null;
  return { peerId: sid.slice(0, idx), localSid: sid.slice(idx + 1) };
}

/** Rewrite a frame coming from a remote host so every sid is prefixed with
 * this peer's id. Any frame without an sid passes through unchanged. Frames
 * that don't make sense to surface at the local level (e.g. peer.*, tunnel,
 * device) are filtered out by returning null. */
function rewriteRemoteToLocal(frame: Frame, peer: PeerConfig): Frame | null {
  // Frames we deliberately don't re-emit locally: they belong to the remote
  // host's own local client context and could be misleading if leaked.
  switch (frame.t) {
    case "tunnel.status":
    case "device.list":
    case "prefs":
    case "prefs.updated":
    case "metrics.tick":
    case "health.crash":
    case "activity.list":
    case "activity.append":
    case "project.list":
    case "project.added":
    case "project.removed":
    case "project.renamed":
    case "project.updated":
    case "peer.list":
    case "peer.status":
      return null;
  }

  switch (frame.t) {
    case "hello": {
      const sessions = frame.sessions.map((s) => stampSessionMeta(s, peer));
      return { ...frame, sessions };
    }
    case "session.list": {
      return {
        ...frame,
        sessions: frame.sessions.map((s) => stampSessionMeta(s, peer)),
      };
    }
    case "session.created": {
      return { ...frame, session: stampSessionMeta(frame.session, peer) };
    }
    case "session.resumed": {
      return { ...frame, session: stampSessionMeta(frame.session, peer) };
    }
    case "session.exited":
    case "pty.out":
    case "chat.list":
    case "chat.append":
    case "chat.update":
    case "chat.resetted":
    case "summary":
    case "git.status":
    case "git.commits":
    case "git.exec.result":
    case "approval.request":
    case "approval.cleared":
    case "record.status":
    case "notebook":
    case "notebook.upserted":
    case "notebook.deleted":
    case "error": {
      const f = frame as Frame & { sid?: string };
      if (!f.sid) return frame;
      return { ...frame, sid: prefixSid(peer.id, f.sid) } as Frame;
    }
    default:
      return frame;
  }
}

function stampSessionMeta(meta: SessionMeta, peer: PeerConfig): SessionMeta {
  return {
    ...meta,
    id: prefixSid(peer.id, meta.id),
    peerId: peer.id,
    peerLabel: peer.label,
    peerColor: peer.color,
  };
}

/** Rewrite a frame coming from a local client so it's safe to forward to the
 * remote peer: strip the peer prefix from any sid. Caller should only invoke
 * this after determining the frame is addressed at a peer sid. Returns null
 * when the frame doesn't carry an sid we need to forward. */
export function rewriteLocalToRemote(
  frame: Frame,
  peerId: string,
): Frame | null {
  switch (frame.t) {
    case "pty.in":
    case "pty.resize":
    case "session.attach":
    case "session.close":
    case "session.resume":
    case "chat.list.request":
    case "chat.reset":
    case "git.status.request":
    case "git.exec.request":
    case "record.start":
    case "record.stop":
    case "record.status.request":
    case "notebook.request":
    case "notebook.upsert":
    case "notebook.append":
    case "notebook.delete":
    case "summary.request":
    case "summary.refresh":
    case "approval.response": {
      const f = frame as Frame & { sid: string };
      const parsed = parseSid(f.sid);
      if (!parsed || parsed.peerId !== peerId) return null;
      return { ...frame, sid: parsed.localSid } as Frame;
    }
    default:
      return null;
  }
}
