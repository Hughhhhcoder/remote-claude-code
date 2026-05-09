import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const FAKE_CLAUDE = join(HERE, "fake-claude.mjs");

export interface HostHandle {
  url: string;
  wsUrl: string;
  port: number;
  home: string;
  kill: () => Promise<void>;
}

async function waitForPort(port: number, tries = 100, delayMs = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise<boolean>((done) => {
      const s = createConnection({ port, host: "127.0.0.1" });
      const cleanup = (v: boolean) => {
        s.removeAllListeners();
        try {
          s.end();
        } catch {
          // ignore
        }
        done(v);
      };
      s.once("connect", () => cleanup(true));
      s.once("error", () => cleanup(false));
    });
    if (ok) return;
    await sleep(delayMs);
  }
  throw new Error(`port ${port} never opened`);
}

export async function startHost(opts: { port?: number } = {}): Promise<HostHandle> {
  const port = opts.port ?? 7799;
  const home = await mkdtemp(join(tmpdir(), "rcc-e2e-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    RCC_PORT: String(port),
    RCC_TRUST_LOOPBACK: "1",
    RCC_CLAUDE_CMD: process.execPath,
    RCC_CLAUDE_ARGS: FAKE_CLAUDE,
    RCC_PERMISSION_MODE: "default",
    RCC_TUNNEL: "0",
    RCC_CWD: REPO_ROOT,
  };
  const child: ChildProcess = spawn("pnpm", ["-F", "@rcc/host", "start"], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = (prefix: string) => (buf: Buffer) => {
    if (process.env.RCC_E2E_DEBUG) {
      process.stderr.write(`[host:${prefix}] ${buf.toString()}`);
    }
  };
  child.stdout?.on("data", log("out"));
  child.stderr?.on("data", log("err"));
  child.once("exit", (code) => {
    if (process.env.RCC_E2E_DEBUG) {
      process.stderr.write(`[host] exited with ${code}\n`);
    }
  });
  try {
    await waitForPort(port);
  } catch (err) {
    child.kill("SIGKILL");
    await rm(home, { recursive: true, force: true });
    throw err;
  }
  return {
    url: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    port,
    home,
    kill: async () => {
      if (!child.killed) {
        child.kill("SIGTERM");
        for (let i = 0; i < 20 && !child.killed && child.exitCode === null; i++) {
          await sleep(100);
        }
        if (child.exitCode === null) child.kill("SIGKILL");
      }
      await rm(home, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
