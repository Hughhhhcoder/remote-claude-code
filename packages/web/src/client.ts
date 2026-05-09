import { tryDecode, encode, type Frame, type PermissionMode, type SessionMeta, type TunnelInfo } from "@rcc/protocol";
import sodium from "libsodium-wrappers";
import { loadE2EKey } from "./auth.ts";

export type Listener = (frame: Frame) => void;
export type StatusListener = (status: ConnStatus) => void;

export type ConnStatus = "connecting" | "connected" | "closed" | "unauthorized";

export interface RccClientOptions {
  url: string;
  token?: string | null;
}

interface E2EEnvelope {
  e2e: 1;
  n: string;
  c: string;
}

function isEnvelope(obj: unknown): obj is E2EEnvelope {
  return (
    !!obj &&
    typeof obj === "object" &&
    (obj as { e2e?: unknown }).e2e === 1 &&
    typeof (obj as { n?: unknown }).n === "string" &&
    typeof (obj as { c?: unknown }).c === "string"
  );
}

/**
 * Thin WebSocket client:
 *  - auto-reconnects with exponential backoff
 *  - tracks last-seen seq per sid so reattach can request a since cursor
 *  - queues outbound frames while offline
 */
export class RccClient {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly lastSeq = new Map<string, number>();
  private readonly outbox: Frame[] = [];
  private readonly attachedSids = new Set<string>();
  private status: ConnStatus = "connecting";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  /** Raw base64 symmetric key. Null before sodium.ready or if not paired with
   * E2E. Once non-null, every outbound/inbound ws message is secretbox'd. */
  private e2eKey: Uint8Array | null = null;
  private sodiumReady = false;

  sessions: SessionMeta[] = [];
  tunnel: TunnelInfo | null = null;
  pinnedCommandIds: string[] = [];

  constructor(private readonly opts: RccClientOptions) {
    void this.initSodium();
    this.connect();
  }

  private async initSodium(): Promise<void> {
    try {
      await sodium.ready;
      this.sodiumReady = true;
      const keyB64 = loadE2EKey();
      if (keyB64) {
        try {
          this.e2eKey = sodium.from_base64(keyB64, sodium.base64_variants.ORIGINAL);
        } catch (err) {
          console.warn("[rcc] invalid E2E key, ignoring:", err);
        }
      }
    } catch (err) {
      console.warn("[rcc] libsodium init failed:", err);
    }
  }

  private encodeOutbound(frame: Frame): string {
    if (!this.e2eKey || !this.sodiumReady) return encode(frame);
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const plain = sodium.from_string(encode(frame));
    const cipher = sodium.crypto_secretbox_easy(plain, nonce, this.e2eKey);
    const env: E2EEnvelope = {
      e2e: 1,
      n: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
      c: sodium.to_base64(cipher, sodium.base64_variants.ORIGINAL),
    };
    return JSON.stringify(env);
  }

  /** Attempt to unwrap an incoming ws text into a Frame. Returns null on
   * decrypt/decode failure (caller drops). */
  private decodeInbound(text: string): Frame | null {
    let outer: unknown;
    try {
      outer = JSON.parse(text);
    } catch {
      return null;
    }
    if (isEnvelope(outer)) {
      if (!this.e2eKey || !this.sodiumReady) return null;
      try {
        const nonce = sodium.from_base64(outer.n, sodium.base64_variants.ORIGINAL);
        const cipher = sodium.from_base64(outer.c, sodium.base64_variants.ORIGINAL);
        const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, this.e2eKey);
        return tryDecode(sodium.to_string(plain));
      } catch {
        return null;
      }
    }
    return tryDecode(text);
  }

  private connect(): void {
    if (this.closed) return;
    this.setStatus("connecting");
    const url = this.buildUrl();
    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.error("[rcc] ws construct failed", err);
      this.scheduleReconnect();
      return;
    }

    this.ws.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      for (const sid of this.attachedSids) {
        const since = this.lastSeq.get(sid);
        this.send({ v: 1, t: "session.attach", sid, since: since ?? null });
      }
      while (this.outbox.length > 0) {
        const f = this.outbox.shift()!;
        this.sendNow(f);
      }
    });

    this.ws.addEventListener("message", (ev) => {
      const text = typeof ev.data === "string" ? ev.data : String(ev.data);
      const frame = this.decodeInbound(text);
      if (!frame) {
        // E2E decryption/decode failure → treat as fatal auth problem so the
        // user re-pairs (keys may have rotated on the host).
        if (this.e2eKey) {
          this.setStatus("unauthorized");
          try {
            this.ws?.close();
          } catch {
            // ignore
          }
        }
        return;
      }
      if (frame.t === "hello" || frame.t === "session.list") {
        this.sessions = frame.sessions;
      }
      if (frame.t === "hello" && frame.tunnel) {
        this.tunnel = frame.tunnel;
      }
      if (frame.t === "hello" && frame.pinnedCommands) {
        this.pinnedCommandIds = frame.pinnedCommands;
      }
      if (frame.t === "cmd.pinned") {
        this.pinnedCommandIds = frame.ids;
      }
      if (frame.t === "tunnel.status") {
        this.tunnel = frame.tunnel;
      }
      if (frame.t === "session.created") {
        this.sessions = [...this.sessions, frame.session];
      }
      if (frame.t === "pty.out") {
        this.lastSeq.set(frame.sid, frame.seq);
      }
      for (const l of this.listeners) l(frame);
    });

    this.ws.addEventListener("close", (ev) => {
      // Browser-observable close codes are coarse; we set 4401 from the host
      // on revoke, and we also probe /health for 401 when a normal close hits.
      if (ev.code === 4401) {
        this.setStatus("unauthorized");
        return;
      }
      this.probeAuth().then((needsAuth) => {
        if (needsAuth) {
          this.setStatus("unauthorized");
        } else {
          this.setStatus("closed");
          this.scheduleReconnect();
        }
      });
    });

    this.ws.addEventListener("error", () => {
      // close will follow
    });
  }

  private buildUrl(): string {
    if (!this.opts.token) return this.opts.url;
    const sep = this.opts.url.includes("?") ? "&" : "?";
    return `${this.opts.url}${sep}token=${encodeURIComponent(this.opts.token)}`;
  }

  /** Quick GET probe to detect whether the ws was rejected for auth reasons. */
  private async probeAuth(): Promise<boolean> {
    try {
      const httpBase = this.opts.url.replace(/^ws/, "http");
      const headers: Record<string, string> = {};
      if (this.opts.token) headers["authorization"] = `Bearer ${this.opts.token}`;
      const resp = await fetch(httpBase, { headers });
      return resp.status === 401;
    } catch {
      return false;
    }
  }

  /** Update the auth token (e.g. after pairing succeeds) and reconnect. */
  setToken(token: string | null): void {
    (this.opts as { token?: string | null }).token = token;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
    // Force immediate reconnect.
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.connect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = Math.min(15_000, 500 * 2 ** Math.min(6, this.reconnectAttempts++));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private setStatus(s: ConnStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  private sendNow(frame: Frame): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.outbox.push(frame);
      return;
    }
    this.ws.send(this.encodeOutbound(frame));
  }

  send(frame: Frame): void {
    if (frame.t === "session.attach") this.attachedSids.add(frame.sid);
    if (frame.t === "session.close") this.attachedSids.delete(frame.sid);
    this.sendNow(frame);
  }

  attach(sid: string): void {
    const since = this.lastSeq.get(sid);
    this.send({ v: 1, t: "session.attach", sid, since: since ?? null });
  }

  write(sid: string, data: string): void {
    this.send({ v: 1, t: "pty.in", sid, data });
  }

  resize(sid: string, cols: number, rows: number): void {
    this.send({ v: 1, t: "pty.resize", sid, cols, rows });
  }

  newSession(opts: { cwd?: string; cols?: number; rows?: number; permissionMode?: PermissionMode } = {}): void {
    this.send({
      v: 1,
      t: "session.new",
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      permissionMode: opts.permissionMode,
    });
  }

  closeSession(sid: string): void {
    this.send({ v: 1, t: "session.close", sid });
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onStatus(l: StatusListener): () => void {
    this.statusListeners.add(l);
    l(this.status);
    return () => this.statusListeners.delete(l);
  }

  getStatus(): ConnStatus {
    return this.status;
  }

  dispose(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) this.ws.close();
  }
}

export function defaultWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}
