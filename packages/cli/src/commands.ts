import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig, saveConfig, resolveProfile, configPath } from "./config.ts";
import { request, HttpError } from "./http.ts";
import {
  color,
  renderTable,
  statusColor,
  roleColor,
  kindColor,
  printJson,
} from "./format.ts";
import { parseArgs, getString, getBool, getNumber } from "./argv.ts";

interface SessionMeta {
  id: string;
  cwd: string;
  createdAt: number;
  lastActiveAt?: number;
  status?: string;
  permissionMode?: string;
  projectId?: string | null;
  driver?: string;
  summary?: { title?: string };
}

interface ChatSegment {
  kind: string;
  text?: string;
  content?: string;
  code?: string;
  diff?: string;
  toolName?: string;
  isError?: boolean;
}

interface ChatMessage {
  id: string;
  sid: string;
  role: string;
  segments: ChatSegment[];
  timestamp: number;
  streaming?: boolean;
}

interface ProjectMeta {
  id: string;
  name: string;
  cwd: string;
  color?: string;
}

type Flags = Record<string, string | boolean>;

async function ctx(flags: Flags): Promise<{ url: string; token: string }> {
  const cfg = await loadConfig();
  const profileName = getString(flags, "profile");
  const p = resolveProfile(cfg, profileName);
  return { url: p.url, token: p.token };
}

function jsonOut(flags: Flags): boolean {
  return getBool(flags, "json");
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export async function cmdLogin(args: string[]): Promise<number> {
  const { flags } = parseArgs(args);
  if (getBool(flags, "help") || getBool(flags, "h")) {
    printLoginHelp();
    return 0;
  }
  const url = getString(flags, "url");
  if (!url) {
    console.error("--url <base-url> is required");
    return 2;
  }
  const profile = getString(flags, "profile") ?? "default";
  const rename = getString(flags, "name");
  let token = getString(flags, "token");
  const pairCode = getString(flags, "pair-code");
  const claimSecret = getString(flags, "claim-secret");
  const deviceName = getString(flags, "device-name") ?? "rcc-cli";

  if (!token && pairCode) {
    if (!claimSecret) {
      console.error("--claim-secret required with --pair-code (obtain from /pair/new)");
      return 2;
    }
    try {
      const resp = await request<{ token: string; device: { id: string; name: string } }>(
        url,
        "/pair/claim",
        { method: "POST", body: { code: pairCode, claimSecret, deviceName } },
      );
      token = resp.token;
    } catch (err) {
      console.error(formatError(err));
      return 1;
    }
  }

  if (!token) {
    console.error("provide --token <token> or --pair-code <code> --claim-secret <secret>");
    return 2;
  }

  try {
    await request<{ ok: boolean }>(url, "/api/v1/health", { token });
  } catch (err) {
    console.error("token rejected: " + formatError(err));
    return 1;
  }

  const cfg = await loadConfig();
  cfg.profiles[rename ?? profile] = { url, token };
  if (!cfg.defaultProfile) cfg.defaultProfile = rename ?? profile;
  await saveConfig(cfg);
  console.log(
    `${color.green("ok")} saved profile ${color.bold(rename ?? profile)} to ${configPath()}`,
  );
  return 0;
}

function printLoginHelp(): void {
  console.log(`rcc login — save a host URL + device token

Usage:
  rcc login --url <base-url> --token <token> [--profile <name>]
  rcc login --url <base-url> --pair-code <code> --claim-secret <secret> [--device-name <name>] [--profile <name>]

Options:
  --url <base-url>       Host URL (e.g. https://home.example.com)
  --token <token>        Device token already obtained from the host
  --pair-code <code>     6-digit pairing code (from host terminal)
  --claim-secret <sec>   claimSecret returned by POST /pair/new
  --device-name <name>   Device name to record (default: rcc-cli)
  --profile <name>       Profile slot (default: default)
`);
}

export async function cmdSessions(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (!sub || sub === "--help" || sub === "-h") {
    console.log(`rcc sessions <list|new|show|close> [options]

  list                          GET /api/v1/sessions
  new [--cwd <path>] [--mode <plan|default|acceptEdits|bypassPermissions>] [--starter <id>] [--driver cli|sdk] [--project <id>]
  show <sid>                    GET /api/v1/sessions/:sid
  close <sid>                   DELETE /api/v1/sessions/:sid
  resume <sid>                  POST /api/v1/sessions/:sid/resume
`);
    return sub ? 0 : 2;
  }
  if (sub === "list") return cmdSessionsList(rest);
  if (sub === "new") return cmdSessionsNew(rest);
  if (sub === "show") return cmdSessionsShow(rest);
  if (sub === "close") return cmdSessionsClose(rest);
  if (sub === "resume") return cmdSessionsResume(rest);
  console.error(`unknown sessions subcommand: ${sub}`);
  return 2;
}

async function cmdSessionsList(args: string[]): Promise<number> {
  const { flags } = parseArgs(args);
  try {
    const { url, token } = await ctx(flags);
    const resp = await request<{ sessions: SessionMeta[] }>(url, "/api/v1/sessions", { token });
    if (jsonOut(flags)) {
      printJson(resp);
      return 0;
    }
    console.log(
      renderTable(resp.sessions, [
        { header: "ID", get: (s) => s.id },
        { header: "STATUS", get: (s) => statusColor(s.status) },
        { header: "DRIVER", get: (s) => s.driver ?? "" },
        { header: "MODE", get: (s) => s.permissionMode ?? "" },
        { header: "CWD", get: (s) => s.cwd },
        {
          header: "ACTIVE",
          get: (s) => (s.lastActiveAt ? relTime(s.lastActiveAt) : ""),
        },
        {
          header: "TITLE",
          get: (s) => s.summary?.title ?? "",
        },
      ]),
    );
    return 0;
  } catch (err) {
    console.error(formatError(err));
    return 1;
  }
}

async function cmdSessionsNew(args: string[]): Promise<number> {
  const { flags } = parseArgs(args);
  try {
    const { url, token } = await ctx(flags);
    const body: Record<string, unknown> = {};
    const cwd = getString(flags, "cwd");
    const mode = getString(flags, "mode");
    const starter = getString(flags, "starter");
    const driver = getString(flags, "driver");
    const projectId = getString(flags, "project");
    if (cwd) body.cwd = cwd;
    if (mode) body.permissionMode = mode;
    if (starter) body.starterId = starter;
    if (driver) body.driver = driver;
    if (projectId) body.projectId = projectId;
    const resp = await request<{ session: SessionMeta }>(url, "/api/v1/sessions", {
      method: "POST",
      body,
      token,
    });
    if (jsonOut(flags)) {
      printJson(resp);
      return 0;
    }
    const s = resp.session;
    console.log(`${color.green("created")} ${color.bold(s.id)}`);
    console.log(`  cwd=${s.cwd}`);
    console.log(`  driver=${s.driver ?? "cli"} mode=${s.permissionMode ?? ""}`);
    return 0;
  } catch (err) {
    console.error(formatError(err));
    return 1;
  }
}

async function cmdSessionsShow(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);
  const sid = positional[0];
  if (!sid) {
    console.error("usage: rcc sessions show <sid>");
    return 2;
  }
  try {
    const { url, token } = await ctx(flags);
    const resp = await request<{ session: SessionMeta }>(url, `/api/v1/sessions/${encodeURIComponent(sid)}`, { token });
    if (jsonOut(flags)) {
      printJson(resp);
      return 0;
    }
    const s = resp.session;
    console.log(`${color.bold(s.id)}`);
    console.log(`  status:  ${statusColor(s.status)}`);
    console.log(`  driver:  ${s.driver ?? ""}`);
    console.log(`  mode:    ${s.permissionMode ?? ""}`);
    console.log(`  cwd:     ${s.cwd}`);
    console.log(`  created: ${new Date(s.createdAt).toISOString()}`);
    if (s.lastActiveAt) console.log(`  active:  ${relTime(s.lastActiveAt)}`);
    if (s.summary?.title) console.log(`  title:   ${s.summary.title}`);
    return 0;
  } catch (err) {
    console.error(formatError(err));
    return 1;
  }
}

async function cmdSessionsClose(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);
  const sid = positional[0];
  if (!sid) {
    console.error("usage: rcc sessions close <sid>");
    return 2;
  }
  try {
    const { url, token } = await ctx(flags);
    await request<{ ok: boolean }>(url, `/api/v1/sessions/${encodeURIComponent(sid)}`, {
      method: "DELETE",
      token,
    });
    if (jsonOut(flags)) {
      printJson({ ok: true });
      return 0;
    }
    console.log(`${color.green("closed")} ${sid}`);
    return 0;
  } catch (err) {
    console.error(formatError(err));
    return 1;
  }
}

async function cmdSessionsResume(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);
  const sid = positional[0];
  if (!sid) {
    console.error("usage: rcc sessions resume <sid>");
    return 2;
  }
  try {
    const { url, token } = await ctx(flags);
    const resp = await request<{ session: SessionMeta }>(
      url,
      `/api/v1/sessions/${encodeURIComponent(sid)}/resume`,
      { method: "POST", token },
    );
    if (jsonOut(flags)) {
      printJson(resp);
      return 0;
    }
    console.log(`${color.green("resumed")} ${resp.session.id}`);
    return 0;
  } catch (err) {
    console.error(formatError(err));
    return 1;
  }
}

export async function cmdPrompt(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);
  if (getBool(flags, "help")) {
    console.log(`rcc prompt <sid> "<text>"   POST /api/v1/sessions/:sid/prompt`);
    return 0;
  }
  const sid = positional[0];
  const prompt = positional.slice(1).join(" ");
  if (!sid || !prompt) {
    console.error('usage: rcc prompt <sid> "<text>"');
    return 2;
  }
  try {
    const { url, token } = await ctx(flags);
    const resp = await request<{ ok: boolean }>(
      url,
      `/api/v1/sessions/${encodeURIComponent(sid)}/prompt`,
      { method: "POST", body: { prompt }, token },
    );
    if (jsonOut(flags)) {
      printJson(resp);
      return 0;
    }
    console.log(color.green("sent"));
    return 0;
  } catch (err) {
    console.error(formatError(err));
    return 1;
  }
}

function segmentText(seg: ChatSegment): string {
  if (typeof seg.text === "string") return seg.text;
  if (typeof seg.content === "string") return seg.content;
  if (typeof seg.code === "string") return seg.code;
  if (typeof seg.diff === "string") return seg.diff;
  if (seg.toolName) return `<${seg.toolName}>`;
  return "";
}

export async function cmdChat(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);
  if (getBool(flags, "help")) {
    console.log(`rcc chat <sid>   GET /api/v1/sessions/:sid/chat`);
    return 0;
  }
  const sid = positional[0];
  if (!sid) {
    console.error("usage: rcc chat <sid>");
    return 2;
  }
  try {
    const { url, token } = await ctx(flags);
    const resp = await request<{ sid: string; messages: ChatMessage[] }>(
      url,
      `/api/v1/sessions/${encodeURIComponent(sid)}/chat`,
      { token },
    );
    if (jsonOut(flags)) {
      printJson(resp);
      return 0;
    }
    for (const m of resp.messages) {
      const hdr = `${color.dim(new Date(m.timestamp).toLocaleTimeString())} ${roleColor(m.role)}${
        m.streaming ? color.dim(" …") : ""
      }`;
      console.log(hdr);
      for (const seg of m.segments) {
        const text = segmentText(seg);
        if (seg.kind === "text") {
          console.log(indent(text, "  "));
        } else {
          const label = kindColor(seg.kind);
          const body = text ? `\n${indent(text, "    ")}` : "";
          console.log(`  ${label}${body}`);
        }
      }
      console.log("");
    }
    return 0;
  } catch (err) {
    console.error(formatError(err));
    return 1;
  }
}

function indent(s: string, prefix: string): string {
  return s.split("\n").map((l) => prefix + l).join("\n");
}

export async function cmdShare(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);
  if (getBool(flags, "help")) {
    console.log(`rcc share <sid> [--ttl <minutes>]   POST /share/new`);
    return 0;
  }
  const sid = positional[0];
  if (!sid) {
    console.error("usage: rcc share <sid> [--ttl <minutes>]");
    return 2;
  }
  const ttl = getNumber(flags, "ttl") ?? 60;
  try {
    const { url, token } = await ctx(flags);
    const resp = await request<{ id: string; token: string; url: string; expiresAt: number }>(
      url,
      "/share/new",
      { method: "POST", body: { sid, ttlMinutes: ttl }, token },
    );
    if (jsonOut(flags)) {
      printJson(resp);
      return 0;
    }
    console.log(`${color.green("share")} ${color.bold(resp.id)}`);
    console.log(`  url:     ${resp.url}`);
    console.log(`  expires: ${new Date(resp.expiresAt).toISOString()}`);
    return 0;
  } catch (err) {
    console.error(formatError(err));
    return 1;
  }
}

export async function cmdDevices(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (!sub || sub === "list") return cmdDevicesList(rest);
  if (sub === "revoke") return cmdDevicesRevoke(rest);
  if (sub === "rename") return cmdDevicesRename(rest);
  if (sub === "--help" || sub === "-h") {
    console.log(`rcc devices <list|revoke <id>|rename <id> <name>>

Note: requires host to expose /api/v1/devices; older hosts only support admin CLI (pnpm -F @rcc/host admin devices).
`);
    return 0;
  }
  console.error(`unknown devices subcommand: ${sub}`);
  return 2;
}

async function cmdDevicesList(args: string[]): Promise<number> {
  const { flags } = parseArgs(args);
  try {
    const { url, token } = await ctx(flags);
    const resp = await request<{ devices: Array<{ id: string; name: string; createdAt?: number; userAgent?: string | null }> }>(
      url,
      "/api/v1/devices",
      { token },
    );
    if (jsonOut(flags)) {
      printJson(resp);
      return 0;
    }
    console.log(
      renderTable(resp.devices, [
        { header: "ID", get: (d) => d.id },
        { header: "NAME", get: (d) => d.name },
        { header: "CREATED", get: (d) => (d.createdAt ? new Date(d.createdAt).toISOString() : "") },
        { header: "UA", get: (d) => (d.userAgent ?? "").slice(0, 40) },
      ]),
    );
    return 0;
  } catch (err) {
    console.error(formatError(err));
    if (err instanceof HttpError && err.status === 404) {
      console.error(color.dim("hint: host may not expose /api/v1/devices yet — use `pnpm -F @rcc/host admin devices` on the host."));
    }
    return 1;
  }
}

async function cmdDevicesRevoke(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);
  const id = positional[0];
  if (!id) {
    console.error("usage: rcc devices revoke <id>");
    return 2;
  }
  try {
    const { url, token } = await ctx(flags);
    await request<{ ok: boolean }>(url, `/api/v1/devices/${encodeURIComponent(id)}`, {
      method: "DELETE",
      token,
    });
    console.log(`${color.green("revoked")} ${id}`);
    return 0;
  } catch (err) {
    console.error(formatError(err));
    return 1;
  }
}

async function cmdDevicesRename(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);
  const id = positional[0];
  const name = positional.slice(1).join(" ");
  if (!id || !name) {
    console.error("usage: rcc devices rename <id> <name>");
    return 2;
  }
  try {
    const { url, token } = await ctx(flags);
    await request<{ ok: boolean }>(url, `/api/v1/devices/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: { name },
      token,
    });
    console.log(`${color.green("renamed")} ${id} → ${name}`);
    return 0;
  } catch (err) {
    console.error(formatError(err));
    return 1;
  }
}

export async function cmdProjects(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (!sub || sub === "list") return cmdProjectsList(rest);
  if (sub === "add") return cmdProjectsAdd(rest);
  if (sub === "remove" || sub === "rm") return cmdProjectsRemove(rest);
  if (sub === "--help" || sub === "-h") {
    console.log(`rcc projects <list|add --name <n> --cwd <path> [--color <c>]|remove <id>>`);
    return 0;
  }
  console.error(`unknown projects subcommand: ${sub}`);
  return 2;
}

async function cmdProjectsList(args: string[]): Promise<number> {
  const { flags } = parseArgs(args);
  try {
    const { url, token } = await ctx(flags);
    const resp = await request<{ projects: ProjectMeta[] }>(url, "/api/v1/projects", { token });
    if (jsonOut(flags)) {
      printJson(resp);
      return 0;
    }
    console.log(
      renderTable(resp.projects, [
        { header: "ID", get: (p) => p.id },
        { header: "NAME", get: (p) => p.name },
        { header: "COLOR", get: (p) => p.color ?? "" },
        { header: "CWD", get: (p) => p.cwd },
      ]),
    );
    return 0;
  } catch (err) {
    console.error(formatError(err));
    return 1;
  }
}

async function cmdProjectsAdd(args: string[]): Promise<number> {
  const { flags } = parseArgs(args);
  const name = getString(flags, "name");
  const cwd = getString(flags, "cwd");
  const clr = getString(flags, "color");
  if (!name || !cwd) {
    console.error("usage: rcc projects add --name <n> --cwd <path> [--color <c>]");
    return 2;
  }
  try {
    const { url, token } = await ctx(flags);
    const body: Record<string, unknown> = { name, cwd };
    if (clr) body.color = clr;
    const resp = await request<{ project: ProjectMeta }>(url, "/api/v1/projects", {
      method: "POST",
      body,
      token,
    });
    if (jsonOut(flags)) {
      printJson(resp);
      return 0;
    }
    console.log(`${color.green("added")} ${resp.project.id} (${resp.project.name})`);
    return 0;
  } catch (err) {
    console.error(formatError(err));
    return 1;
  }
}

async function cmdProjectsRemove(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);
  const id = positional[0];
  if (!id) {
    console.error("usage: rcc projects remove <id>");
    return 2;
  }
  try {
    const { url, token } = await ctx(flags);
    await request<{ ok: boolean }>(url, `/api/v1/projects/${encodeURIComponent(id)}`, {
      method: "DELETE",
      token,
    });
    console.log(`${color.green("removed")} ${id}`);
    return 0;
  } catch (err) {
    console.error(formatError(err));
    return 1;
  }
}

function cliPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const rel of ["../package.json", "../../package.json"]) {
      try {
        const raw = readFileSync(join(here, rel), "utf8");
        const pkg = JSON.parse(raw) as { name?: string; version?: string };
        if (pkg.name === "@rcc/cli" && typeof pkg.version === "string") return pkg.version;
      } catch {
        // try next candidate
      }
    }
  } catch {
    // fallthrough
  }
  return "0.0.0";
}

export async function cmdVersion(args: string[]): Promise<number> {
  const { flags } = parseArgs(args);
  const local = cliPackageVersion();
  if (getBool(flags, "local")) {
    if (jsonOut(flags)) {
      printJson({ cli: local });
      return 0;
    }
    console.log(`cli: ${local}`);
    return 0;
  }
  try {
    const { url, token } = await ctx(flags);
    const resp = await request<{ version: string; buildTime?: number; node?: string }>(url, "/version", { token });
    if (jsonOut(flags)) {
      printJson({ cli: local, host: resp });
      return 0;
    }
    const match = local === resp.version ? color.green("match") : color.yellow("mismatch");
    console.log(`cli:  ${color.bold(local)}`);
    console.log(`host: ${color.bold(resp.version)}  (${match})`);
    if (resp.node) console.log(`      node ${resp.node}`);
    return 0;
  } catch (err) {
    if (jsonOut(flags)) {
      printJson({ cli: local, host: null, error: formatError(err) });
    } else {
      console.log(`cli:  ${color.bold(local)}`);
      console.log(`host: ${color.red("unreachable")} (${formatError(err)})`);
    }
    return 1;
  }
}

export function formatError(err: unknown): string {
  if (err instanceof HttpError) {
    return `${color.red(`error[${err.code}]`)} ${err.message}`;
  }
  if (err instanceof Error) return `${color.red("error")} ${err.message}`;
  return `${color.red("error")} ${String(err)}`;
}
