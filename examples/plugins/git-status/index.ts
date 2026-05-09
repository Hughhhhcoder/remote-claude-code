// git-status — broadcasts `git status --short` for the active session's cwd.
//
// Demonstrates extending RCC without touching core code:
//   - subscribes to session lifecycle via ctx.onSessionCreated/Exited
//   - runs a shell command scoped to session.cwd
//   - pushes a `plugin.broadcast { kind: "git.status.ext" }` frame so any
//     client can render a "dirty files" badge on the session tile.
//
// Install:
//   cp -R examples/plugins/git-status ~/.rcc/plugins/git-status

import { execFile } from "node:child_process";

type Permission = "session:read" | "session:write" | "chat:read" | "broadcast";

interface SessionLite {
  id: string;
  cwd: string;
  status: "running" | "exited";
  title?: string;
  projectId?: string;
}

interface PluginContext {
  id: string;
  log: (msg: string) => void;
  broadcast: (frame: { kind: string; payload?: unknown }) => void;
  onSessionCreated: (cb: (s: SessionLite) => void) => () => void;
  onSessionExited: (cb: (sid: string) => void) => () => void;
}

interface CallContext {
  id: string;
  log: (msg: string) => void;
  hasPermission: (p: Permission) => boolean;
}

interface StatusEntry {
  file: string;
  code: string;
}

interface StatusFrame {
  v: 1;
  sid: string;
  cwd: string;
  clean: boolean;
  entries: StatusEntry[];
  at: number;
  error?: string;
}

const POLL_MS = 15_000;
const MAX_ENTRIES = 200;

const sessions = new Map<string, SessionLite>();
let timer: ReturnType<typeof setInterval> | null = null;
let log: (msg: string) => void = () => {};
let broadcast: PluginContext["broadcast"] = () => {};

function parseShort(out: string): StatusEntry[] {
  const lines = out.split("\n").filter((l) => l.length > 0);
  const entries: StatusEntry[] = [];
  for (const line of lines) {
    const code = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (file) entries.push({ code, file });
    if (entries.length >= MAX_ENTRIES) break;
  }
  return entries;
}

function runStatus(cwd: string): Promise<{ entries: StatusEntry[]; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["status", "--short"],
      { cwd, timeout: 5_000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve({ entries: [], error: err.message });
          return;
        }
        resolve({ entries: parseShort(stdout) });
      },
    );
  });
}

async function refreshOne(session: SessionLite): Promise<void> {
  if (session.status !== "running") return;
  const res = await runStatus(session.cwd);
  const frame: StatusFrame = {
    v: 1,
    sid: session.id,
    cwd: session.cwd,
    clean: !res.error && res.entries.length === 0,
    entries: res.entries,
    at: Date.now(),
  };
  if (res.error) frame.error = res.error;
  broadcast({ kind: "git.status.ext", payload: frame });
}

async function refreshAll(): Promise<void> {
  for (const s of sessions.values()) {
    try {
      await refreshOne(s);
    } catch (err: any) {
      log(`refresh ${s.id} failed: ${err?.message ?? err}`);
    }
  }
}

const plugin = {
  id: "git-status",
  name: "Git Status",
  version: "1.0.0",

  onLoad(ctx: PluginContext) {
    log = ctx.log;
    broadcast = ctx.broadcast;
    ctx.log("git-status loaded");

    ctx.onSessionCreated((s) => {
      sessions.set(s.id, s);
      refreshOne(s).catch(() => {});
    });
    ctx.onSessionExited((sid) => {
      sessions.delete(sid);
    });

    timer = setInterval(() => {
      refreshAll().catch(() => {});
    }, POLL_MS);
  },

  onUnload() {
    if (timer) clearInterval(timer);
    timer = null;
    sessions.clear();
  },

  async handleCall(method: string, payload: unknown, ctx: CallContext) {
    if (method === "refresh") {
      const sid = (payload as { sid?: string } | undefined)?.sid;
      if (sid) {
        const s = sessions.get(sid);
        if (!s) return { ok: false, error: `unknown sid: ${sid}` };
        await refreshOne(s);
        return { ok: true, sid };
      }
      await refreshAll();
      return { ok: true, refreshed: sessions.size };
    }
    if (method === "list") {
      return { sessions: [...sessions.values()] };
    }
    ctx.log(`unknown method: ${method}`);
    throw new Error(`unknown method: ${method}`);
  },
};

export default plugin;
