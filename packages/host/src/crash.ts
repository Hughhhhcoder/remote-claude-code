import { appendFile, mkdir, rename, stat, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CRASH_DIR = join(homedir(), ".rcc");
const CRASH_LOG = join(CRASH_DIR, "crashes.log");
const CRASH_LOG_ROT = join(CRASH_DIR, "crashes.log.1");
const MAX_BYTES = 1_000_000;

export type CrashBroadcast = (frame: {
  v: 1;
  t: "health.crash";
  at: number;
  message: string;
  type?: string;
}) => void;

interface CrashRecord {
  time: number;
  type: string;
  message: string;
  stack?: string;
}

function serialize(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message || String(err), stack: err.stack };
  }
  if (typeof err === "string") return { message: err };
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}

async function rotateIfNeeded(): Promise<void> {
  try {
    const st = await stat(CRASH_LOG);
    if (st.size >= MAX_BYTES) {
      try {
        await rename(CRASH_LOG, CRASH_LOG_ROT);
      } catch {
        const raw = await readFile(CRASH_LOG, "utf8").catch(() => "");
        if (raw) await writeFile(CRASH_LOG_ROT, raw, { mode: 0o600 });
        await writeFile(CRASH_LOG, "", { mode: 0o600 });
      }
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
}

async function writeRecord(rec: CrashRecord): Promise<void> {
  await mkdir(dirname(CRASH_LOG), { recursive: true });
  await rotateIfNeeded();
  const line = JSON.stringify(rec) + "\n";
  await appendFile(CRASH_LOG, line, { mode: 0o600 });
}

export function installCrashHandler(broadcast: CrashBroadcast): void {
  const onErr = (type: string) => (err: unknown) => {
    const { message, stack } = serialize(err);
    const at = Date.now();
    console.error(`[rcc-host] ${type}:`, err);
    void writeRecord({ time: at, type, message, stack }).catch((e) => {
      console.error("[rcc-host] failed to write crash log:", e);
    });
    try {
      broadcast({ v: 1, t: "health.crash", at, message, type });
    } catch {
      // ignore broadcast failures during crash
    }
  };
  process.on("uncaughtException", onErr("uncaughtException"));
  process.on("unhandledRejection", onErr("unhandledRejection"));
}

export const crashLogPath = CRASH_LOG;
