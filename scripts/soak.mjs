#!/usr/bin/env node
/**
 * Soak test for rcc-host. Spawns a host on a dedicated port (default 7899),
 * opens N ws sessions, keeps typing / creating / closing sessions for the
 * requested duration, samples /metrics every 10s, and writes a CSV + a final
 * ASCII sparkline of RSS so operators can eyeball stability.
 *
 * Usage:
 *   node scripts/soak.mjs                     # 2h default
 *   node scripts/soak.mjs --duration=300      # 5 minutes
 *   node scripts/soak.mjs --port=7899 --sessions=5 --duration=7200
 *
 * Not part of CI — too slow. Run manually before release.
 *
 * Expected outcome after 2h: RSS oscillates within ~50MB band with no
 * monotonic growth. A continuously rising line is a leak — collect the CSV +
 * a heap snapshot (`kill -USR2 <pid>` + `--heapsnapshot-signal`) for
 * investigation.
 */

import { spawn } from "node:child_process";
import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function parseArgs() {
  const args = { duration: 7200, port: 7899, sessions: 5, hostCmd: null };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (k === "duration") args.duration = Number(v);
    else if (k === "port") args.port = Number(v);
    else if (k === "sessions") args.sessions = Number(v);
    else if (k === "host-cmd") args.hostCmd = v;
  }
  if (!Number.isFinite(args.duration) || args.duration <= 0) args.duration = 7200;
  if (!Number.isFinite(args.port) || args.port <= 0) args.port = 7899;
  if (!Number.isFinite(args.sessions) || args.sessions <= 0) args.sessions = 5;
  return args;
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function waitForHost(port, deadlineMs) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return true;
    } catch {
      // not up yet
    }
    await delay(250);
  }
  return false;
}

async function fetchMetrics(port) {
  const r = await fetch(`http://127.0.0.1:${port}/metrics`);
  if (!r.ok) throw new Error(`metrics HTTP ${r.status}`);
  return r.json();
}

class WsSession {
  constructor(port, label) {
    this.port = port;
    this.label = label;
    this.sid = null;
    this.ws = null;
    this.opened = false;
    this.closed = false;
  }

  async open() {
    const ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws`);
    this.ws = ws;
    return new Promise((resolveOpen, rejectOpen) => {
      let settled = false;
      ws.addEventListener("open", () => {
        this.opened = true;
        if (!settled) {
          settled = true;
          resolveOpen();
        }
      });
      ws.addEventListener("error", (e) => {
        if (!settled) {
          settled = true;
          rejectOpen(new Error(`ws error: ${e?.message ?? "unknown"}`));
        }
      });
      ws.addEventListener("close", () => {
        this.opened = false;
        this.closed = true;
      });
      ws.addEventListener("message", (ev) => {
        try {
          const frame = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
          if (frame && frame.t === "hello") {
            if (Array.isArray(frame.sessions) && frame.sessions.length > 0 && !this.sid) {
              this.sid = frame.sessions[0].id;
            }
          } else if (frame && frame.t === "session.created") {
            this.sid = frame.meta?.id ?? frame.sid ?? this.sid;
          }
        } catch {
          // ignore
        }
      });
    });
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== 1) return;
    try {
      this.ws.send(JSON.stringify(obj));
    } catch {
      // drop
    }
  }

  createSession(cwd) {
    this.send({ v: 1, t: "session.new", cwd, driver: "cli" });
  }

  closeSession(sid) {
    this.send({ v: 1, t: "session.close", sid });
  }

  type(sid, text) {
    this.send({ v: 1, t: "pty.in", sid, data: text });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
  }
}

function sparkline(values) {
  const bars = "▁▂▃▄▅▆▇█";
  if (values.length === 0) return "(empty)";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v) => bars[Math.min(bars.length - 1, Math.floor(((v - min) / span) * (bars.length - 1)))])
    .join("");
}

function fmtMb(n) {
  return (n / (1024 * 1024)).toFixed(1) + "MB";
}

async function main() {
  const args = parseArgs();
  const outDir = join(ROOT, "soak-logs");
  try {
    mkdirSync(outDir, { recursive: true });
  } catch {
    // exists
  }
  const csvPath = join(outDir, `soak-${ts()}.csv`);
  writeFileSync(csvPath, "t,elapsed_s,rss,heap_used,heap_total,external,cpu_pct,sessions,handles\n");

  const hostEnv = {
    ...process.env,
    RCC_PORT: String(args.port),
    RCC_TUNNEL: "",
    RCC_TRUST_LOOPBACK: "1",
    // Use a dirt-cheap pty command so soak focuses on host-side bookkeeping
    // rather than real LLM CLI spawn cost.
    RCC_CLAUDE_CMD: process.env.RCC_CLAUDE_CMD ?? "cat",
    RCC_CLAUDE_ARGS: process.env.RCC_CLAUDE_ARGS ?? "",
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --expose-gc`.trim(),
  };
  console.log(`[soak] starting host on port ${args.port}`);
  const hostCmd = args.hostCmd ?? "pnpm";
  const hostArgs = args.hostCmd ? [] : ["-F", "@rcc/host", "start"];
  const host = spawn(hostCmd, hostArgs, {
    cwd: ROOT,
    env: hostEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  host.stdout?.on("data", (chunk) => {
    const s = chunk.toString();
    if (s.includes("listening")) process.stdout.write(`[host] ${s}`);
  });
  host.stderr?.on("data", (chunk) => {
    process.stderr.write(`[host:err] ${chunk}`);
  });
  let hostExited = false;
  host.on("exit", (code, signal) => {
    hostExited = true;
    console.log(`[soak] host exited code=${code} signal=${signal}`);
  });

  const up = await waitForHost(args.port, 30_000);
  if (!up) {
    console.error("[soak] host did not come up within 30s");
    host.kill("SIGTERM");
    process.exit(1);
  }
  console.log("[soak] host ready");

  const sessions = [];
  for (let i = 0; i < args.sessions; i++) {
    const s = new WsSession(args.port, `s${i}`);
    try {
      await s.open();
      sessions.push(s);
    } catch (err) {
      console.warn(`[soak] failed to open session ${i}:`, err?.message ?? err);
    }
  }
  await delay(500);
  for (let i = 0; i < sessions.length; i++) {
    sessions[i].createSession(ROOT);
  }
  await delay(1000);

  const started = Date.now();
  const endAt = started + args.duration * 1000;
  const rssSamples = [];
  let tick = 0;
  let lastSampleAt = 0;

  process.on("SIGINT", () => {
    console.log("\n[soak] SIGINT — stopping");
    for (const s of sessions) s.close();
    host.kill("SIGTERM");
    setTimeout(() => process.exit(130), 1000);
  });

  const perSecondTimer = setInterval(() => {
    if (hostExited) return;
    tick++;
    // Fan traffic: every session types a char; occasional session churn.
    for (const s of sessions) {
      if (!s.sid) continue;
      s.type(s.sid, ".");
    }
    if (tick % 30 === 0 && sessions.length > 0) {
      const victim = sessions[tick % sessions.length];
      if (victim.sid) {
        victim.closeSession(victim.sid);
        victim.sid = null;
        victim.createSession(ROOT);
      }
    }
  }, 1000);

  while (Date.now() < endAt && !hostExited) {
    const now = Date.now();
    if (now - lastSampleAt >= 10_000) {
      lastSampleAt = now;
      try {
        const snap = await fetchMetrics(args.port);
        const handles =
          typeof process.getActiveResourcesInfo === "function"
            ? "n/a-remote"
            : "n/a";
        const row = [
          new Date(now).toISOString(),
          Math.round((now - started) / 1000),
          snap.process?.rss ?? 0,
          snap.process?.heapUsed ?? 0,
          snap.process?.heapTotal ?? 0,
          snap.process?.external ?? 0,
          snap.process?.cpuPct ?? 0,
          snap.sessions?.total ?? 0,
          handles,
        ].join(",");
        appendFileSync(csvPath, row + "\n");
        rssSamples.push(snap.process?.rss ?? 0);
        if (rssSamples.length % 3 === 0) {
          const mbs = rssSamples.map((v) => Math.round(v / 1024 / 1024));
          console.log(
            `[soak] t=${Math.round((now - started) / 1000)}s rss=${fmtMb(rssSamples[rssSamples.length - 1])} sessions=${snap.sessions?.total ?? 0} spark=${sparkline(mbs.slice(-40))}`,
          );
        }
      } catch (err) {
        console.warn("[soak] metrics fetch failed:", err?.message ?? err);
      }
    }
    await delay(250);
  }

  clearInterval(perSecondTimer);
  for (const s of sessions) s.close();
  await delay(500);
  host.kill("SIGTERM");

  console.log("\n[soak] done");
  console.log(`[soak] csv: ${csvPath}`);
  if (rssSamples.length > 0) {
    const mbs = rssSamples.map((v) => Math.round(v / 1024 / 1024));
    const min = Math.min(...mbs);
    const max = Math.max(...mbs);
    const first = mbs[0];
    const last = mbs[mbs.length - 1];
    const drift = last - first;
    console.log(`[soak] rss MB min=${min} max=${max} first=${first} last=${last} drift=${drift}`);
    console.log(`[soak] spark: ${sparkline(mbs)}`);
    // Drop the first sample (startup warmup / JIT allocation) when evaluating
    // stability. True leaks show monotonic upward growth, not one-off peaks.
    const steady = mbs.slice(1);
    if (steady.length >= 2) {
      const sMin = Math.min(...steady);
      const sMax = Math.max(...steady);
      if (sMax - sMin > 50) {
        console.warn(`[soak] WARNING: steady-state RSS swing ${sMax - sMin}MB > 50MB; investigate`);
        process.exitCode = 2;
      } else {
        console.log(`[soak] steady-state RSS within 50MB band (${sMin}-${sMax}MB) — stable`);
      }
    }
  } else {
    console.warn("[soak] no samples collected");
    process.exitCode = 3;
  }
}

main().catch((err) => {
  console.error("[soak] fatal:", err);
  process.exit(1);
});
